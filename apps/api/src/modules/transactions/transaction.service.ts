import { db, transactions, transactionEntries, ledgers, ledgerThirdPartyLinks, shifts, shiftCycles, agents, vouchers, voucherEntries, auditLogs, duplicateReviews, staff, declarations, users, roles, shiftRoleConfig, operatorShiftPermissions, sql as pgSql } from '@pb/database';
import { LedgerService } from '../ledgers/ledger.service.js';
import { eq, and, desc, asc, ne, gte, inArray, isNull, ilike, or, sql } from 'drizzle-orm';
import { redis } from '../../config/redis.js';
import { publishDashboardUpdate } from '../dashboard/dashboard.events.js';
import { ShiftService } from '../shifts/shift.service.js';
import { VoucherService } from '../vouchers/voucher.service.js';
import { AppError, LimitExceededError, NotFoundError, ForbiddenError } from '../../common/errors.js';
import { TransactionCreateInput, UserSession } from '@pb/types';
import crypto from 'crypto';

export class TransactionService {
  // The Live Transactions list's "Added" / "Updated" columns show a PERSON'S NAME above that
  // row's own timestamp — the live reference shows "MANISH KATOCH" on the slip that operator
  // entered and "KARAN999" on the one the super admin entered, each with its own time. The
  // name comes from the staff record linked to the acting user, falling back to the login
  // username when no staff row exists (which is what a name like "KARAN999" looks like).
  //
  // Until now createTransaction never wrote these columns at all, so every new slip fell back
  // to the transactions table's 'SYSTEM' default and the list showed "SYSTEM" for everyone.
  private static async resolveActorName(user: { userId: number; username?: string }): Promise<string> {
    try {
      const [row] = await db.select({ fullName: staff.fullName })
        .from(staff).where(eq(staff.userId, user.userId)).limit(1);
      const full = row?.fullName?.trim();
      if (full) return full;
    } catch (err) {
      console.warn('[Transactions] actor name lookup failed:', err);
    }
    return user.username || 'SYSTEM';
  }

  // Bulk form of the above, for resolving a whole page of rows in one round trip.
  private static async resolveActorNames(userIds: number[]): Promise<Map<number, string>> {
    const out = new Map<number, string>();
    const ids = Array.from(new Set(userIds)).filter(Boolean);
    if (ids.length === 0) return out;
    try {
      const rows = await db.select({
        userId: users.id,
        username: users.username,
        fullName: staff.fullName,
      }).from(users).leftJoin(staff, eq(staff.userId, users.id)).where(inArray(users.id, ids));
      for (const r of rows) out.set(r.userId, r.fullName?.trim() || r.username);
    } catch (err) {
      console.warn('[Transactions] bulk actor name lookup failed:', err);
    }
    return out;
  }

  // DARA numbers are conventionally 2-digit (00-99) and the Jantri grid looks entries up by
  // that padded form — an unpadded value like "2" (instead of "02") got saved fine and summed
  // correctly into totals, but silently never matched any Jantri cell, making that slip's
  // amount invisible in the per-number breakdown despite being counted everywhere else.
  private static normalizeNumberValue(numberValue: string, entryType: string): string {
    const trimmed = (numberValue || '').trim();
    if (entryType === 'DARA' && /^\d{1}$/.test(trimmed)) {
      return trimmed.padStart(2, '0');
    }
    // Haruf is stored as its single digit — the Add page sends it as "A5" / "B1" or the live
    // display form "5555" (Andar) / "111" (Bahar), and every payout, Jantri and report check
    // compares it with one digit of the declared number.
    if (entryType === 'HARUF_ANDAR' || entryType === 'HARUF_BAHAR') {
      const m = trimmed.match(/(\d)\s*$/);
      if (m) return m[1];
    }
    return trimmed;
  }

  // Four of the same digit is Andar haruf, three is Bahar haruf — the live form writes haruf
  // that way (5555 = A5, 111 = B1). Anything else keeps the type it was sent with.
  private static classifyEntryType(numberValue: string, entryType: string): 'DARA' | 'HARUF_ANDAR' | 'HARUF_BAHAR' {
    const v = (numberValue || '').trim();
    if (entryType === 'DARA' || !entryType) {
      if (/^(\d)\1{3}$/.test(v)) return 'HARUF_ANDAR';
      if (/^(\d)\1{2}$/.test(v)) return 'HARUF_BAHAR';
    }
    return (entryType || 'DARA') as 'DARA' | 'HARUF_ANDAR' | 'HARUF_BAHAR';
  }

  // Live Jantri cache field for an entry: numbers by value, haruf under A_d / B_d (the keys
  // JantriService reads), not under the bare digit where it would land on a number.
  private static jantriCacheKey(e: { entryType?: string | null; numberValue: string }): string {
    if (e.entryType === 'HARUF_ANDAR') return `A_${e.numberValue}`;
    if (e.entryType === 'HARUF_BAHAR') return `B_${e.numberValue}`;
    return e.numberValue;
  }

  static async createTransaction(input: TransactionCreateInput, user: UserSession) {
    // 1. Enforce shift cutoff for this role
    await ShiftService.assertShiftOpenForRole(input.shiftId, user.roleId, user.roleName, user.userId);

    // 2. Fetch Shift & Party details
    const [shift] = await db.select().from(shifts).where(eq(shifts.id, input.shiftId));
    if (!shift) throw new NotFoundError('Shift not found');

    if (shift.status === 'DECLARED' || shift.status === 'AUDITED' || shift.declaredNumber) {
      throw new AppError(`Shift ${shift.name} result is already declared. Transactions are closed.`, 400);
    }

    const [party] = await db.select().from(ledgers).where(
      and(eq(ledgers.id, input.partyId), isNull(ledgers.deletedAt))
    );
    if (!party) throw new NotFoundError('Party / Ledger not found');
    if (party.isLocked) throw new AppError('Party account is locked. Transactions disallowed.', 400);
    if (!(await LedgerService.isAccountActive(party.id))) {
      throw new AppError('Party account is deactive. Transactions disallowed.', 400);
    }

    // 3. Redis Idempotency Check
    if (input.idempotencyKey) {
      const lockKey = `idemp:${input.idempotencyKey}`;
      try {
        const existing = await redis.get(lockKey);
        if (existing) {
          return JSON.parse(existing);
        }
      } catch (err) {}
    }

    // 4. Authoritative Total & Rate Calculations
    const partyDaraRate = parseFloat(party.daraRate);
    const partyAkharRate = parseFloat(party.akharRate);
    const partyLimit = parseFloat(party.betLimit);

    let totalAmount = 0;
    const preparedEntries = input.entries.map((entry) => {
      const amt = Math.max(0, entry.amount);
      totalAmount += amt;
      // "9999" / "888" typed as numbers are Andar / Bahar haruf (live panel), so they get the
      // Akhar rate and land in the A / B rows.
      const entryType = this.classifyEntryType(entry.numberValue, entry.entryType);
      const rate = entryType === 'DARA' ? partyDaraRate : partyAkharRate;
      const payout = amt * rate;

      return {
        entryType,
        numberValue: this.normalizeNumberValue(entry.numberValue, entryType),
        amount: amt.toFixed(2),
        rate: rate.toFixed(2),
        calculatedPayout: payout.toFixed(2),
      };
    });

    // Display name for the Added / Updated columns — resolved before opening the write
    // transaction so the lookup isn't holding one open.
    const actorName = await this.resolveActorName(user);

    // 5. Party Limit Validation
    if (partyLimit > 0 && totalAmount > partyLimit) {
      throw new LimitExceededError(
        `Total amount ₹${totalAmount} exceeds configured party limit of ₹${partyLimit}`
      );
    }

    // 6. Generate Slip Number
    const dateStr = shift.openDate.replace(/-/g, '');
    const randPart = crypto.randomBytes(3).toString('hex').toUpperCase();
    const slipNumber = `SLIP-${dateStr}-${shift.name.slice(0, 3)}-${randPart}`;

    // 7. Atomic DB Transaction
    const createdTx = await db.transaction(async (tx) => {
      const [header] = await tx.insert(transactions).values({
        slipNumber,
        shiftId: shift.id,
        partyId: party.id,
        totalAmount: totalAmount.toFixed(2),
        status: 'ACTIVE',
        idempotencyKey: input.idempotencyKey,
        createdBy: user.userId,
        // Both columns start out as the person who entered the slip; "Updated" only diverges
        // once someone actually edits it, which is exactly what the reference shows (a freshly
        // added slip carries the same name and time in both columns).
        addedBy: actorName,
        updatedBy: actorName,
      }).returning();

      const entriesToInsert = preparedEntries.map(e => ({
        transactionId: header.id,
        entryType: e.entryType,
        numberValue: e.numberValue,
        amount: e.amount,
        rate: e.rate,
        calculatedPayout: e.calculatedPayout,
      }));

      await tx.insert(transactionEntries).values(entriesToInsert);

      // Create Audit Log
      await tx.insert(auditLogs).values({
        actorId: user.userId,
        action: 'CREATE',
        entityType: 'TRANSACTION',
        entityId: header.id.toString(),
        afterData: { slipNumber, totalAmount, entryCount: preparedEntries.length },
      });

      // Update creator staff live activity status & timestamp
      await tx.update(staff).set({
        isWorkingLive: true,
        updatedAt: new Date(),
      }).where(sql`user_id = ${user.userId} OR LOWER(username) = LOWER(${user.username})`).catch(() => {});

      return header;
    });

    // 8. Atomic Redis Jantri Increments
    try {
      const jantriKey = `jantri:${shift.id}:${shift.openDate}`;
      const pipeline = redis.pipeline();
      for (const e of preparedEntries) {
        pipeline.hincrbyfloat(jantriKey, this.jantriCacheKey(e), parseFloat(e.amount));
      }
      pipeline.hincrbyfloat(jantriKey, 'TOTAL_COLLECTED', totalAmount);
      await pipeline.exec();
    } catch (err) {
      console.warn('[Redis] Jantri cache update warning:', err);
    }

    // 9. Cache Idempotency Result in Redis (120s TTL)
    const result = {
      id: createdTx.id,
      slipNumber: createdTx.slipNumber,
      shiftId: createdTx.shiftId,
      shiftName: shift.name,
      partyId: createdTx.partyId,
      partyName: party.partyName,
      totalAmount,
      entryCount: preparedEntries.length,
      createdAt: createdTx.createdAt.toISOString(),
    };

    if (input.idempotencyKey) {
      try {
        await redis.set(`idemp:${input.idempotencyKey}`, JSON.stringify(result), 'EX', 120);
      } catch {}
    }

    // 10. Background Duplicate Check (Asynchronous)
    this.checkDuplicatesAsync(createdTx.id, shift.id, party.id, preparedEntries).catch(() => {});

    publishDashboardUpdate(shift.id);

    return result;
  }

  private static async checkDuplicatesAsync(
    transactionId: number,
    shiftId: number,
    partyId: number,
    entries: { numberValue: string; amount: string }[]
  ) {
    try {
      const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000);
      const recent = await db.select().from(transactions).where(
        and(
          eq(transactions.shiftId, shiftId),
          eq(transactions.partyId, partyId),
          ne(transactions.id, transactionId),
          gte(transactions.createdAt, fifteenMinAgo)
        )
      ).limit(5);

      for (const rec of recent) {
        const prevEntries = await db.select().from(transactionEntries).where(
          eq(transactionEntries.transactionId, rec.id)
        );

        const prevNumSet = new Set(prevEntries.map(p => `${p.numberValue}:${p.amount}`));
        let matchCount = 0;
        for (const e of entries) {
          if (prevNumSet.has(`${e.numberValue}:${e.amount}`)) {
            matchCount++;
          }
        }

        const score = entries.length > 0 ? (matchCount / entries.length) * 100 : 0;
        if (score >= 80) {
          await db.insert(duplicateReviews).values({
            originalTransactionId: rec.id,
            duplicateTransactionId: transactionId,
            similarityScore: score.toFixed(2),
            status: 'PENDING',
          });

          await db.update(transactions)
            .set({ status: 'DUPLICATE_FLAGGED' })
            .where(eq(transactions.id, transactionId));
          break;
        }
      }
    } catch (err) {
      console.warn('[DuplicateCheck] Background duplicate check error:', err);
    }
  }

  static async listTransactions(filters: {
    shiftId?: number;
    partyId?: number;
    status?: string;
    auditStatus?: string;
    search?: string;
    date?: string;
    page?: number;
    limit?: number;
    // Set only for own-data roles (see common/roles.ts) — restricts the list to the slips
    // this user entered, matching the live reference where a DATA ENTRY OPERATOR's Live
    // Transactions showed only his own row while SUPER ADMIN saw every operator's rows for
    // the same shift and date. Left undefined for every other role, so their query is
    // unchanged.
    ownerUserId?: number;
    // Live Transactions' bottom Active / Deleted switch. DELETED = soft-deleted (VOIDED)
    // slips only; otherwise VOIDED slips are left out unless status=VOIDED is asked for.
    listMode?: 'ACTIVE' | 'DELETED';
  }) {
    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(200, Math.max(1, filters.limit || 100));
    const offset = (page - 1) * limit;

    const conditions = [];
    if (filters.ownerUserId) conditions.push(eq(transactions.createdBy, filters.ownerUserId));
    if (filters.shiftId) conditions.push(eq(transactions.shiftId, filters.shiftId));
    if (filters.partyId) conditions.push(eq(transactions.partyId, filters.partyId));
    if (filters.listMode === 'DELETED') {
      conditions.push(eq(transactions.status, 'VOIDED'));
    } else if (filters.status && filters.status !== 'ALL') {
      conditions.push(eq(transactions.status, filters.status));
    } else {
      conditions.push(ne(transactions.status, 'VOIDED'));
    }
    if (filters.auditStatus && filters.auditStatus !== 'ALL') {
      // Live Trans-Audit's Status filter offers NOT-AUDIT / AUDITED / ALL. AUDITED is not a
      // stored value — a slip is audited once it's marked VALID or MISTAKE — so it matches
      // everything that is no longer NOT-AUDIT. Rows that predate the column carry NULL and
      // count as NOT-AUDIT, the same default the list below reports for them.
      if (filters.auditStatus === 'AUDITED') {
        conditions.push(sql`COALESCE(${transactions.auditStatus}, 'NOT-AUDIT') <> 'NOT-AUDIT'`);
      } else if (filters.auditStatus === 'NOT-AUDIT') {
        conditions.push(sql`COALESCE(${transactions.auditStatus}, 'NOT-AUDIT') = 'NOT-AUDIT'`);
      } else {
        conditions.push(eq(transactions.auditStatus, filters.auditStatus));
      }
    }
    if (filters.search && filters.search.trim()) {
      const term = `%${filters.search.trim()}%`;
      conditions.push(or(
        ilike(ledgers.partyName, term),
        ilike(transactions.slipNumber, term),
        ilike(transactions.addedBy, term)
      ));
    }
    if (filters.date) {
      conditions.push(sql`${transactions.createdAt}::date = ${filters.date}::date`);
    }

    const list = await db.select({
      id: transactions.id,
      slipNumber: transactions.slipNumber,
      shiftId: transactions.shiftId,
      shiftName: shifts.name,
      partyId: transactions.partyId,
      partyName: ledgers.partyName,
      totalAmount: transactions.totalAmount,
      status: transactions.status,
      rateStr: transactions.rateStr,
      ujType: transactions.ujType,
      addedBy: transactions.addedBy,
      updatedBy: transactions.updatedBy,
      createdBy: transactions.createdBy,
      isD: transactions.isD,
      auditStatus: transactions.auditStatus,
      mistakeRemark: transactions.mistakeRemark,
      mistakeEdited: transactions.mistakeEdited,
      isAudited: transactions.isAudited,
      createdAt: transactions.createdAt,
      updatedAt: transactions.updatedAt,
    })
      .from(transactions)
      .leftJoin(shifts, eq(transactions.shiftId, shifts.id))
      .leftJoin(ledgers, eq(transactions.partyId, ledgers.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(transactions.createdAt))
      .limit(limit)
      .offset(offset);

    // Fetch entries for all retrieved transactions to support right-panel live preview
    const txIds = list.map(t => t.id);
    const allEntries = txIds.length > 0
      ? await db.select().from(transactionEntries).where(inArray(transactionEntries.transactionId, txIds))
      : [];

    const entriesMap = new Map<number, { numberValue: string; amount: number; rate: number; entryType: string }[]>();
    for (const e of allEntries) {
      if (!entriesMap.has(e.transactionId)) {
        entriesMap.set(e.transactionId, []);
      }
      entriesMap.get(e.transactionId)!.push({
        numberValue: e.numberValue,
        amount: parseFloat(e.amount),
        rate: parseFloat(e.rate),
        entryType: e.entryType,
      });
    }

    // Slips saved before createTransaction started writing these columns still carry the
    // table's 'SYSTEM' default. created_by is the authoritative record of who entered them,
    // so resolve a real name from it for those rows rather than leaving the list showing
    // "SYSTEM" — read-only, nothing is rewritten.
    const placeholder = (v?: string | null) => !v || !v.trim() || v.trim().toUpperCase() === 'SYSTEM';
    const needsName = list.filter(t => placeholder(t.addedBy) || placeholder(t.updatedBy)).map(t => t.createdBy);
    const nameByUser = await this.resolveActorNames(needsName);

    return list.map(t => ({
      ...t,
      addedBy: (placeholder(t.addedBy) ? nameByUser.get(t.createdBy) : t.addedBy) || t.addedBy || 'SYSTEM',
      updatedBy: (placeholder(t.updatedBy) ? nameByUser.get(t.createdBy) : t.updatedBy) || t.updatedBy || 'SYSTEM',
      shiftName: t.shiftName || 'UNKNOWN',
      partyName: t.partyName || 'UNKNOWN',
      rateStr: t.rateStr || '90/10-9/10',
      ujType: t.ujType || 'J',
      isD: t.isD ?? true,
      auditStatus: t.auditStatus || 'NOT-AUDIT',
      totalAmount: parseFloat(t.totalAmount),
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
      entries: entriesMap.get(t.id) || [],
    }));
  }

  static async getTransactionById(id: number) {
    const [t] = await db.select({
      id: transactions.id,
      slipNumber: transactions.slipNumber,
      shiftId: transactions.shiftId,
      shiftName: shifts.name,
      partyId: transactions.partyId,
      partyName: ledgers.partyName,
      totalAmount: transactions.totalAmount,
      status: transactions.status,
      rateStr: transactions.rateStr,
      ujType: transactions.ujType,
      addedBy: transactions.addedBy,
      updatedBy: transactions.updatedBy,
      isD: transactions.isD,
      auditStatus: transactions.auditStatus,
      createdAt: transactions.createdAt,
      updatedAt: transactions.updatedAt,
    })
      .from(transactions)
      .leftJoin(shifts, eq(transactions.shiftId, shifts.id))
      .leftJoin(ledgers, eq(transactions.partyId, ledgers.id))
      .where(eq(transactions.id, id));

    if (t) {
      const entries = await this.getTransactionEntries(id);
      return {
        ...t,
        shiftName: t.shiftName || 'UNKNOWN',
        partyName: t.partyName || 'UNKNOWN',
        totalAmount: parseFloat(t.totalAmount),
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
        entries,
      };
    }

    // If no transaction with that id exists, check if id is a shift id
    const [shift] = await db.select().from(shifts).where(eq(shifts.id, id));
    if (shift) {
      return {
        id: 0,
        slipNumber: '',
        shiftId: shift.id,
        shiftName: shift.name,
        partyId: 0,
        partyName: '',
        totalAmount: 0,
        status: 'ACTIVE',
        entries: [],
      };
    }

    return null;
  }

  static async getTransactionEntries(transactionId: number) {
    const list = await db.select().from(transactionEntries).where(
      eq(transactionEntries.transactionId, transactionId)
    );
    return list.map(e => ({
      ...e,
      amount: parseFloat(e.amount),
      rate: parseFloat(e.rate),
    }));
  }

  static async updateTransaction(id: number, newTotalAmount: number, user: UserSession) {
    if (user.roleName !== 'DEVELOPER' && user.roleName !== 'SUPER ADMIN' && user.roleName !== 'ADMIN') {
      throw new ForbiddenError('Only Super Admin and Admin can update transactions');
    }

    const [existing] = await db.select().from(transactions).where(eq(transactions.id, id));
    if (!existing) throw new NotFoundError('Transaction not found');

    const [updated] = await db.update(transactions)
      .set({
        totalAmount: newTotalAmount.toFixed(2),
        updatedAt: new Date(),
        updatedBy: await this.resolveActorName(user),
        // Editing a slip the auditor marked MISTAKE flags it, so its Updated column turns red
        mistakeEdited: existing.auditStatus === 'MISTAKE' ? true : existing.mistakeEdited,
      })
      .where(eq(transactions.id, id))
      .returning();

    await db.insert(auditLogs).values({
      actorId: user.userId,
      action: 'UPDATE',
      entityType: 'TRANSACTION',
      entityId: id.toString(),
      beforeData: existing,
      afterData: updated,
    });

    return updated;
  }

  // Replaces a transaction's full Number/Amount entry grid — the "Edit" flow (same UI as
  // Add Transaction, pre-loaded with the existing slip) rather than the older Admin-only
  // single totalAmount tweak in updateTransaction above.
  static async updateTransactionEntries(
    id: number,
    entries: { entryType: 'DARA' | 'HARUF_ANDAR' | 'HARUF_BAHAR'; numberValue: string; amount: number }[],
    user: UserSession,
    // Declare Transactions → Edit (/declare_transaction_edit): edits a slip of an already
    // declared shift. The change then surfaces on the Dashboard as a ReDeclare. Every other
    // caller keeps the "result is already declared" block below.
    opts?: { declaredEdit?: boolean }
  ) {
    const [existing] = await db.select().from(transactions).where(eq(transactions.id, id));
    if (!existing) throw new NotFoundError('Transaction not found');
    if (opts?.declaredEdit && existing.status === 'VOIDED') {
      throw new AppError('Transaction is deleted', 400);
    }

    const [shift] = await db.select().from(shifts).where(eq(shifts.id, existing.shiftId));
    if (!shift) throw new NotFoundError('Shift not found');
    if (!opts?.declaredEdit && (shift.status === 'DECLARED' || shift.status === 'AUDITED' || shift.declaredNumber)) {
      throw new AppError(`Shift ${shift.name} result is already declared. Transactions are closed.`, 400);
    }

    const [party] = await db.select().from(ledgers).where(eq(ledgers.id, existing.partyId));
    if (!party) throw new NotFoundError('Party / Ledger not found');

    const partyDaraRate = parseFloat(party.daraRate);
    const partyAkharRate = parseFloat(party.akharRate);
    const partyLimit = parseFloat(party.betLimit);

    const oldEntries = await this.getTransactionEntries(id);

    let totalAmount = 0;
    const preparedEntries = entries.map((entry) => {
      const amt = Math.max(0, entry.amount);
      totalAmount += amt;
      // "9999" / "888" typed as numbers are Andar / Bahar haruf (live panel), so they get the
      // Akhar rate and land in the A / B rows.
      const entryType = this.classifyEntryType(entry.numberValue, entry.entryType);
      const rate = entryType === 'DARA' ? partyDaraRate : partyAkharRate;
      const payout = amt * rate;
      return {
        entryType,
        numberValue: this.normalizeNumberValue(entry.numberValue, entryType),
        amount: amt.toFixed(2),
        rate: rate.toFixed(2),
        calculatedPayout: payout.toFixed(2),
      };
    });

    if (partyLimit > 0 && totalAmount > partyLimit) {
      throw new LimitExceededError(
        `Total amount ₹${totalAmount} exceeds configured party limit of ₹${partyLimit}`
      );
    }

    // Resolved before opening the write transaction, same as on create.
    const editorName = await this.resolveActorName(user);

    const updated = await db.transaction(async (tx) => {
      await tx.delete(transactionEntries).where(eq(transactionEntries.transactionId, id));

      if (preparedEntries.length > 0) {
        await tx.insert(transactionEntries).values(
          preparedEntries.map(e => ({
            transactionId: id,
            entryType: e.entryType,
            numberValue: e.numberValue,
            amount: e.amount,
            rate: e.rate,
            calculatedPayout: e.calculatedPayout,
          }))
        );
      }

      const [header] = await tx.update(transactions)
        .set({
          totalAmount: totalAmount.toFixed(2),
          updatedAt: new Date(),
          updatedBy: editorName,
          // Editing a slip the auditor marked MISTAKE flags it, so its Updated column turns red
          mistakeEdited: existing.auditStatus === 'MISTAKE' ? true : existing.mistakeEdited,
        })
        .where(eq(transactions.id, id))
        .returning();

      await tx.insert(auditLogs).values({
        actorId: user.userId,
        action: 'UPDATE',
        entityType: 'TRANSACTION',
        entityId: id.toString(),
        beforeData: { totalAmount: existing.totalAmount, entries: oldEntries },
        afterData: { totalAmount, entries: preparedEntries },
      });

      return header;
    });

    // Reconcile Redis jantri cache: remove the old entries' contribution, apply the new one.
    // The cache only holds the shift's live cycle, so a declared edit of an older cycle's slip
    // leaves it alone.
    const txCycleDate = existing.createdAt.toISOString().slice(0, 10);
    if (!opts?.declaredEdit || txCycleDate === shift.openDate) try {
      const jantriKey = `jantri:${shift.id}:${shift.openDate}`;
      const pipeline = redis.pipeline();
      for (const e of oldEntries) {
        pipeline.hincrbyfloat(jantriKey, this.jantriCacheKey(e), -e.amount);
      }
      pipeline.hincrbyfloat(jantriKey, 'TOTAL_COLLECTED', -parseFloat(existing.totalAmount));
      for (const e of preparedEntries) {
        pipeline.hincrbyfloat(jantriKey, this.jantriCacheKey(e), parseFloat(e.amount));
      }
      pipeline.hincrbyfloat(jantriKey, 'TOTAL_COLLECTED', totalAmount);
      await pipeline.exec();
    } catch (err) {
      console.warn('[Redis] Jantri cache update warning:', err);
    }

    publishDashboardUpdate(shift.id);

    return {
      id: updated.id,
      slipNumber: updated.slipNumber,
      shiftId: updated.shiftId,
      partyId: updated.partyId,
      totalAmount,
      entries: preparedEntries,
    };
  }

  static async updateAuditStatus(
    id: number,
    auditStatus: 'VALID' | 'MISTAKE' | 'NOT-AUDIT',
    user: UserSession,
    mistakeRemark?: string
  ) {
    const [existing] = await db.select().from(transactions).where(eq(transactions.id, id));
    if (!existing) throw new NotFoundError('Transaction not found');

    const [updated] = await db.update(transactions)
      .set({
        auditStatus,
        isAudited: auditStatus !== 'NOT-AUDIT',
        // The Mistake popup's text belongs to the MISTAKE verdict only — any other verdict
        // clears it so Live Transactions stops flagging the slip.
        mistakeRemark: auditStatus === 'MISTAKE' ? (mistakeRemark?.trim() || null) : null,
        // A fresh verdict starts over: the red "edited after Mistake" marker clears until the
        // slip is edited again while MISTAKE.
        mistakeEdited: false,
        // updatedAt / updatedBy are deliberately left alone: on the live system an audit
        // verdict (Valid/Mistake) by DEVELOPER/SUPER ADMIN never replaces the Updated column —
        // it keeps showing the operator who entered/last edited the slip. Who audited it is
        // recorded in audit_logs below instead.
      })
      .where(eq(transactions.id, id))
      .returning();

    await db.insert(auditLogs).values({
      actorId: user.userId,
      action: 'AUDIT',
      entityType: 'TRANSACTION',
      entityId: id.toString(),
      beforeData: { auditStatus: existing.auditStatus, mistakeRemark: existing.mistakeRemark },
      afterData: { auditStatus: updated.auditStatus, mistakeRemark: updated.mistakeRemark },
    });

    return updated;
  }

  // Delete = soft delete: the slip is kept (with its numbers) as VOIDED so Live Transactions'
  // "Deleted" view can still list it — Updated shows who deleted it and when. Every report,
  // Jantri rebuild and total already skips VOIDED slips, so it drops out of all of them.
  static async deleteTransaction(id: number, user: UserSession) {
    const [existing] = await db.select().from(transactions).where(eq(transactions.id, id));
    if (!existing) throw new NotFoundError('Transaction not found');
    if (existing.status === 'VOIDED') throw new AppError('Transaction is already deleted', 400);

    const oldEntries = await this.getTransactionEntries(id);
    await db.update(transactions)
      .set({ status: 'VOIDED', updatedBy: await this.resolveActorName(user), updatedAt: new Date() })
      .where(eq(transactions.id, id));

    // Take the slip back out of the live Jantri cache (same bookkeeping as an entry edit).
    try {
      const [shift] = await db.select().from(shifts).where(eq(shifts.id, existing.shiftId));
      if (shift) {
        const jantriKey = `jantri:${shift.id}:${shift.openDate}`;
        const pipeline = redis.pipeline();
        for (const e of oldEntries) pipeline.hincrbyfloat(jantriKey, this.jantriCacheKey(e), -e.amount);
        pipeline.hincrbyfloat(jantriKey, 'TOTAL_COLLECTED', -parseFloat(existing.totalAmount));
        await pipeline.exec();
        publishDashboardUpdate(shift.id);
      }
    } catch (err) {
      console.warn('[Redis] Jantri cache update warning on delete:', err);
    }

    await db.insert(auditLogs).values({
      actorId: user.userId,
      action: 'DELETE',
      entityType: 'TRANSACTION',
      entityId: id.toString(),
      beforeData: existing,
    });

    return { id, success: true };
  }

  static async copyToNextShift(transactionId: number, targetShiftId?: number, user?: UserSession) {
    const [original] = await db.select().from(transactions).where(eq(transactions.id, transactionId));
    if (!original) throw new NotFoundError('Original transaction not found');

    const originalEntries = await db.select().from(transactionEntries).where(
      eq(transactionEntries.transactionId, transactionId)
    );

    const shiftId = targetShiftId || original.shiftId;
    const [targetShift] = await db.select().from(shifts).where(eq(shifts.id, shiftId));
    if (!targetShift) throw new NotFoundError('Target shift not found');

    const sessionUser = user || { userId: 1, username: 'SYSTEM', roleId: 1, roleName: 'SUPER ADMIN' } as UserSession;

    return await this.createTransaction({
      shiftId: targetShift.id,
      partyId: original.partyId,
      entries: originalEntries.map(e => ({
        entryType: e.entryType as any,
        numberValue: e.numberValue,
        amount: parseFloat(e.amount),
      })),
    }, sessionUser);
  }

  // Collection report — same per-number grid shape as Jantri, but computed per-party so the
  // Commission/Hissa/Dibba/Akh-Mix toggles can apply each party's own ledger-configured rates
  // (set at Ledger create/update time) rather than a flat, unverifiable percentage. Formula is
  // best-effort — net-of-commission / net-of-hissa deduction, Akh-Mix reusing the same Akhar
  // Commission formula (100 - akharRate*10) already used on the Ledgers page — flagged the same
  // honest way TPC/HP-Amt/RBT are flagged elsewhere, since live screenshots of a continuously
  // changing production dataset can't be used to verify the exact arithmetic.
  static async getCollectionView(filters: {
    shiftId: number;
    date: string;
    commission?: boolean;
    hissa?: boolean;
    dibba?: boolean;
    akhMix?: boolean;
    amtLess?: number;
    lessPercent?: number;
    // Optional party filter behind the page's "PARTY NAME / ADD" list. Left undefined (or
    // empty) the report covers every party, exactly as before; with parties listed it narrows
    // to just theirs — the live page shows the whole book at 200, and with DK ROHIT 20% alone
    // in the list it redraws as that party's single number, 100.
    partyIds?: number[];
  }) {
    const conditions = [
      eq(transactions.shiftId, filters.shiftId),
      eq(transactions.status, 'ACTIVE'),
      sql`${transactions.createdAt}::date = ${filters.date}::date`,
    ];
    if (filters.partyIds && filters.partyIds.length > 0) {
      conditions.push(inArray(transactions.partyId, filters.partyIds));
    }

    const txRows = await db.select({ id: transactions.id, partyId: transactions.partyId })
      .from(transactions)
      .where(and(...conditions));

    const hash: Record<string, number> = {};

    if (txRows.length > 0) {
      const partyIds = Array.from(new Set(txRows.map(t => t.partyId)));
      const partyRows = await db.select({
        id: ledgers.id,
        partyName: ledgers.partyName,
        commissionRate: ledgers.commissionRate,
        hissaPercentage: ledgers.hissaPercentage,
        dibba: ledgers.dibba,
        akharRate: ledgers.akharRate,
      }).from(ledgers).where(inArray(ledgers.id, partyIds));
      const partyById = new Map(partyRows.map(p => [p.id, p]));
      const partyByTx = new Map(txRows.map(t => [t.id, t.partyId]));

      // Hissa given to OTHER ledgers through the party's Hissa Party rows (Ledger Update →
      // Hissa, the O-Hissa of Transaction ASC). Live: DK ROHIT 50% ("50 | HP A/C") reads 200 →
      // 100 once Hissa is ticked, while DK ROHIT 20% ("20 | DK ROHIT 20%", its own ledger)
      // keeps its 100 — so a row naming the party itself is not taken off.
      const otherHissaByParty = new Map<number, number>();
      if (filters.hissa) {
        const hissaLinks = await db.select({
          ledgerId: ledgerThirdPartyLinks.ledgerId,
          partyName: ledgerThirdPartyLinks.partyName,
          percent: ledgerThirdPartyLinks.percent,
        })
          .from(ledgerThirdPartyLinks)
          .where(and(eq(ledgerThirdPartyLinks.linkType, 'HISSA'), inArray(ledgerThirdPartyLinks.ledgerId, partyIds)));
        for (const l of hissaLinks) {
          const ownName = (partyById.get(l.ledgerId)?.partyName || '').trim().toUpperCase();
          if ((l.partyName || '').trim().toUpperCase() === ownName) continue;
          otherHissaByParty.set(l.ledgerId, (otherHissaByParty.get(l.ledgerId) || 0) + (parseFloat(l.percent) || 0));
        }
      }

      const txIds = txRows.map(t => t.id);
      const entries = await db.select().from(transactionEntries).where(inArray(transactionEntries.transactionId, txIds));

      for (const e of entries) {
        const partyId = partyByTx.get(e.transactionId);
        const party = partyId !== undefined ? partyById.get(partyId) : undefined;
        // Dibba no longer drops the parties that aren't Dibba-flagged: live keeps DK ROHIT
        // 50% (Dibba NO) at 100 with Dibba ticked. Like Commission, the flag stays plumbed
        // until a Dibba-flagged party on live shows what it does to that party's figures.
        void filters.dibba;

        let amt = parseFloat(e.amount);
        const isHaruf = e.entryType === 'HARUF_ANDAR' || e.entryType === 'HARUF_BAHAR';

        // Commission is deliberately NOT deducted from these cells. The live Collection page
        // leaves the grid at 200 with Commission ticked, and 200 with it clear — and those
        // parties are NOT on 0% commission: the same shift's dashboard card reads 200 / 117,
        // which only solves with both of them at 10% commission
        //   (100 * 0.9 * 1.0 own-hissa * 0.8 HP-link = 72) + (100 * 0.9 * 0.5 own-hissa = 45) = 117
        // and that same party config is what makes the live grid read 2 -> 50, 3 -> 100 once
        // Hissa is ticked. So the toggle demonstrably does not touch the collected amounts.
        // Deducting it here was the one figure that disagreed with the live page (local showed
        // 180 against the live 200).
        //
        // What it does instead is not yet known — every live sample is a Dara-only book, so an
        // Akhar-side effect can't be ruled out. The flag stays plumbed end to end so the rule
        // can be dropped in here once a case with Akhar entries pins it down.
        void filters.commission;
        if (filters.akhMix && isHaruf && party) {
          const akharRate = parseFloat(party.akharRate) || 0;
          const akharComm = 100 - akharRate * 10;
          amt = amt * (1 - akharComm / 100);
        }
        if (filters.hissa && party) {
          const hissaPct = (parseFloat(party.hissaPercentage) || 0) + (otherHissaByParty.get(party.id) || 0);
          amt = amt * Math.max(0, 1 - hissaPct / 100);
        }

        const key = e.entryType === 'HARUF_ANDAR'
          ? `A_${e.numberValue}`
          : e.entryType === 'HARUF_BAHAR'
          ? `B_${e.numberValue}`
          : e.numberValue;
        hash[key] = (hash[key] || 0) + amt;
      }
    }

    // Amt-Less/Less-% apply once per aggregated cell (flat subtract, then percent) — the same
    // order already validated against the live report earlier, now moved server-side so the
    // filtered result comes straight from the database on Submit, not a client recompute.
    const applyLess = (raw: number): number => {
      let amt = raw;
      if (filters.amtLess && filters.amtLess > 0) amt = Math.max(0, amt - filters.amtLess);
      if (filters.lessPercent && filters.lessPercent > 0) amt = amt * (1 - filters.lessPercent / 100);
      return amt;
    };

    const grid = [];
    for (let i = 0; i < 100; i++) {
      const numStr = i.toString().padStart(2, '0');
      const raw = hash[numStr] || 0;
      grid.push({ number: numStr, totalAmount: raw > 0 ? applyLess(raw) : 0 });
    }
    const haruf = [];
    for (let d = 0; d < 10; d++) {
      const dStr = d.toString();
      const andarRaw = hash[`A_${dStr}`] || 0;
      const baharRaw = hash[`B_${dStr}`] || 0;
      haruf.push({
        digit: dStr,
        andarAmount: andarRaw > 0 ? applyLess(andarRaw) : 0,
        baharAmount: baharRaw > 0 ? applyLess(baharRaw) : 0,
      });
    }

    return { grid, haruf };
  }

  // "Kwada Trans" finder — parties who submitted a given exact Amount a given exact number
  // of Times (Count) in a shift, the same split-stake pattern the live site's own Amount/Count
  // lookup surfaces. Count is optional — omitted, it just lists every matching party/amount.
  static async findKwadaTransactions(filters: { shiftId?: number; date?: string; amount: number; count?: number }) {
    const conditions = [eq(transactions.totalAmount, filters.amount.toString()), ne(transactions.status, 'VOIDED')];
    if (filters.shiftId) conditions.push(eq(transactions.shiftId, filters.shiftId));
    if (filters.date) conditions.push(sql`${transactions.createdAt}::date = ${filters.date}::date`);

    const rows = await db.select({
      partyId: transactions.partyId,
      partyName: ledgers.partyName,
    })
      .from(transactions)
      .leftJoin(ledgers, eq(transactions.partyId, ledgers.id))
      .where(and(...conditions));

    const grouped = new Map<number, { partyName: string; count: number }>();
    for (const r of rows) {
      if (!grouped.has(r.partyId)) grouped.set(r.partyId, { partyName: r.partyName || 'UNKNOWN', count: 0 });
      grouped.get(r.partyId)!.count++;
    }

    return Array.from(grouped.entries())
      .filter(([, v]) => filters.count === undefined || v.count === filters.count)
      .map(([partyId, v], i) => ({ sr: i + 1, partyId, party: v.partyName, amount: filters.amount, count: v.count }));
  }

  // "Abs Party" (Party Not Working) — parties who regularly transact in this shift (any
  // activity in the last 30 days) but have none today. "Work" is a best-effort proxy: their
  // slip count in that same 30-day lookback window (no other source for this metric exists
  // anywhere in the schema), flagged the same honest way TPC/HP-Amt/RBT are flagged elsewhere.
  static async getAbsentParties(filters: { shiftId: number; date: string }) {
    const lookbackFrom = new Date(filters.date);
    lookbackFrom.setDate(lookbackFrom.getDate() - 30);
    const fromDateStr = lookbackFrom.toISOString().slice(0, 10);

    const historyRows = await db.select({ partyId: transactions.partyId })
      .from(transactions)
      .where(and(
        eq(transactions.shiftId, filters.shiftId),
        ne(transactions.status, 'VOIDED'),
        sql`${transactions.createdAt}::date >= ${fromDateStr}::date`,
        sql`${transactions.createdAt}::date < ${filters.date}::date`,
      ));

    const workCount = new Map<number, number>();
    for (const r of historyRows) {
      workCount.set(r.partyId, (workCount.get(r.partyId) || 0) + 1);
    }
    if (workCount.size === 0) return [];

    const todayRows = await db.select({ partyId: transactions.partyId })
      .from(transactions)
      .where(and(
        eq(transactions.shiftId, filters.shiftId),
        sql`${transactions.createdAt}::date = ${filters.date}::date`,
      ));
    const presentToday = new Set(todayRows.map(r => r.partyId));

    const absentPartyIds = Array.from(workCount.keys()).filter(id => !presentToday.has(id));
    if (absentPartyIds.length === 0) return [];

    const partyRows = await db.select({
      id: ledgers.id,
      partyName: ledgers.partyName,
      mobile: ledgers.mobile,
    }).from(ledgers).where(inArray(ledgers.id, absentPartyIds));

    return partyRows
      .map((p, i) => ({ sr: i + 1, id: p.id, party: p.partyName, mobile: p.mobile || '-', work: workCount.get(p.id) || 0 }))
      .sort((a, b) => b.work - a.work);
  }

  // Duplicate Trans report: one row per GROUP of slips that share the same party, shift, day
  // and amount, with D-Count saying how many slips fell in that group. The live report shows
  // exactly that shape — "KSG ROHAN 90/10 | GALI | 22-09-2026 | 490 | D-Count 2" is a single
  // row standing for two identical 490 slips, not two rows.
  //
  // This used to return EVERY transaction with a hardcoded dCount of 2 and silently ignored
  // the date filter, so the page listed the whole book instead of the repeats.
  static async listDuplicates(filters: { shiftId?: number; date?: string }) {
    const conditions = [ne(transactions.status, 'VOIDED')];
    if (filters.shiftId) conditions.push(eq(transactions.shiftId, filters.shiftId));
    if (filters.date) conditions.push(sql`${transactions.createdAt}::date = ${filters.date}::date`);

    const rows = await db.select({
      id: transactions.id,
      partyId: transactions.partyId,
      partyName: ledgers.partyName,
      shiftId: transactions.shiftId,
      shiftName: shifts.name,
      totalAmount: transactions.totalAmount,
      createdAt: transactions.createdAt,
    })
      .from(transactions)
      .leftJoin(shifts, eq(transactions.shiftId, shifts.id))
      .leftJoin(ledgers, eq(transactions.partyId, ledgers.id))
      .where(and(...conditions))
      .orderBy(desc(transactions.createdAt));

    type Group = {
      ids: number[];
      party: string;
      shift: string;
      date: string;
      amount: number;
      createdAt: Date;
    };
    const groups = new Map<string, Group>();

    for (const r of rows) {
      const date = r.createdAt.toISOString().slice(0, 10);
      // Amount is normalised so 490 and 490.00 land in the same bucket.
      const amount = parseFloat(r.totalAmount);
      const key = `${r.partyId}|${r.shiftId}|${date}|${amount}`;
      const g = groups.get(key);
      if (g) {
        g.ids.push(r.id);
        // Keep the earliest slip first — the one a Delete would leave standing.
        if (r.createdAt < g.createdAt) g.createdAt = r.createdAt;
      } else {
        groups.set(key, {
          ids: [r.id],
          party: r.partyName || 'UNKNOWN',
          shift: r.shiftName || 'UNKNOWN',
          date,
          amount,
          createdAt: r.createdAt,
        });
      }
    }

    // Number match: within each party + shift + day + amount group, slips only count as
    // duplicates of each other when their entries are EXACTLY the same — same numbers, same
    // entry type (Dara / Andar / Bahar) and same amount on each number, with the same number of
    // entries (order doesn't matter). Two 100 slips "55 → 100" and "79 → 100" match on the four
    // fields above but are different bets, so they are no longer reported as a duplicate.
    const candidates = Array.from(groups.values()).filter(g => g.ids.length > 1);
    const candidateIds = candidates.flatMap(g => g.ids);
    const signatureById = new Map<number, string>();
    if (candidateIds.length > 0) {
      const entryRows = await db.select({
        transactionId: transactionEntries.transactionId,
        entryType: transactionEntries.entryType,
        numberValue: transactionEntries.numberValue,
        amount: transactionEntries.amount,
      })
        .from(transactionEntries)
        .where(inArray(transactionEntries.transactionId, candidateIds));

      const partsById = new Map<number, string[]>();
      for (const e of entryRows) {
        const parts = partsById.get(e.transactionId) || [];
        parts.push(`${e.entryType}|${e.numberValue}|${parseFloat(e.amount)}`);
        partsById.set(e.transactionId, parts);
      }
      for (const id of candidateIds) {
        signatureById.set(id, (partsById.get(id) || []).sort().join(','));
      }
    }

    const matched: Group[] = [];
    for (const g of candidates) {
      const bySignature = new Map<string, number[]>();
      for (const id of g.ids) {
        const sig = signatureById.get(id) ?? '';
        const ids = bySignature.get(sig) || [];
        ids.push(id); // g.ids is newest first, so each sub-group keeps that order
        bySignature.set(sig, ids);
      }
      for (const ids of bySignature.values()) {
        if (ids.length < 2) continue;
        const idSet = new Set(ids);
        const createdTimes = rows.filter(r => idSet.has(r.id)).map(r => r.createdAt.getTime());
        matched.push({ ...g, ids, createdAt: new Date(Math.min(...createdTimes)) });
      }
    }

    return matched
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((g, i) => ({
        sr: i + 1,
        // The newest slip in the group — what a row-level action targets by default.
        id: g.ids[0],
        // Every slip in the group, so the page can act on the repeats without a second lookup.
        transactionIds: g.ids,
        party: g.party,
        shift: g.shift,
        date: g.date,
        amount: g.amount,
        dCount: g.ids.length,
      }));
  }

  // Flat per-entry breakdown with S-Hissa/O-Hissa and per-entry P&L (only meaningful once
  // the shift has a declared number — otherwise P&L is 0). Powers Transaction ASC /
  // Declare Trans ASC.
  static async listEntriesAsc(filters: { shiftId?: number; fromDate?: string; toDate?: string; minAmount?: number }) {
    const conditions = [ne(transactions.status, 'VOIDED')];
    if (filters.shiftId) conditions.push(eq(transactions.shiftId, filters.shiftId));
    if (filters.fromDate) conditions.push(sql`${transactions.createdAt}::date >= ${filters.fromDate}::date`);
    if (filters.toDate) conditions.push(sql`${transactions.createdAt}::date <= ${filters.toDate}::date`);

    const rows = await db.select({
      entryId: transactionEntries.id,
      transactionId: transactions.id,
      partyId: ledgers.id,
      partyName: ledgers.partyName,
      numberValue: transactionEntries.numberValue,
      entryType: transactionEntries.entryType,
      amount: transactionEntries.amount,
      rate: transactionEntries.rate,
      rateStr: transactions.rateStr,
      hissaPercentage: ledgers.hissaPercentage,
      partyRebate: ledgers.rebate,
      shiftId: transactions.shiftId,
      shiftName: shifts.name,
      declaredNumber: shifts.declaredNumber,
      shiftOpenDate: shifts.openDate,
      slipNumber: transactions.slipNumber,
      createdAt: transactions.createdAt,
    })
      .from(transactionEntries)
      .innerJoin(transactions, eq(transactionEntries.transactionId, transactions.id))
      .innerJoin(ledgers, eq(transactions.partyId, ledgers.id))
      .innerJoin(shifts, eq(transactions.shiftId, shifts.id))
      .where(and(...conditions))
      .orderBy(asc(transactionEntries.id));

    const filtered = filters.minAmount
      ? rows.filter(r => parseFloat(r.amount) >= filters.minAmount!)
      : rows;

    // S-Hissa / O-Hissa as the live report shows them — from the party ledger's Hissa set-up
    // (Ledger Update → Re-Config): S-Hissa is the share the party keeps itself (Self Hissa,
    // plus any Hissa Party row naming the party's own ledger); O-Hissa is the total given to
    // OTHER ledgers through Hissa Party rows. Live: "20 | DK ROHIT 20%" → S 20 / O 0, and
    // "50 | HP A/C" → S 0 / O 50. (It was S = Self Hissa and O = 100 − S, which ignored the
    // Hissa Party rows and read O-Hissa 100 for every party without a Self Hissa.)
    const partyIds = [...new Set(filtered.map(r => r.partyId))];
    const hissaLinks = partyIds.length > 0
      ? await db.select({
          ledgerId: ledgerThirdPartyLinks.ledgerId,
          partyName: ledgerThirdPartyLinks.partyName,
          percent: ledgerThirdPartyLinks.percent,
        })
          .from(ledgerThirdPartyLinks)
          .where(and(eq(ledgerThirdPartyLinks.linkType, 'HISSA'), inArray(ledgerThirdPartyLinks.ledgerId, partyIds)))
      : [];
    const hissaByParty = new Map<number, { self: number; other: number }>();
    for (const r of filtered) {
      if (hissaByParty.has(r.partyId)) continue;
      const ownName = (r.partyName || '').trim().toUpperCase();
      let self = parseFloat(r.hissaPercentage) || 0;
      let other = 0;
      for (const l of hissaLinks) {
        if (l.ledgerId !== r.partyId) continue;
        const pct = parseFloat(l.percent) || 0;
        if ((l.partyName || '').trim().toUpperCase() === ownName) self += pct;
        else other += pct;
      }
      hissaByParty.set(r.partyId, { self, other });
    }

    // P&L is judged against the result declared for the slip's OWN cycle date, not the shift's
    // current declared number — otherwise a 22-09 slip would be checked against 23-09's result.
    // The cycle date is the shift open_date stamped into the slip number (SLIP-YYYYMMDD-...),
    // falling back to the day it was created. The result for that date comes from the shift's
    // cycle history; the live cycle keeps using shifts.declared_number exactly as before. A
    // cycle with no declared result gives P&L 0, as an undeclared shift always did.
    const cycleDateOf = (r: { slipNumber: string; createdAt: Date }) => {
      const m = /^SLIP-(\d{4})(\d{2})(\d{2})-/.exec(r.slipNumber || '');
      if (m) return `${m[1]}-${m[2]}-${m[3]}`;
      const d = r.createdAt;
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const cycleShiftIds = [...new Set(filtered.map(r => r.shiftId))];
    const cycleResults = cycleShiftIds.length > 0
      ? await db.select({
          shiftId: shiftCycles.shiftId,
          cycleDate: shiftCycles.cycleDate,
          status: shiftCycles.status,
          declaredNumber: shiftCycles.declaredNumber,
        })
          .from(shiftCycles)
          .where(inArray(shiftCycles.shiftId, cycleShiftIds))
      : [];
    const resultByCycle = new Map<string, string | null>();
    for (const c of cycleResults) {
      const declared = (c.status === 'DECLARED' || c.status === 'AUDITED') ? c.declaredNumber : null;
      resultByCycle.set(`${c.shiftId}|${c.cycleDate}`, declared || null);
    }
    const declaredFor = (r: typeof filtered[number]): string | null => {
      const cycleDate = cycleDateOf(r);
      if (cycleDate === r.shiftOpenDate) return r.declaredNumber || null;
      return resultByCycle.get(`${r.shiftId}|${cycleDate}`) ?? null;
    };

    // Undeclared cycle — live shows each row's P&L as "if this number comes": the party's
    // winnings on it, less everything it staked in the shift, plus its Rebate (Vapsi %) on the
    // stake that loses, scaled to the book's share after the party's S-Hissa. Live: DK ROHIT
    // 20% (Rebate 10, S-Hissa 20) with 10 each on 5/6/7 → (900 − 30 + 2) × 0.8 = 697.6 → 698.
    // Worked over ALL of the party's entries in that shift/cycle (not just the Amount-filtered
    // rows), so filtering doesn't change a row's figure.
    const bookKey = (r: typeof rows[number]) => `${r.partyId}|${r.shiftId}|${cycleDateOf(r)}`;
    const bookEntries = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = bookKey(r);
      if (!bookEntries.has(k)) bookEntries.set(k, []);
      bookEntries.get(k)!.push(r);
    }
    const projectedPnl = (r: typeof rows[number], selfHissa: number) => {
      const book = bookEntries.get(bookKey(r)) || [];
      const totalStake = book.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
      let wins: (e: typeof rows[number]) => boolean;
      if (r.entryType === 'DARA') {
        const n = r.numberValue.padStart(2, '0');
        wins = e => (e.entryType === 'DARA' && e.numberValue.padStart(2, '0') === n)
          || (e.entryType === 'HARUF_ANDAR' && e.numberValue === n[0])
          || (e.entryType === 'HARUF_BAHAR' && e.numberValue === n[1]);
      } else {
        wins = e => e.entryType === r.entryType && e.numberValue === r.numberValue;
      }
      let payout = 0;
      let winStake = 0;
      for (const e of book) {
        if (!wins(e)) continue;
        payout += (parseFloat(e.amount) || 0) * (parseFloat(e.rate) || 0);
        winStake += parseFloat(e.amount) || 0;
      }
      const rebatePct = parseFloat(r.partyRebate) || 0;
      const partyNet = payout - totalStake + (totalStake - winStake) * rebatePct / 100;
      return Math.round(partyNet * (1 - selfHissa / 100));
    };

    // Live Rate column shows the rate of the entry's own side: "90/10" for a Dara number,
    // "9/10" for Andar/Bahar (the slip's rate string is "90/10-9/10").
    const rateFor = (r: typeof rows[number], rate: number) => {
      const parts = (r.rateStr || '').split('-');
      if (parts.length === 2 && parts[0] && parts[1]) return r.entryType === 'DARA' ? parts[0] : parts[1];
      return r.rateStr || `${rate}/10`;
    };

    const result = filtered.map(r => {
      const amount = parseFloat(r.amount);
      const rate = parseFloat(r.rate);
      const partyHissa = hissaByParty.get(r.partyId) || { self: 0, other: 0 };
      let pnlAmount = 0;

      const cycleDeclared = declaredFor(r);
      if (!cycleDeclared) {
        pnlAmount = projectedPnl(r, partyHissa.self);
      } else {
        const padded = cycleDeclared.padStart(2, '0');
        const tensDigit = padded[0];
        const unitsDigit = padded[1];
        let isWinner = false;
        if (r.entryType === 'DARA' && r.numberValue === padded) isWinner = true;
        else if (r.entryType === 'HARUF_ANDAR' && r.numberValue === tensDigit) isWinner = true;
        else if (r.entryType === 'HARUF_BAHAR' && r.numberValue === unitsDigit) isWinner = true;
        pnlAmount = isWinner ? -(amount * rate) : amount;
      }

      return {
        id: r.entryId,
        transactionId: r.transactionId,
        partyName: r.partyName,
        numberValue: r.numberValue,
        entryType: r.entryType,
        sale: amount,
        pnlAmount,
        rate: rateFor(r, rate),
        sHissa: partyHissa.self,
        oHissa: partyHissa.other,
        shiftId: r.shiftId,
        shiftName: r.shiftName,
      };
    });

    // "ASC": numbers in ascending order as on live (5, 6, 7 — 100 last), Dara before
    // Andar/Bahar, entry order breaking ties.
    const typeOrder: Record<string, number> = { DARA: 0, HARUF_ANDAR: 1, HARUF_BAHAR: 2 };
    const numOrder = (r: { entryType: string; numberValue: string }) => {
      const n = parseInt(r.numberValue, 10) || 0;
      return r.entryType === 'DARA' && n === 0 ? 100 : n;
    };
    return result.sort((a, b) =>
      (typeOrder[a.entryType] ?? 9) - (typeOrder[b.entryType] ?? 9)
      || numOrder(a) - numOrder(b)
      || a.id - b.id);
  }

  // Party-wise collection totals for a date/shift range. Powers TPC Report.
  static async getPartyCollectionTotals(filters: { fromDate?: string; toDate?: string; shiftId?: number }) {
    const conditions = [ne(transactions.status, 'VOIDED')];
    if (filters.shiftId) conditions.push(eq(transactions.shiftId, filters.shiftId));
    if (filters.fromDate) conditions.push(sql`${transactions.createdAt}::date >= ${filters.fromDate}::date`);
    if (filters.toDate) conditions.push(sql`${transactions.createdAt}::date <= ${filters.toDate}::date`);

    const rows = await db.select({
      partyId: transactions.partyId,
      partyName: ledgers.partyName,
      totalAmount: sql<string>`COALESCE(SUM(${transactions.totalAmount}::numeric), 0)`,
      slipCount: sql<number>`COUNT(${transactions.id})::int`,
    })
      .from(transactions)
      .innerJoin(ledgers, eq(transactions.partyId, ledgers.id))
      .where(and(...conditions))
      .groupBy(transactions.partyId, ledgers.partyName)
      .orderBy(desc(sql`SUM(${transactions.totalAmount}::numeric)`));

    return rows.map(r => ({
      partyId: r.partyId,
      partyName: r.partyName,
      totalAmount: parseFloat(r.totalAmount),
      slipCount: r.slipCount,
    }));
  }

  // Party-wise financial breakdown for a shift's business day. Several columns here
  // (Cap, Rate, S-Hissa, Total/D/A-Sale, Comm) are directly derived from real ledger and
  // entry data. O-Dara/O-Akhar are real liability figures once the shift is declared
  // (same winner-matching logic as declareResult). Hissa/Debit/Credit use a best-effort
  // formula — hissa = (totalSale - |comm|) * hissaPercentage — validated against one
  // reference row from the live site; treat as an approximation, not a guaranteed match.
  // TPC's exact formula could not be determined and is left at 0.
  static async getDailyReport(filters: { shiftId: number; date?: string; agentId?: number }) {
    const [shift] = await db.select().from(shifts).where(eq(shifts.id, filters.shiftId));
    if (!shift) throw new NotFoundError('Shift not found');

    const dateFilter = filters.date || shift.openDate;

    const txRows = await db.select().from(transactions).where(
      and(
        eq(transactions.shiftId, filters.shiftId),
        ne(transactions.status, 'VOIDED'),
        sql`${transactions.createdAt}::date = ${dateFilter}::date`
      )
    );

    const txIds = txRows.map(t => t.id);
    const entryRows = txIds.length > 0
      ? await db.select().from(transactionEntries).where(inArray(transactionEntries.transactionId, txIds))
      : [];

    const entriesByTx = new Map<number, typeof entryRows>();
    for (const e of entryRows) {
      if (!entriesByTx.has(e.transactionId)) entriesByTx.set(e.transactionId, []);
      entriesByTx.get(e.transactionId)!.push(e);
    }

    const partyIds = Array.from(new Set(txRows.map(t => t.partyId)));
    const partyRows = partyIds.length > 0
      ? await db.select({
          id: ledgers.id,
          partyName: ledgers.partyName,
          agentId: ledgers.agentId,
          capping: ledgers.capping,
          daraRate: ledgers.daraRate,
          akharRate: ledgers.akharRate,
          hissaPercentage: ledgers.hissaPercentage,
          commissionRate: ledgers.commissionRate,
        }).from(ledgers).where(inArray(ledgers.id, partyIds))
      : [];
    const partyById = new Map(partyRows.map(p => [p.id, p]));

    const agentIds = Array.from(new Set(partyRows.map(p => p.agentId).filter((id): id is number => id != null)));
    const agentRows = agentIds.length > 0
      ? await db.select({ id: agents.id, agentName: agents.agentName }).from(agents).where(inArray(agents.id, agentIds))
      : [];
    const agentNameById = new Map(agentRows.map(a => [a.id, a.agentName]));

    const declaredNumber = shift.declaredNumber ? shift.declaredNumber.padStart(2, '0') : null;
    const tensDigit = declaredNumber?.[0];
    const unitsDigit = declaredNumber?.[1];

    const perParty = new Map<number, { totalSale: number; dSale: number; aSale: number; oDara: number; oAkhar: number }>();

    for (const tx of txRows) {
      if (!perParty.has(tx.partyId)) perParty.set(tx.partyId, { totalSale: 0, dSale: 0, aSale: 0, oDara: 0, oAkhar: 0 });
      const agg = perParty.get(tx.partyId)!;
      agg.totalSale += parseFloat(tx.totalAmount);

      for (const e of entriesByTx.get(tx.id) || []) {
        const amt = parseFloat(e.amount);
        const rate = parseFloat(e.rate);
        if (e.entryType === 'DARA') {
          agg.dSale += amt;
          if (declaredNumber && e.numberValue === declaredNumber) agg.oDara += amt * rate;
        } else {
          agg.aSale += amt;
          if (declaredNumber) {
            if (e.entryType === 'HARUF_ANDAR' && e.numberValue === tensDigit) agg.oAkhar += amt * rate;
            else if (e.entryType === 'HARUF_BAHAR' && e.numberValue === unitsDigit) agg.oAkhar += amt * rate;
          }
        }
      }
    }

    let rows = Array.from(perParty.entries()).map(([partyId, agg]) => {
      const party = partyById.get(partyId);
      const commissionRate = parseFloat(party?.commissionRate || '0');
      const hissaPct = parseFloat(party?.hissaPercentage || '0');
      const comm = -(agg.totalSale * commissionRate / 100);
      const hissa = -((agg.totalSale + comm) * hissaPct / 100);

      return {
        partyId,
        partyName: party?.partyName || 'UNKNOWN',
        agentId: party?.agentId ?? null,
        agentName: party?.agentId ? (agentNameById.get(party.agentId) || '-') : '-',
        cap: parseFloat(party?.capping || '0'),
        rate: `${Math.round(parseFloat(party?.daraRate || '0'))}/10-${Math.round(parseFloat(party?.akharRate || '0'))}/10`,
        sHissa: hissaPct,
        totalSale: agg.totalSale,
        dSale: agg.dSale,
        aSale: agg.aSale,
        comm,
        oDara: agg.oDara,
        oAkhar: agg.oAkhar,
        tpc: 0,
        hissa,
        debit: hissa < 0 ? Math.abs(hissa) : 0,
        credit: hissa > 0 ? hissa : 0,
      };
    });

    if (filters.agentId) {
      rows = rows.filter(r => r.agentId === filters.agentId);
    }
    rows.sort((a, b) => a.partyName.localeCompare(b.partyName));

    const sum = (key: 'totalSale' | 'dSale' | 'aSale' | 'comm' | 'oDara' | 'oAkhar' | 'hissa' | 'debit' | 'credit') =>
      rows.reduce((s, r) => s + r[key], 0);

    const totalCollected = sum('totalSale');
    const totalPayout = sum('oDara') + sum('oAkhar');

    return {
      shiftId: shift.id,
      shiftName: shift.name,
      date: dateFilter,
      partyCount: rows.length,
      profit: totalCollected - totalPayout,
      rows,
      masterTotal: {
        totalSale: sum('totalSale'),
        dSale: sum('dSale'),
        aSale: sum('aSale'),
        comm: sum('comm'),
        oDara: sum('oDara'),
        oAkhar: sum('oAkhar'),
        tpc: 0,
        hissa: sum('hissa'),
        debit: sum('debit'),
        credit: sum('credit'),
      },
    };
  }

  // Per-shift Profit & Loss summary across a date range — same per-party Comm/O-Dara/O-Akhar/
  // Hissa formulas already validated in getDailyReport above (Comm = -(totalSale * commission%),
  // Hissa = -((totalSale+comm) * hissa%)), just aggregated across every party AND every day in
  // range instead of one shift/one date. Only shifts with at least one real declaration inside
  // the range are included — matches the live report showing 9 of 11 shifts (the still-
  // undeclared ones drop out), since O-Dara/O-Akhar need a real declared number per day to
  // compute. Each day's own declaration (from the declarations table, not shifts.declaredNumber
  // — shift rows are reused day-to-day, so only the historical declarations table has past
  // days' winning numbers) is matched against that day's entries only.
  // Dara/Akhar Open are winning STAKES; Hissa, TPC and Closing follow the formulas noted at the
  // per-party step below (TPC from the parties' TPC links, Closing = Book + Hissa + TPC).
  static async getShiftProfitLossReport(filters: { fromDate: string; toDate: string }) {
    const declRows = await db.select({
      shiftId: declarations.shiftId,
      winningNumber: declarations.winningNumber,
      day: sql<string>`${declarations.declaredAt}::date::text`,
    }).from(declarations).where(and(
      eq(declarations.isReversed, false),
      sql`${declarations.declaredAt}::date >= ${filters.fromDate}::date`,
      sql`${declarations.declaredAt}::date <= ${filters.toDate}::date`,
    ));

    const declaredNumberByShiftDate = new Map<string, string>();
    const shiftIdsWithDeclaration = new Set<number>();
    for (const d of declRows) {
      const dateStr = d.day;
      declaredNumberByShiftDate.set(`${d.shiftId}:${dateStr}`, d.winningNumber.padStart(2, '0'));
      shiftIdsWithDeclaration.add(d.shiftId);
    }

    if (shiftIdsWithDeclaration.size === 0) return { rows: [], masterTotal: null };

    const shiftIds = Array.from(shiftIdsWithDeclaration);
    const shiftRows = await db.select().from(shifts).where(inArray(shifts.id, shiftIds));
    const shiftById = new Map(shiftRows.map(s => [s.id, s]));

    const txRows = await db.select({
      id: transactions.id,
      shiftId: transactions.shiftId,
      partyId: transactions.partyId,
      totalAmount: transactions.totalAmount,
      day: sql<string>`${transactions.createdAt}::date::text`,
    }).from(transactions).where(and(
      inArray(transactions.shiftId, shiftIds),
      ne(transactions.status, 'VOIDED'),
      sql`${transactions.createdAt}::date >= ${filters.fromDate}::date`,
      sql`${transactions.createdAt}::date <= ${filters.toDate}::date`,
    ));

    const txIds = txRows.map(t => t.id);
    const entryRows = txIds.length > 0
      ? await db.select().from(transactionEntries).where(inArray(transactionEntries.transactionId, txIds))
      : [];
    const entriesByTx = new Map<number, typeof entryRows>();
    for (const e of entryRows) {
      if (!entriesByTx.has(e.transactionId)) entriesByTx.set(e.transactionId, []);
      entriesByTx.get(e.transactionId)!.push(e);
    }

    const partyIds = Array.from(new Set(txRows.map(t => t.partyId)));
    const partyRows = partyIds.length > 0
      ? await db.select({
          id: ledgers.id,
          hissaPercentage: ledgers.hissaPercentage,
          commissionRate: ledgers.commissionRate,
        }).from(ledgers).where(inArray(ledgers.id, partyIds))
      : [];
    const partyById = new Map(partyRows.map(p => [p.id, p]));

    // TPC links (Ledger → Hissa/TPC tab): a party's D-Comm% / A-Comm% paid out to a third
    // party — same source the TPC Report sums, shown here as a cost (negative).
    const tpcLinks = partyIds.length > 0
      ? await db.select({
          ledgerId: ledgerThirdPartyLinks.ledgerId,
          dComm: ledgerThirdPartyLinks.dComm,
          aComm: ledgerThirdPartyLinks.aComm,
        }).from(ledgerThirdPartyLinks).where(and(
          eq(ledgerThirdPartyLinks.linkType, 'TPC'),
          inArray(ledgerThirdPartyLinks.ledgerId, partyIds),
        ))
      : [];
    const tpcPctByParty = new Map<number, { d: number; a: number }>();
    for (const l of tpcLinks) {
      const cur = tpcPctByParty.get(l.ledgerId) || { d: 0, a: 0 };
      cur.d += parseFloat(l.dComm || '0');
      cur.a += parseFloat(l.aComm || '0');
      tpcPctByParty.set(l.ledgerId, cur);
    }

    // Per (shiftId, partyId): raw totals, matching getDailyReport's per-party aggregation
    // exactly before the Comm/Hissa formula is applied.
    const perShiftParty = new Map<string, { shiftId: number; totalSale: number; dSale: number; aSale: number; oDara: number; oAkhar: number; payout: number }>();

    for (const tx of txRows) {
      const key = `${tx.shiftId}:${tx.partyId}`;
      if (!perShiftParty.has(key)) {
        perShiftParty.set(key, { shiftId: tx.shiftId, totalSale: 0, dSale: 0, aSale: 0, oDara: 0, oAkhar: 0, payout: 0 });
      }
      const agg = perShiftParty.get(key)!;
      agg.totalSale += parseFloat(tx.totalAmount);

      const txDateStr = tx.day;
      const declaredNumber = declaredNumberByShiftDate.get(`${tx.shiftId}:${txDateStr}`);
      const tensDigit = declaredNumber?.[0];
      const unitsDigit = declaredNumber?.[1];

      for (const e of entriesByTx.get(tx.id) || []) {
        const amt = parseFloat(e.amount);
        const rate = parseFloat(e.rate);
        if (e.entryType === 'DARA') {
          agg.dSale += amt;
          if (declaredNumber && e.numberValue === declaredNumber) { agg.oDara += amt; agg.payout += amt * rate; }
        } else {
          agg.aSale += amt;
          if (declaredNumber) {
            if (e.entryType === 'HARUF_ANDAR' && e.numberValue === tensDigit) { agg.oAkhar += amt; agg.payout += amt * rate; }
            else if (e.entryType === 'HARUF_BAHAR' && e.numberValue === unitsDigit) { agg.oAkhar += amt; agg.payout += amt * rate; }
          }
        }
      }
    }

    // Sum each party's Comm/Hissa (computed with that party's own rates) up into their shift.
    // Checked against live rows: HIMALAYA 3785 − 378 − 30×90 = 707 → Hissa 50% −353, Closing
    // 353; JAI LUXMI 60545 − 465×90 = 18695 → Hissa −4698, Closing 13996.
    //   Book = Sale + Comm − Payout; Hissa = −Book × S-Hissa%; TPC = −(D-Sale × D-Comm% +
    //   A-Sale × A-Comm%) over the party's TPC links; Closing = Book + Hissa + TPC.
    const perShift = new Map<number, { totalSale: number; dSale: number; aSale: number; comm: number; oDara: number; oAkhar: number; hissa: number; tpc: number; closing: number }>();
    for (const [key, agg] of perShiftParty) {
      const partyId = parseInt(key.split(':')[1], 10);
      const party = partyById.get(partyId);
      const commissionRate = parseFloat(party?.commissionRate || '0');
      const hissaPct = parseFloat(party?.hissaPercentage || '0');
      const comm = -(agg.totalSale * commissionRate / 100);
      const book = agg.totalSale + comm - agg.payout;
      const hissa = -(book * hissaPct / 100);
      const tpcPct = tpcPctByParty.get(partyId);
      const tpc = tpcPct ? -(agg.dSale * tpcPct.d / 100 + agg.aSale * tpcPct.a / 100) : 0;

      if (!perShift.has(agg.shiftId)) {
        perShift.set(agg.shiftId, { totalSale: 0, dSale: 0, aSale: 0, comm: 0, oDara: 0, oAkhar: 0, hissa: 0, tpc: 0, closing: 0 });
      }
      const shiftAgg = perShift.get(agg.shiftId)!;
      shiftAgg.totalSale += agg.totalSale;
      shiftAgg.dSale += agg.dSale;
      shiftAgg.aSale += agg.aSale;
      shiftAgg.comm += comm;
      shiftAgg.oDara += agg.oDara;
      shiftAgg.oAkhar += agg.oAkhar;
      shiftAgg.hissa += hissa;
      shiftAgg.tpc += tpc;
      shiftAgg.closing += book + hissa + tpc;
    }

    const rows = shiftIds
      .filter(id => shiftById.has(id))
      .map(shiftId => {
        const shift = shiftById.get(shiftId)!;
        const agg = perShift.get(shiftId) || { totalSale: 0, dSale: 0, aSale: 0, comm: 0, oDara: 0, oAkhar: 0, hissa: 0, tpc: 0, closing: 0 };
        return {
          shiftId,
          shiftName: shift.name,
          shiftCode: `K-${shift.resultWebShiftId}`,
          totalSale: agg.totalSale,
          dSale: agg.dSale,
          aSale: agg.aSale,
          comm: agg.comm,
          oDara: agg.oDara,
          oAkhar: agg.oAkhar,
          tpc: agg.tpc,
          hissa: agg.hissa,
          closing: agg.closing,
        };
      })
      .sort((a, b) => a.shiftId - b.shiftId);

    const sum = (key: 'totalSale' | 'dSale' | 'aSale' | 'comm' | 'oDara' | 'oAkhar' | 'tpc' | 'hissa' | 'closing') =>
      rows.reduce((s, r) => s + r[key], 0);

    return {
      rows,
      masterTotal: {
        shiftCount: rows.length,
        totalSale: sum('totalSale'),
        dSale: sum('dSale'),
        aSale: sum('aSale'),
        comm: sum('comm'),
        oDara: sum('oDara'),
        oAkhar: sum('oAkhar'),
        tpc: sum('tpc'),
        hissa: sum('hissa'),
        closing: sum('closing'),
      },
    };
  }

  // Party-wise breakdown across ALL shifts for a date range. Powers All Shift Report.
  // Same Comm/Hissa best-effort formula as getDailyReport (see its comment). "Opening" is
  // a real voucher-based balance carried in from before fromDate (reuses
  // VoucherService.getLedgerBalances) — not a fabricated number, but scoped to voucher
  // activity only, same caveat as the Trial Balance family of reports. "Asign"/"Feedback"
  // have no backing data anywhere in this schema and are left for the frontend to render
  // as placeholders rather than invented here. TPC's formula is unresolved, same as Daily Report.
  static async getAllShiftPartyReport(filters: {
    fromDate: string;
    toDate: string;
    agentId?: number;
    groupName?: string;
    partyId?: number;
    search?: string;
    searchMode?: 'START_WITH' | 'CONTAINS';
  }) {
    const txConditions = [
      ne(transactions.status, 'VOIDED'),
      sql`${transactions.createdAt}::date >= ${filters.fromDate}::date`,
      sql`${transactions.createdAt}::date <= ${filters.toDate}::date`,
    ];
    if (filters.partyId) txConditions.push(eq(transactions.partyId, filters.partyId));

    const txRows = await db.select({
      id: transactions.id,
      partyId: transactions.partyId,
      shiftId: transactions.shiftId,
      totalAmount: transactions.totalAmount,
    }).from(transactions).where(and(...txConditions));

    const txIds = txRows.map(t => t.id);
    const entryRows = txIds.length > 0
      ? await db.select().from(transactionEntries).where(inArray(transactionEntries.transactionId, txIds))
      : [];

    const shiftIds = Array.from(new Set(txRows.map(t => t.shiftId)));
    const shiftRows = shiftIds.length > 0
      ? await db.select({ id: shifts.id, declaredNumber: shifts.declaredNumber }).from(shifts).where(inArray(shifts.id, shiftIds))
      : [];
    const declaredByShift = new Map(shiftRows.map(s => [s.id, s.declaredNumber ? s.declaredNumber.padStart(2, '0') : null]));

    const entriesByTx = new Map<number, typeof entryRows>();
    for (const e of entryRows) {
      if (!entriesByTx.has(e.transactionId)) entriesByTx.set(e.transactionId, []);
      entriesByTx.get(e.transactionId)!.push(e);
    }

    const partyIds = Array.from(new Set(txRows.map(t => t.partyId)));
    let partyRows = partyIds.length > 0
      ? await db.select({
          id: ledgers.id,
          partyName: ledgers.partyName,
          mobile: ledgers.mobile,
          agentId: ledgers.agentId,
          groupName: ledgers.groupName,
          betLimit: ledgers.betLimit,
          hissaPercentage: ledgers.hissaPercentage,
          commissionRate: ledgers.commissionRate,
        }).from(ledgers).where(inArray(ledgers.id, partyIds))
      : [];

    if (filters.groupName) partyRows = partyRows.filter(p => p.groupName === filters.groupName);
    if (filters.search && filters.search.trim()) {
      const term = filters.search.trim().toLowerCase();
      partyRows = partyRows.filter(p =>
        filters.searchMode === 'CONTAINS'
          ? p.partyName.toLowerCase().includes(term)
          : p.partyName.toLowerCase().startsWith(term)
      );
    }

    const partyById = new Map(partyRows.map(p => [p.id, p]));
    const validPartyIds = new Set(partyRows.map(p => p.id));

    const agentIds = Array.from(new Set(partyRows.map(p => p.agentId).filter((id): id is number => id != null)));
    const agentRows = agentIds.length > 0
      ? await db.select({ id: agents.id, agentName: agents.agentName }).from(agents).where(inArray(agents.id, agentIds))
      : [];
    const agentNameById = new Map(agentRows.map(a => [a.id, a.agentName]));

    // Opening balance = real voucher-based ledger balance as of the day before fromDate.
    // UTC-anchored throughout, so toISOString()'s date slice matches the intended calendar
    // day regardless of the server's local timezone offset.
    const dayBefore = new Date(`${filters.fromDate}T00:00:00Z`);
    dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
    const openingBalances = await VoucherService.getLedgerBalances({ toDate: dayBefore.toISOString().slice(0, 10) });
    const openingByLedger = new Map(openingBalances.map(b => [b.ledgerId, b.balance]));

    const perParty = new Map<number, { totalSale: number; dSale: number; aSale: number; dOpen: number; aOpen: number }>();

    for (const tx of txRows) {
      if (!validPartyIds.has(tx.partyId)) continue;
      if (filters.agentId) {
        const p = partyById.get(tx.partyId);
        if (!p || p.agentId !== filters.agentId) continue;
      }
      if (!perParty.has(tx.partyId)) perParty.set(tx.partyId, { totalSale: 0, dSale: 0, aSale: 0, dOpen: 0, aOpen: 0 });
      const agg = perParty.get(tx.partyId)!;
      agg.totalSale += parseFloat(tx.totalAmount);

      const declaredNumber = declaredByShift.get(tx.shiftId);
      const tensDigit = declaredNumber?.[0];
      const unitsDigit = declaredNumber?.[1];

      for (const e of entriesByTx.get(tx.id) || []) {
        const amt = parseFloat(e.amount);
        const rate = parseFloat(e.rate);
        if (e.entryType === 'DARA') {
          agg.dSale += amt;
          if (declaredNumber && e.numberValue === declaredNumber) agg.dOpen += amt * rate;
        } else {
          agg.aSale += amt;
          if (declaredNumber) {
            if (e.entryType === 'HARUF_ANDAR' && e.numberValue === tensDigit) agg.aOpen += amt * rate;
            else if (e.entryType === 'HARUF_BAHAR' && e.numberValue === unitsDigit) agg.aOpen += amt * rate;
          }
        }
      }
    }

    const rows = Array.from(perParty.entries()).map(([partyId, agg]) => {
      const party = partyById.get(partyId)!;
      const commissionRate = parseFloat(party.commissionRate || '0');
      const hissaPct = parseFloat(party.hissaPercentage || '0');
      const comm = -(agg.totalSale * commissionRate / 100);
      const hissa = -((agg.totalSale + comm) * hissaPct / 100);

      return {
        partyId,
        partyName: party.partyName,
        mobile: party.mobile || '-',
        agentName: party.agentId ? (agentNameById.get(party.agentId) || '-') : '-',
        limit: parseFloat(party.betLimit || '0'),
        opening: openingByLedger.get(partyId) || 0,
        totalSale: agg.totalSale,
        dSale: agg.dSale,
        aSale: agg.aSale,
        comm,
        dOpen: agg.dOpen,
        aOpen: agg.aOpen,
        tpc: 0,
        hissa,
      };
    }).sort((a, b) => a.partyName.localeCompare(b.partyName));

    return { rows };
  }

  // All Shift Report page (rpt_all_shift) — the live report's full column set, for EVERY
  // ledger (parties with no sale in the range show with zeros, as on the live list).
  // getAllShiftPartyReport above is left untouched: HVS Process builds on its dOpen/hissa.
  // Formulas, checked against the live report's rows (ABDUL, AHAAN 50%, AARIT, AGARTALA):
  //   Comm       = −Total Sale × party Comm%
  //   Dara/Akhar Open = stake on the declared number / its Andar+Bahar haruf (not payout)
  //   Payout     = Σ winning stake × that entry's rate
  //   Book       = (Total Sale + Comm) − Payout
  //   Hissa      = −Book × party S-Hissa%
  //   T-Profit   = Book + Hissa
  //   Kist / HP-Amt / Payment = the ledger's KIST / HAWA_PATTI / CASH vouchers in the range
  //   Rebate     = −T-Profit × party Rebate% when the party lost (T-Profit > 0), else 0
  //   Closing    = Opening + T-Profit + Kist + Rebate + HP-Amt + Payment
  //   DayAv      = days in the range the party had a sale
  static async getAllShiftReport(filters: {
    fromDate: string;
    toDate: string;
    agentId?: number;
    dealing?: string;
    partyStatus?: 'ACTIVE' | 'INACTIVE';
    search?: string;
    searchMode?: 'START_WITH' | 'CONTAINS' | 'END_WITH';
  }) {
    const ledgerConds = [isNull(ledgers.deletedAt)];
    if (filters.agentId) ledgerConds.push(eq(ledgers.agentId, filters.agentId));
    if (filters.dealing) ledgerConds.push(sql`UPPER(COALESCE(${ledgers.dealing}, 'DAILY')) = UPPER(${filters.dealing})`);

    let partyRows = await db.select({
      id: ledgers.id,
      partyName: ledgers.partyName,
      mobile: ledgers.mobile,
      agentId: ledgers.agentId,
      betLimit: ledgers.betLimit,
      hissaPercentage: ledgers.hissaPercentage,
      commissionRate: ledgers.commissionRate,
      rebate: ledgers.rebate,
    }).from(ledgers).where(and(...ledgerConds));

    if (filters.search && filters.search.trim()) {
      const term = filters.search.trim().toLowerCase();
      partyRows = partyRows.filter(p => {
        const name = p.partyName.toLowerCase();
        if (filters.searchMode === 'CONTAINS') return name.includes(term);
        if (filters.searchMode === 'END_WITH') return name.endsWith(term);
        return name.startsWith(term);
      });
    }
    // ALL DEAL dropdown: every Dealing value the ledger master actually uses.
    const dealRows = await db.selectDistinct({ dealing: sql<string>`UPPER(COALESCE(${ledgers.dealing}, 'DAILY'))` })
      .from(ledgers).where(isNull(ledgers.deletedAt));
    const dealOptions = dealRows.map(d => d.dealing).filter(Boolean).sort();

    const partyIds = partyRows.map(p => p.id);
    if (partyIds.length === 0) return { rows: [], dealOptions };

    const txRows = await db.select({
      id: transactions.id,
      partyId: transactions.partyId,
      shiftId: transactions.shiftId,
      totalAmount: transactions.totalAmount,
      day: sql<string>`${transactions.createdAt}::date::text`,
    }).from(transactions).where(and(
      ne(transactions.status, 'VOIDED'),
      inArray(transactions.partyId, partyIds),
      sql`${transactions.createdAt}::date >= ${filters.fromDate}::date`,
      sql`${transactions.createdAt}::date <= ${filters.toDate}::date`,
    ));

    const txIds = txRows.map(t => t.id);
    const entryRows = txIds.length > 0
      ? await db.select().from(transactionEntries).where(inArray(transactionEntries.transactionId, txIds))
      : [];
    const entriesByTx = new Map<number, typeof entryRows>();
    for (const e of entryRows) {
      if (!entriesByTx.has(e.transactionId)) entriesByTx.set(e.transactionId, []);
      entriesByTx.get(e.transactionId)!.push(e);
    }

    const shiftIds = Array.from(new Set(txRows.map(t => t.shiftId)));
    const shiftRows = shiftIds.length > 0
      ? await db.select({ id: shifts.id, declaredNumber: shifts.declaredNumber }).from(shifts).where(inArray(shifts.id, shiftIds))
      : [];
    const declaredByShift = new Map(shiftRows.map(s => [s.id, s.declaredNumber ? s.declaredNumber.padStart(2, '0') : null]));

    const agentIds = Array.from(new Set(partyRows.map(p => p.agentId).filter((id): id is number => id != null)));
    const agentRows = agentIds.length > 0
      ? await db.select({ id: agents.id, agentName: agents.agentName }).from(agents).where(inArray(agents.id, agentIds))
      : [];
    const agentNameById = new Map(agentRows.map(a => [a.id, a.agentName]));

    // Opening: voucher balance up to the day before fromDate — same source/sign (Cr − Dr) as
    // getAllShiftPartyReport's Opening, so the two reports agree.
    const dayBefore = new Date(`${filters.fromDate}T00:00:00Z`);
    dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
    const openingBalances = await VoucherService.getLedgerBalances({ toDate: dayBefore.toISOString().slice(0, 10) });
    const openingByLedger = new Map(openingBalances.map(b => [b.ledgerId, b.balance]));

    // In-range voucher movements per ledger and type, same Cr − Dr sign as Opening.
    const movementRows = await db.select({
      ledgerId: voucherEntries.ledgerId,
      voucherType: vouchers.voucherType,
      net: sql<string>`COALESCE(SUM(CASE WHEN ${voucherEntries.entrySide} = 'CR' THEN ${voucherEntries.amount}::numeric ELSE -${voucherEntries.amount}::numeric END), 0)`,
    })
      .from(voucherEntries)
      .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
      .where(and(
        inArray(voucherEntries.ledgerId, partyIds),
        inArray(vouchers.voucherType, ['KIST', 'HAWA_PATTI', 'CASH_RECEIPT', 'CASH_PAYMENT']),
        sql`${vouchers.createdAt}::date >= ${filters.fromDate}::date`,
        sql`${vouchers.createdAt}::date <= ${filters.toDate}::date`,
      ))
      .groupBy(voucherEntries.ledgerId, vouchers.voucherType);
    const moves = new Map<number, { kist: number; hpAmt: number; payment: number }>();
    for (const m of movementRows) {
      if (!moves.has(m.ledgerId)) moves.set(m.ledgerId, { kist: 0, hpAmt: 0, payment: 0 });
      const mv = moves.get(m.ledgerId)!;
      const amt = parseFloat(m.net);
      if (m.voucherType === 'KIST') mv.kist += amt;
      else if (m.voucherType === 'HAWA_PATTI') mv.hpAmt += amt;
      else mv.payment += amt;
    }

    type Agg = { totalSale: number; dSale: number; aSale: number; dOpen: number; aOpen: number; payout: number; days: Set<string> };
    const perParty = new Map<number, Agg>();
    for (const tx of txRows) {
      if (!perParty.has(tx.partyId)) perParty.set(tx.partyId, { totalSale: 0, dSale: 0, aSale: 0, dOpen: 0, aOpen: 0, payout: 0, days: new Set() });
      const agg = perParty.get(tx.partyId)!;
      agg.totalSale += parseFloat(tx.totalAmount);
      agg.days.add(tx.day);

      const declared = declaredByShift.get(tx.shiftId);
      for (const e of entriesByTx.get(tx.id) || []) {
        const amt = parseFloat(e.amount);
        const rate = parseFloat(e.rate);
        if (e.entryType === 'DARA') {
          agg.dSale += amt;
          if (declared && e.numberValue === declared) { agg.dOpen += amt; agg.payout += amt * rate; }
        } else {
          agg.aSale += amt;
          const wins = declared && (
            (e.entryType === 'HARUF_ANDAR' && e.numberValue === declared[0]) ||
            (e.entryType === 'HARUF_BAHAR' && e.numberValue === declared[1])
          );
          if (wins) { agg.aOpen += amt; agg.payout += amt * rate; }
        }
      }
    }

    let rows = partyRows.map(p => {
      const agg = perParty.get(p.id);
      const totalSale = agg?.totalSale || 0;
      const comm = -(totalSale * parseFloat(p.commissionRate || '0') / 100);
      const book = (totalSale + comm) - (agg?.payout || 0);
      const hissa = -(book * parseFloat(p.hissaPercentage || '0') / 100);
      const tProfit = book + hissa;
      const rebatePct = parseFloat(p.rebate || '0');
      const rebate = tProfit > 0 ? -(tProfit * rebatePct / 100) : 0;
      const mv = moves.get(p.id) || { kist: 0, hpAmt: 0, payment: 0 };
      const opening = openingByLedger.get(p.id) || 0;
      return {
        partyId: p.id,
        partyName: p.partyName,
        mobile: p.mobile || '-',
        agentName: p.agentId ? (agentNameById.get(p.agentId) || '-') : '-',
        limit: parseFloat(p.betLimit || '0'),
        opening,
        totalSale,
        dSale: agg?.dSale || 0,
        aSale: agg?.aSale || 0,
        comm,
        dOpen: agg?.dOpen || 0,
        aOpen: agg?.aOpen || 0,
        tpc: 0,
        hissa,
        tProfit,
        kist: mv.kist,
        rebate,
        hpAmt: mv.hpAmt,
        payment: mv.payment,
        closing: opening + tProfit + mv.kist + rebate + mv.hpAmt + mv.payment,
        dayAv: agg?.days.size || 0,
      };
    });

    // ACTIVE = had a sale in the range; INACTIVE = didn't.
    if (filters.partyStatus === 'ACTIVE') rows = rows.filter(r => r.dayAv > 0);
    else if (filters.partyStatus === 'INACTIVE') rows = rows.filter(r => r.dayAv === 0);

    rows.sort((a, b) => a.partyName.localeCompare(b.partyName));
    return { rows, dealOptions };
  }

  // TPC Report (rpt_tpc): Third Party Commission earned by each party named in a ledger's
  // TPC links (Ledger master → Hissa/TPC tab: party, D-Comm %, A-Comm %).
  //   TPC for one link = that ledger's Dara Sale × D-Comm% + Akhar Sale × A-Comm% in the range
  //   Row per receiving party = Σ its links; Agent = the receiving party's own agent.
  static async getTpcReport(filters: { fromDate: string; toDate: string }) {
    const links = await db.select({
      ledgerId: ledgerThirdPartyLinks.ledgerId,
      partyName: ledgerThirdPartyLinks.partyName,
      dComm: ledgerThirdPartyLinks.dComm,
      aComm: ledgerThirdPartyLinks.aComm,
    })
      .from(ledgerThirdPartyLinks)
      .innerJoin(ledgers, eq(ledgerThirdPartyLinks.ledgerId, ledgers.id))
      .where(and(eq(ledgerThirdPartyLinks.linkType, 'TPC'), isNull(ledgers.deletedAt)));
    if (links.length === 0) return { rows: [] };

    const sourceIds = Array.from(new Set(links.map(l => l.ledgerId)));
    const sales = await db.select({
      partyId: transactions.partyId,
      dSale: sql<string>`COALESCE(SUM(CASE WHEN ${transactionEntries.entryType} = 'DARA' THEN ${transactionEntries.amount}::numeric ELSE 0 END), 0)`,
      aSale: sql<string>`COALESCE(SUM(CASE WHEN ${transactionEntries.entryType} <> 'DARA' THEN ${transactionEntries.amount}::numeric ELSE 0 END), 0)`,
    })
      .from(transactionEntries)
      .innerJoin(transactions, eq(transactionEntries.transactionId, transactions.id))
      .where(and(
        inArray(transactions.partyId, sourceIds),
        ne(transactions.status, 'VOIDED'),
        sql`${transactions.createdAt}::date >= ${filters.fromDate}::date`,
        sql`${transactions.createdAt}::date <= ${filters.toDate}::date`,
      ))
      .groupBy(transactions.partyId);
    const saleByLedger = new Map(sales.map(s => [s.partyId, { d: parseFloat(s.dSale), a: parseFloat(s.aSale) }]));

    const byReceiver = new Map<string, { partyName: string; amount: number }>();
    for (const l of links) {
      const sale = saleByLedger.get(l.ledgerId);
      if (!sale) continue;
      const amount = sale.d * parseFloat(l.dComm || '0') / 100 + sale.a * parseFloat(l.aComm || '0') / 100;
      if (!amount) continue;
      const key = l.partyName.trim().toUpperCase();
      if (!byReceiver.has(key)) byReceiver.set(key, { partyName: l.partyName.trim(), amount: 0 });
      byReceiver.get(key)!.amount += amount;
    }
    if (byReceiver.size === 0) return { rows: [] };

    // Receiving party's agent, looked up by its ledger name.
    const receiverLedgers = await db.select({ partyName: ledgers.partyName, agentName: agents.agentName })
      .from(ledgers)
      .leftJoin(agents, eq(ledgers.agentId, agents.id))
      .where(inArray(sql`UPPER(${ledgers.partyName})`, Array.from(byReceiver.keys())));
    const agentByName = new Map(receiverLedgers.map(r => [r.partyName.toUpperCase(), r.agentName || '-']));

    const rows = Array.from(byReceiver.entries())
      .map(([key, r]) => ({ partyName: r.partyName, amount: r.amount, agentName: agentByName.get(key) || '-' }))
      .sort((a, b) => a.partyName.localeCompare(b.partyName));
    return { rows };
  }

  // Party's game result per DECLARED shift cycle (shift_cycles holds each cycle's date and
  // winning number): P&L = (Sale + Comm − Payout) + Hissa, with the party's Comm% / S-Hissa%
  // — the same formula Settling / Profit & Loss use. Positive = party lost (Dr to party).
  // fromDate/toDate are inclusive cycle dates; either may be left out.
  private static async getPartyCyclePnl(
    party: { id: number; commissionRate: string | null; hissaPercentage: string | null },
    range: { fromDate?: string; toDate?: string }
  ) {
    const conds = [eq(transactions.partyId, party.id), ne(transactions.status, 'VOIDED')];
    if (range.fromDate) conds.push(sql`${transactions.createdAt}::date >= ${range.fromDate}::date`);
    if (range.toDate) conds.push(sql`${transactions.createdAt}::date <= ${range.toDate}::date`);
    const txRows = await db.select({
      id: transactions.id,
      shiftId: transactions.shiftId,
      totalAmount: transactions.totalAmount,
      day: sql<string>`${transactions.createdAt}::date::text`,
    }).from(transactions).where(and(...conds));
    if (txRows.length === 0) return [];

    const shiftIds = Array.from(new Set(txRows.map(t => t.shiftId)));
    const cycles = await db.select({
      shiftId: shiftCycles.shiftId,
      cycleDate: shiftCycles.cycleDate,
      declaredNumber: shiftCycles.declaredNumber,
      updatedAt: shiftCycles.updatedAt,
      shiftName: shifts.name,
    })
      .from(shiftCycles)
      .innerJoin(shifts, eq(shiftCycles.shiftId, shifts.id))
      .where(and(
        inArray(shiftCycles.shiftId, shiftIds),
        sql`${shiftCycles.status} IN ('DECLARED', 'AUDITED')`,
        sql`${shiftCycles.declaredNumber} IS NOT NULL`,
      ));
    const cycleByKey = new Map(cycles.map(c => [`${c.shiftId}:${c.cycleDate}`, c]));

    const txIds = txRows.map(t => t.id);
    const entryRows = await db.select().from(transactionEntries).where(inArray(transactionEntries.transactionId, txIds));
    const entriesByTx = new Map<number, typeof entryRows>();
    for (const e of entryRows) {
      if (!entriesByTx.has(e.transactionId)) entriesByTx.set(e.transactionId, []);
      entriesByTx.get(e.transactionId)!.push(e);
    }

    const commPct = parseFloat(party.commissionRate || '0');
    const hissaPct = parseFloat(party.hissaPercentage || '0');
    const perCycle = new Map<string, { sale: number; payout: number }>();
    for (const tx of txRows) {
      const key = `${tx.shiftId}:${tx.day}`;
      const cycle = cycleByKey.get(key);
      if (!cycle) continue; // not declared yet — no result to post
      const declared = cycle.declaredNumber!.padStart(2, '0');
      if (!perCycle.has(key)) perCycle.set(key, { sale: 0, payout: 0 });
      const agg = perCycle.get(key)!;
      agg.sale += parseFloat(tx.totalAmount);
      for (const e of entriesByTx.get(tx.id) || []) {
        const wins = (e.entryType === 'DARA' && e.numberValue === declared)
          || (e.entryType === 'HARUF_ANDAR' && e.numberValue === declared[0])
          || (e.entryType === 'HARUF_BAHAR' && e.numberValue === declared[1]);
        if (wins) agg.payout += parseFloat(e.amount) * parseFloat(e.rate);
      }
    }

    return Array.from(perCycle.entries()).map(([key, agg]) => {
      const cycle = cycleByKey.get(key)!;
      const comm = -(agg.sale * commPct / 100);
      const book = agg.sale + comm - agg.payout;
      const pnl = book - (book * hissaPct / 100);
      return { shiftName: cycle.shiftName, cycleDate: cycle.cycleDate, postedAt: cycle.updatedAt, pnl };
    });
  }

  // Party's ledger balance BEFORE a date, Dr − Cr (positive = party owes): every voucher plus
  // every declared cycle's game result dated earlier.
  private static async getPartyBalanceBefore(
    party: { id: number; commissionRate: string | null; hissaPercentage: string | null },
    beforeDate: string
  ) {
    const [v] = await db.select({
      net: sql<string>`COALESCE(SUM(CASE WHEN ${voucherEntries.entrySide} = 'DR' THEN ${voucherEntries.amount}::numeric ELSE -${voucherEntries.amount}::numeric END), 0)`,
    })
      .from(voucherEntries)
      .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
      .where(and(eq(voucherEntries.ledgerId, party.id), sql`${vouchers.createdAt}::date < ${beforeDate}::date`));
    const dayBefore = new Date(`${beforeDate}T00:00:00Z`);
    dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
    const game = await this.getPartyCyclePnl(party, { toDate: dayBefore.toISOString().slice(0, 10) });
    return parseFloat(v?.net || '0') + game.reduce((s, g) => s + g.pnl, 0);
  }

  // Admin Cash (rpt_admin_cash): one party's statement for a date range —
  //   OPENING row (balance before fromDate), then every entry in date/time order:
  //     • each declared shift cycle's game result, named after the shift, by SERVER
  //     • every voucher on the party (payments from this page, journals, kist, …)
  //   Credit / Debit per entry, running Balance (Dr − Cr; shown as "… Cr" when negative),
  //   and OPENING / CURRENT (period movement) / CLOSING plus the party's current BAL.
  static async getAdminCash(filters: { partyId: number; fromDate: string; toDate: string }) {
    const [party] = await db.select().from(ledgers).where(eq(ledgers.id, filters.partyId));
    if (!party) throw new NotFoundError('Party not found');

    let agentName = '-';
    if (party.agentId) {
      const [agent] = await db.select().from(agents).where(eq(agents.id, party.agentId));
      if (agent) agentName = agent.agentName;
    }
    const commPctLabel = Math.round(parseFloat(party.commissionRate || '0'));
    const rate = `${Math.round(parseFloat(party.daraRate))}/${commPctLabel} | ${Math.round(parseFloat(party.akharRate))}/${commPctLabel}`;

    const opening = await this.getPartyBalanceBefore(party, filters.fromDate);

    type Entry = { date: string; at: Date; partyName: string; credit: number; debit: number; remark: string; updatedBy: string; voucherId: number | null; deletable: boolean };
    const entries: Entry[] = [];

    for (const g of await this.getPartyCyclePnl(party, filters)) {
      entries.push({
        date: g.cycleDate,
        at: g.postedAt,
        partyName: g.shiftName,
        credit: g.pnl < 0 ? -g.pnl : 0,
        debit: g.pnl > 0 ? g.pnl : 0,
        remark: '',
        updatedBy: 'SERVER',
        voucherId: null,
        deletable: false,
      });
    }

    const myEntries = await db.select({
      voucherId: vouchers.id,
      voucherType: vouchers.voucherType,
      narration: vouchers.narration,
      updatedBy: vouchers.updatedBy,
      createdAt: vouchers.createdAt,
      updatedAt: vouchers.updatedAt,
      day: sql<string>`${vouchers.createdAt}::date::text`,
      entrySide: voucherEntries.entrySide,
      amount: voucherEntries.amount,
      entryId: voucherEntries.id,
    })
      .from(voucherEntries)
      .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
      .where(and(
        eq(voucherEntries.ledgerId, party.id),
        sql`${vouchers.createdAt}::date >= ${filters.fromDate}::date`,
        sql`${vouchers.createdAt}::date <= ${filters.toDate}::date`,
      ));
    // Name each voucher line after the other side of the voucher (e.g. KIST A/C); a
    // single-sided cash entry reads CASH.
    const vIds = Array.from(new Set(myEntries.map(e => e.voucherId)));
    const otherSides = vIds.length > 0
      ? await db.select({ voucherId: voucherEntries.voucherId, ledgerId: voucherEntries.ledgerId, partyName: ledgers.partyName })
          .from(voucherEntries)
          .innerJoin(ledgers, eq(voucherEntries.ledgerId, ledgers.id))
          .where(inArray(voucherEntries.voucherId, vIds))
      : [];
    for (const e of myEntries) {
      const other = otherSides.find(o => o.voucherId === e.voucherId && o.ledgerId !== party.id);
      const amt = parseFloat(e.amount);
      const isCash = e.voucherType === 'CASH_RECEIPT' || e.voucherType === 'CASH_PAYMENT';
      entries.push({
        date: e.day,
        at: e.createdAt,
        partyName: other?.partyName || (isCash ? 'CASH' : e.voucherType),
        credit: e.entrySide === 'CR' ? amt : 0,
        debit: e.entrySide === 'DR' ? amt : 0,
        remark: e.narration || '',
        updatedBy: e.updatedBy || 'SYSTEM',
        voucherId: e.voucherId,
        deletable: isCash,
      });
    }

    entries.sort((a, b) => a.date.localeCompare(b.date) || a.at.getTime() - b.at.getTime());

    let running = opening;
    const rows = entries.map(e => {
      running += e.debit - e.credit;
      return {
        date: e.date,
        partyName: e.partyName,
        credit: e.credit,
        debit: e.debit,
        balance: running,
        remark: e.remark,
        updatedBy: e.updatedBy,
        updatedAt: e.at.toISOString(),
        voucherId: e.voucherId,
        deletable: e.deletable,
      };
    });

    const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
    const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    const currentBalance = await this.getPartyBalanceBefore(party, tomorrowStr);

    return {
      partyId: party.id,
      partyName: party.partyName,
      agentName,
      rate,
      balance: currentBalance,
      limit: parseFloat(party.betLimit || '0'),
      opening,
      current: totalDebit - totalCredit,
      closing: running,
      totalCredit,
      totalDebit,
      rows,
    };
  }

  // Trail Balance Report (rpt_trail_balance): every active ledger's balance as of a date, split
  // into a Credit list (balance Cr) and a Debit list (balance Dr), each A-Z with the ledger's
  // LIMIT underneath the name.
  //   Balance = vouchers up to the date (Dr − Cr, LIMIT vouchers left out — they're the LIMIT
  //             line) + every declared cycle's game result up to the date, with the party's
  //             Comm% / S-Hissa%: ((Sale − Sale×Comm%) − Payout) × (1 − S-Hissa%) — the same
  //             result Admin Cash posts as its SERVER rows.
  //   LIMIT   = the ledger's LIMIT vouchers up to the date (Dr − Cr, shown as a plain number).
  static async getTrialBalance(filters: { asOfDate: string }) {
    const all = await this.getLedgerBalancesAsOf(filters.asOfDate);
    const rows = all
      .map(l => ({ ledgerId: l.ledgerId, partyName: l.partyName, balance: l.balance, limit: l.limit }))
      .sort((a, b) => a.partyName.localeCompare(b.partyName));
    // Settled-to-zero ledgers don't appear on either side.
    const credit = rows.filter(r => Math.round(r.balance) < 0).map(r => ({ ...r, amount: -r.balance }));
    const debit = rows.filter(r => Math.round(r.balance) > 0).map(r => ({ ...r, amount: r.balance }));
    return {
      credit,
      debit,
      totalCredit: credit.reduce((s, r) => s + r.amount, 0),
      totalDebit: debit.reduce((s, r) => s + r.amount, 0),
    };
  }

  // Every active ledger's balance as of a date (the Trail Balance / OutStanding figure):
  // vouchers Dr − Cr (LIMIT vouchers returned separately as `limit`) + every declared cycle's
  // game result with the party's Comm% / S-Hissa%.
  private static async getLedgerBalancesAsOf(asOf: string) {
    const ledgerRows = await db.select({
      id: ledgers.id,
      partyName: ledgers.partyName,
      agentId: ledgers.agentId,
      commissionRate: ledgers.commissionRate,
      hissaPercentage: ledgers.hissaPercentage,
    }).from(ledgers).where(isNull(ledgers.deletedAt));

    const voucherRows = await pgSql<Array<{ ledger_id: number; is_limit: boolean; net: string }>>`
      SELECT e.ledger_id, (v.voucher_type = 'LIMIT') AS is_limit,
             SUM(CASE WHEN e.entry_side = 'DR' THEN e.amount ELSE -e.amount END) AS net
      FROM voucher_entries e
      JOIN vouchers v ON v.id = e.voucher_id
      WHERE v.created_at::date <= ${asOf}::date
      GROUP BY e.ledger_id, (v.voucher_type = 'LIMIT')
    `;

    // Sale and winning payout per party per declared cycle, both up to the date.
    const saleRows = await pgSql<Array<{ party_id: number; shift_id: number; day: string; sale: string }>>`
      SELECT t.party_id, t.shift_id, t.created_at::date::text AS day, SUM(t.total_amount) AS sale
      FROM transactions t
      JOIN shift_cycles c ON c.shift_id = t.shift_id AND c.cycle_date = t.created_at::date::text
      WHERE t.status <> 'VOIDED' AND t.created_at::date <= ${asOf}::date
        AND c.status IN ('DECLARED', 'AUDITED') AND c.declared_number IS NOT NULL
      GROUP BY t.party_id, t.shift_id, t.created_at::date
    `;
    const payoutRows = await pgSql<Array<{ party_id: number; shift_id: number; day: string; payout: string }>>`
      SELECT t.party_id, t.shift_id, t.created_at::date::text AS day, SUM(e.amount * e.rate) AS payout
      FROM transaction_entries e
      JOIN transactions t ON t.id = e.transaction_id
      JOIN shift_cycles c ON c.shift_id = t.shift_id AND c.cycle_date = t.created_at::date::text
      WHERE t.status <> 'VOIDED' AND t.created_at::date <= ${asOf}::date
        AND c.status IN ('DECLARED', 'AUDITED') AND c.declared_number IS NOT NULL
        AND (
          (e.entry_type = 'DARA' AND e.number_value = lpad(c.declared_number, 2, '0'))
          OR (e.entry_type = 'HARUF_ANDAR' AND e.number_value = substr(lpad(c.declared_number, 2, '0'), 1, 1))
          OR (e.entry_type = 'HARUF_BAHAR' AND e.number_value = substr(lpad(c.declared_number, 2, '0'), 2, 1))
        )
      GROUP BY t.party_id, t.shift_id, t.created_at::date
    `;

    const balance = new Map<number, number>();
    const limit = new Map<number, number>();
    for (const v of voucherRows) {
      const target = v.is_limit ? limit : balance;
      target.set(v.ledger_id, (target.get(v.ledger_id) || 0) + parseFloat(v.net));
    }

    const ledgerById = new Map(ledgerRows.map(l => [l.id, l]));
    const payoutByKey = new Map(payoutRows.map(p => [`${p.party_id}:${p.shift_id}:${p.day}`, parseFloat(p.payout)]));
    for (const s of saleRows) {
      const l = ledgerById.get(s.party_id);
      if (!l) continue;
      const sale = parseFloat(s.sale);
      const payout = payoutByKey.get(`${s.party_id}:${s.shift_id}:${s.day}`) || 0;
      const book = sale - sale * parseFloat(l.commissionRate || '0') / 100 - payout;
      const pnl = book - book * parseFloat(l.hissaPercentage || '0') / 100;
      balance.set(l.id, (balance.get(l.id) || 0) + pnl);
    }

    return ledgerRows.map(l => ({
      ledgerId: l.id,
      partyName: l.partyName,
      agentId: l.agentId,
      balance: balance.get(l.id) || 0,
      limit: limit.get(l.id) || 0,
    }));
  }

  // OutStanding Report (rpt_agent_outstanding): parties under the chosen agent groups (agents
  // master rows — the "Group"), each with its balance as of the date on the Credit side (Cr)
  // or the Debit side (Dr). Same balance as Trail Balance. Final = Σ Debit − Σ Credit.
  static async getOutstandingReport(filters: { asOfDate: string; agentIds: number[] }) {
    if (filters.agentIds.length === 0) return { rows: [], totalCredit: 0, totalDebit: 0, final: 0 };
    const groupRows = await db.select({ id: agents.id, agentName: agents.agentName })
      .from(agents).where(inArray(agents.id, filters.agentIds));
    const groupName = new Map(groupRows.map(g => [g.id, g.agentName]));

    const all = await this.getLedgerBalancesAsOf(filters.asOfDate);
    const rows = all
      .filter(l => l.agentId != null && groupName.has(l.agentId) && Math.round(l.balance) !== 0)
      .map(l => ({
        ledgerId: l.ledgerId,
        partyName: l.partyName,
        agentGroup: groupName.get(l.agentId!) || '-',
        credit: l.balance < 0 ? -l.balance : 0,
        debit: l.balance > 0 ? l.balance : 0,
      }))
      .sort((a, b) => a.partyName.localeCompare(b.partyName));
    const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
    const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
    return { rows, totalCredit, totalDebit, final: totalDebit - totalCredit };
  }

  // ---------------------------------------------------------------------------------------
  // Vapsi Voucher (vapsi_vouchers) — a month's rebate given back to parties.
  //   Per party for the month (declared cycles only, party's own Comm% / S-Hissa%):
  //     T-Sale  = sale            W-Day  = days with a sale
  //     P&L     = Σ (Sale + Comm − Payout)            (positive = party lost)
  //     HP-Amt  = −P&L × S-Hissa%                     Final-PL = P&L + HP-Amt
  //     Payment = month's cash entries, Cr − Dr        (money received from the party)
  //     Vapsi%  = ledger "Vapsi | TPR" first figure    TPR YES → its 3rd Party Rebate (TPV) links apply
  //     Vapsi-Amt = base × Vapsi%, base = Final-PL (or Payment when "On Base"), only when > 0
  //   A month is "DONE" for a party once a VAPSI voucher narrated "<Month> <Year>" exists.
  static readonly VAPSI_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  private static monthRange(month: number, year: number) {
    const pad = (n: number) => String(n).padStart(2, '0');
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(last)}` };
  }

  static async getVapsiSummary(filters: { month: number; year: number; agentId?: number; partyId?: number; withHp?: boolean; onBase?: boolean }) {
    if (!(filters.month >= 1 && filters.month <= 12) || !(filters.year > 2000)) throw new AppError('Please select a valid Month and Year!');
    const { from, to } = this.monthRange(filters.month, filters.year);
    const narration = `${this.VAPSI_MONTHS[filters.month - 1]} ${filters.year}`;

    const ledgerConds = [isNull(ledgers.deletedAt)];
    if (filters.agentId) ledgerConds.push(eq(ledgers.agentId, filters.agentId));
    if (filters.partyId) ledgerConds.push(eq(ledgers.id, filters.partyId));
    const ledgerRows = await db.select({
      id: ledgers.id,
      partyName: ledgers.partyName,
      agentName: agents.agentName,
      commissionRate: ledgers.commissionRate,
      hissaPercentage: ledgers.hissaPercentage,
      vapsiTpr: ledgers.vapsiTpr,
    }).from(ledgers).leftJoin(agents, eq(ledgers.agentId, agents.id)).where(and(...ledgerConds));

    const saleRows = await pgSql<Array<{ party_id: number; shift_id: number; day: string; sale: string }>>`
      SELECT t.party_id, t.shift_id, t.created_at::date::text AS day, SUM(t.total_amount) AS sale
      FROM transactions t
      JOIN shift_cycles c ON c.shift_id = t.shift_id AND c.cycle_date = t.created_at::date::text
      WHERE t.status <> 'VOIDED' AND t.created_at::date BETWEEN ${from}::date AND ${to}::date
        AND c.status IN ('DECLARED', 'AUDITED') AND c.declared_number IS NOT NULL
      GROUP BY t.party_id, t.shift_id, t.created_at::date
    `;
    const payoutRows = await pgSql<Array<{ party_id: number; shift_id: number; day: string; payout: string }>>`
      SELECT t.party_id, t.shift_id, t.created_at::date::text AS day, SUM(e.amount * e.rate) AS payout
      FROM transaction_entries e
      JOIN transactions t ON t.id = e.transaction_id
      JOIN shift_cycles c ON c.shift_id = t.shift_id AND c.cycle_date = t.created_at::date::text
      WHERE t.status <> 'VOIDED' AND t.created_at::date BETWEEN ${from}::date AND ${to}::date
        AND c.status IN ('DECLARED', 'AUDITED') AND c.declared_number IS NOT NULL
        AND (
          (e.entry_type = 'DARA' AND e.number_value = lpad(c.declared_number, 2, '0'))
          OR (e.entry_type = 'HARUF_ANDAR' AND e.number_value = substr(lpad(c.declared_number, 2, '0'), 1, 1))
          OR (e.entry_type = 'HARUF_BAHAR' AND e.number_value = substr(lpad(c.declared_number, 2, '0'), 2, 1))
        )
      GROUP BY t.party_id, t.shift_id, t.created_at::date
    `;
    const paymentRows = await pgSql<Array<{ ledger_id: number; net: string }>>`
      SELECT e.ledger_id, SUM(CASE WHEN e.entry_side = 'CR' THEN e.amount ELSE -e.amount END) AS net
      FROM voucher_entries e JOIN vouchers v ON v.id = e.voucher_id
      WHERE v.voucher_type IN ('CASH_RECEIPT', 'CASH_PAYMENT') AND v.created_at::date BETWEEN ${from}::date AND ${to}::date
      GROUP BY e.ledger_id
    `;
    const doneRows = await pgSql<Array<{ ledger_id: number }>>`
      SELECT DISTINCT e.ledger_id FROM voucher_entries e JOIN vouchers v ON v.id = e.voucher_id
      WHERE v.voucher_type = 'VAPSI' AND e.entry_side = 'CR' AND v.narration = ${narration}
    `;
    const tpvRows = await db.select({
      ledgerId: ledgerThirdPartyLinks.ledgerId,
      partyName: ledgerThirdPartyLinks.partyName,
      percent: ledgerThirdPartyLinks.percent,
    }).from(ledgerThirdPartyLinks).where(eq(ledgerThirdPartyLinks.linkType, 'TPV'));
    const hissaTargets = await db.selectDistinct({ name: sql<string>`UPPER(${ledgerThirdPartyLinks.partyName})` })
      .from(ledgerThirdPartyLinks).where(eq(ledgerThirdPartyLinks.linkType, 'HISSA'));
    const hpNames = new Set(hissaTargets.map(h => h.name));
    const nameToId = new Map((await db.select({ id: ledgers.id, n: ledgers.partyName }).from(ledgers).where(isNull(ledgers.deletedAt)))
      .map(l => [l.n.toUpperCase(), l.id]));

    const payoutByKey = new Map(payoutRows.map(p => [`${p.party_id}:${p.shift_id}:${p.day}`, parseFloat(p.payout)]));
    const ledgerById = new Map(ledgerRows.map(l => [l.id, l]));
    const agg = new Map<number, { sale: number; pnl: number; days: Set<string> }>();
    for (const s of saleRows) {
      const l = ledgerById.get(s.party_id);
      if (!l) continue;
      const sale = parseFloat(s.sale);
      const book = sale - sale * parseFloat(l.commissionRate || '0') / 100 - (payoutByKey.get(`${s.party_id}:${s.shift_id}:${s.day}`) || 0);
      const a = agg.get(l.id) || { sale: 0, pnl: 0, days: new Set<string>() };
      a.sale += sale;
      a.pnl += book;
      a.days.add(s.day);
      agg.set(l.id, a);
    }
    const payment = new Map(paymentRows.map(p => [p.ledger_id, parseFloat(p.net)]));
    const done = new Set(doneRows.map(d => d.ledger_id));

    const rows = ledgerRows
      .filter(l => filters.withHp || !hpNames.has(l.partyName.toUpperCase()))
      .map(l => {
        const a = agg.get(l.id) || { sale: 0, pnl: 0, days: new Set<string>() };
        const hissaPct = parseFloat(l.hissaPercentage || '0');
        const hpAmt = -(a.pnl * hissaPct / 100);
        const finalPl = a.pnl + hpAmt;
        const pay = payment.get(l.id) || 0;
        const [vapsiRaw, tprRaw] = String(l.vapsiTpr || '0 | NO').split('|').map(x => x.trim());
        const vapsiPct = parseFloat(vapsiRaw) || 0;
        const tpr = (tprRaw || '').toUpperCase() === 'YES';
        const vapsiBase = filters.onBase ? pay : finalPl;
        const links = tpr
          ? tpvRows.filter(t => t.ledgerId === l.id).map(t => ({
              partyName: t.partyName,
              ledgerId: nameToId.get(t.partyName.toUpperCase()) || null,
              percent: parseFloat(t.percent || '0'),
            }))
          : [];
        return {
          partyId: l.id,
          partyName: l.partyName,
          agentName: l.agentName || '-',
          tpv: links.reduce((s, t) => s + t.percent, 0),
          wDay: a.days.size,
          tSale: a.sale,
          pnl: a.pnl,
          hissaPct,
          hpAmt,
          finalPl,
          payment: pay,
          vapsiPct,
          vapsiAmt: vapsiBase > 0 ? vapsiBase * vapsiPct / 100 : 0,
          done: done.has(l.id),
          thirdParties: links,
        };
      })
      .filter(r => filters.partyId || r.tSale !== 0 || r.payment !== 0)
      .sort((a, b) => a.partyName.localeCompare(b.partyName));
    return { month: filters.month, year: filters.year, narration, rows };
  }

  private static async getOrCreateLedger(name: string): Promise<number> {
    const [existing] = await db.select({ id: ledgers.id }).from(ledgers).where(eq(ledgers.partyName, name));
    if (existing) return existing.id;
    await db.insert(ledgers).values({ partyName: name }).onConflictDoNothing();
    const [created] = await db.select({ id: ledgers.id }).from(ledgers).where(eq(ledgers.partyName, name));
    return created.id;
  }

  // Posts Vapsi: each item's party Cr / VAPSI A/C Dr, plus each 3rd party's share the same
  // way, all dated voucherDate and narrated "<Month> <Year>" (how a month is marked DONE).
  static async processVapsi(data: {
    month: number;
    year: number;
    voucherDate: string;
    items: { partyId: number; amount: number; thirdParties?: { ledgerId: number; amount: number }[] }[];
  }, user: UserSession) {
    if (!(data.month >= 1 && data.month <= 12) || !(data.year > 2000)) throw new AppError('Please select a valid Month and Year!');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.voucherDate || '')) throw new AppError('Please select Voucher Date!');
    const lines: { ledgerId: number; amount: number }[] = [];
    for (const it of data.items || []) {
      if (Number(it.amount) > 0) lines.push({ ledgerId: Number(it.partyId), amount: Number(it.amount) });
      for (const t of it.thirdParties || []) {
        if (t.ledgerId && Number(t.amount) > 0) lines.push({ ledgerId: Number(t.ledgerId), amount: Number(t.amount) });
      }
    }
    if (lines.length === 0) throw new AppError('Please tick at least one party with a Vapsi amount!');

    const vapsiLedgerId = await this.getOrCreateLedger('VAPSI A/C');
    const narration = `${this.VAPSI_MONTHS[data.month - 1]} ${data.year}`;
    const createdAt = new Date(`${data.voucherDate}T12:00:00`);

    await db.transaction(async (tx) => {
      for (const line of lines) {
        const [voucher] = await tx.insert(vouchers).values({
          voucherNumber: `VOUCH-VAPSI-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
          voucherType: 'VAPSI',
          totalAmount: line.amount.toFixed(2),
          narration,
          createdBy: user.userId,
          updatedBy: user.username || 'SYSTEM',
          createdAt,
        }).returning();
        await tx.insert(voucherEntries).values([
          { voucherId: voucher.id, ledgerId: line.ledgerId, entrySide: 'CR', amount: line.amount.toFixed(2) },
          { voucherId: voucher.id, ledgerId: vapsiLedgerId, entrySide: 'DR', amount: line.amount.toFixed(2) },
        ]);
      }
    });
    return { posted: lines.length, totalAmount: lines.reduce((s, l) => s + l.amount, 0) };
  }

  // ---------------------------------------------------------------------------------------
  // Hawa Patti (hawa_patti_vouchers) — a party's month result shared out through its Hissa link
  // to the system account "HP A/C" (Ledger → Re-Config → Hissa Party = HP A/C, with a %).
  //   IsHP     = the party has that HP A/C Hissa link       HP % = that link's percent
  //   HP Party = the party's "HP Ledger" (Info tab), or the party itself when not set
  //   P&L      = Σ (Sale + Comm − Payout) over the month's declared cycles  (On Base: Sale − Payout)
  //   HP-Amt   = P&L × HP %  — posted HP Party Cr / HP A/C Dr when positive, the reverse when not
  static readonly HP_ACCOUNT = 'HP A/C';

  static async getHawaPattiSummary(filters: { month: number; year: number; agentId?: number; onBase?: boolean }) {
    if (!(filters.month >= 1 && filters.month <= 12) || !(filters.year > 2000)) throw new AppError('Please select a valid Month and Year!');
    const { from, to } = this.monthRange(filters.month, filters.year);

    const ledgerConds = [isNull(ledgers.deletedAt)];
    if (filters.agentId) ledgerConds.push(eq(ledgers.agentId, filters.agentId));
    const ledgerRows = await db.select({
      id: ledgers.id,
      partyName: ledgers.partyName,
      agentName: agents.agentName,
      commissionRate: ledgers.commissionRate,
      hpLedgerId: ledgers.hpLedgerId,
    }).from(ledgers).leftJoin(agents, eq(ledgers.agentId, agents.id)).where(and(...ledgerConds));

    const hpLinks = await db.select({ ledgerId: ledgerThirdPartyLinks.ledgerId, percent: ledgerThirdPartyLinks.percent })
      .from(ledgerThirdPartyLinks)
      .where(and(eq(ledgerThirdPartyLinks.linkType, 'HISSA'), sql`UPPER(TRIM(${ledgerThirdPartyLinks.partyName})) = ${this.HP_ACCOUNT}`));
    const hpPct = new Map<number, number>();
    for (const l of hpLinks) hpPct.set(l.ledgerId, (hpPct.get(l.ledgerId) || 0) + parseFloat(l.percent || '0'));

    const nameById = new Map((await db.select({ id: ledgers.id, n: ledgers.partyName }).from(ledgers)).map(l => [l.id, l.n]));

    const saleRows = await pgSql<Array<{ party_id: number; shift_id: number; day: string; sale: string }>>`
      SELECT t.party_id, t.shift_id, t.created_at::date::text AS day, SUM(t.total_amount) AS sale
      FROM transactions t
      JOIN shift_cycles c ON c.shift_id = t.shift_id AND c.cycle_date = t.created_at::date::text
      WHERE t.status <> 'VOIDED' AND t.created_at::date BETWEEN ${from}::date AND ${to}::date
        AND c.status IN ('DECLARED', 'AUDITED') AND c.declared_number IS NOT NULL
      GROUP BY t.party_id, t.shift_id, t.created_at::date
    `;
    const payoutRows = await pgSql<Array<{ party_id: number; shift_id: number; day: string; payout: string }>>`
      SELECT t.party_id, t.shift_id, t.created_at::date::text AS day, SUM(e.amount * e.rate) AS payout
      FROM transaction_entries e
      JOIN transactions t ON t.id = e.transaction_id
      JOIN shift_cycles c ON c.shift_id = t.shift_id AND c.cycle_date = t.created_at::date::text
      WHERE t.status <> 'VOIDED' AND t.created_at::date BETWEEN ${from}::date AND ${to}::date
        AND c.status IN ('DECLARED', 'AUDITED') AND c.declared_number IS NOT NULL
        AND (
          (e.entry_type = 'DARA' AND e.number_value = lpad(c.declared_number, 2, '0'))
          OR (e.entry_type = 'HARUF_ANDAR' AND e.number_value = substr(lpad(c.declared_number, 2, '0'), 1, 1))
          OR (e.entry_type = 'HARUF_BAHAR' AND e.number_value = substr(lpad(c.declared_number, 2, '0'), 2, 1))
        )
      GROUP BY t.party_id, t.shift_id, t.created_at::date
    `;
    const payoutByKey = new Map(payoutRows.map(p => [`${p.party_id}:${p.shift_id}:${p.day}`, parseFloat(p.payout)]));
    const ledgerById = new Map(ledgerRows.map(l => [l.id, l]));
    const agg = new Map<number, { sale: number; pnl: number; days: Set<string> }>();
    for (const s of saleRows) {
      const l = ledgerById.get(s.party_id);
      if (!l) continue;
      const sale = parseFloat(s.sale);
      const comm = filters.onBase ? 0 : sale * parseFloat(l.commissionRate || '0') / 100;
      const pnl = sale - comm - (payoutByKey.get(`${s.party_id}:${s.shift_id}:${s.day}`) || 0);
      const a = agg.get(l.id) || { sale: 0, pnl: 0, days: new Set<string>() };
      a.sale += sale;
      a.pnl += pnl;
      a.days.add(s.day);
      agg.set(l.id, a);
    }

    const rows = ledgerRows
      .filter(l => agg.has(l.id))
      .map(l => {
        const a = agg.get(l.id)!;
        const pct = hpPct.get(l.id) || 0;
        const hpPartyId = l.hpLedgerId || l.id;
        return {
          partyId: l.id,
          partyName: l.partyName,
          agentName: l.agentName || '-',
          hpPartyId,
          hpPartyName: nameById.get(hpPartyId) || l.partyName,
          isHp: hpPct.has(l.id),
          wDay: a.days.size,
          tSale: a.sale,
          pnl: a.pnl,
          hpPct: pct,
          hpAmt: Math.round(a.pnl * pct) / 100,
        };
      })
      .sort((a, b) => a.partyName.localeCompare(b.partyName));
    return { month: filters.month, year: filters.year, from, to, rows };
  }

  static async processHawaPatti(data: {
    month: number;
    year: number;
    voucherDate: string;
    items: { hpPartyId: number; amount: number; partyName?: string }[];
  }, user: UserSession) {
    if (!(data.month >= 1 && data.month <= 12) || !(data.year > 2000)) throw new AppError('Please select a valid Month and Year!');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.voucherDate || '')) throw new AppError('Please select Voucher Date!');
    const lines = (data.items || []).filter(i => i.hpPartyId && Number(i.amount) !== 0);
    if (lines.length === 0) throw new AppError('Please tick at least one party with an HP amount!');

    const hpAccountId = await this.getOrCreateLedger(this.HP_ACCOUNT);
    const month = `${this.VAPSI_MONTHS[data.month - 1]} ${data.year}`;
    const createdAt = new Date(`${data.voucherDate}T12:00:00`);

    await db.transaction(async (tx) => {
      for (const line of lines) {
        const amount = Math.abs(Number(line.amount));
        // Positive share = the HP party is owed it (Cr); negative = it owes it (Dr).
        const partySide = Number(line.amount) > 0 ? 'CR' : 'DR';
        const [voucher] = await tx.insert(vouchers).values({
          voucherNumber: `VOUCH-HAWA_PATTI-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
          voucherType: 'HAWA_PATTI',
          totalAmount: amount.toFixed(2),
          narration: line.partyName ? `${month} | ${line.partyName}` : month,
          createdBy: user.userId,
          updatedBy: user.username || 'SYSTEM',
          createdAt,
        }).returning();
        await tx.insert(voucherEntries).values([
          { voucherId: voucher.id, ledgerId: Number(line.hpPartyId), entrySide: partySide, amount: amount.toFixed(2) },
          { voucherId: voucher.id, ledgerId: hpAccountId, entrySide: partySide === 'CR' ? 'DR' : 'CR', amount: amount.toFixed(2) },
        ]);
      }
    });
    return { posted: lines.length };
  }

  // HVS Process data: reuses the exact Comm/Hissa/opening-balance/P&L formulas already
  // validated for getAllShiftPartyReport above. "Total"/"Closing"/"T-Settle-Amt" are a
  // best-effort formula (Total = opening + P&L, Closing = Total - settled-so-far) — flagged
  // here the same way TPC/HP-Amt/RBT are flagged elsewhere, since their exact live semantics
  // can't be independently verified from a static screenshot.
  static async getHvsProcessData(filters: { fromDate: string; toDate: string; agentId?: number }) {
    const { rows } = await this.getAllShiftPartyReport({
      fromDate: filters.fromDate,
      toDate: filters.toDate,
      agentId: filters.agentId,
    });

    const partyIds = rows.map(r => r.partyId);
    const settledRows = partyIds.length > 0
      ? await db.select({
          ledgerId: voucherEntries.ledgerId,
          totalDr: sql<string>`COALESCE(SUM(CASE WHEN ${voucherEntries.entrySide} = 'DR' THEN ${voucherEntries.amount}::numeric ELSE 0 END), 0)`,
          totalCr: sql<string>`COALESCE(SUM(CASE WHEN ${voucherEntries.entrySide} = 'CR' THEN ${voucherEntries.amount}::numeric ELSE 0 END), 0)`,
        })
          .from(voucherEntries)
          .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
          .where(and(
            inArray(voucherEntries.ledgerId, partyIds),
            inArray(vouchers.voucherType, ['CASH_RECEIPT', 'CASH_PAYMENT']),
            sql`${vouchers.createdAt}::date >= ${filters.fromDate}::date`,
            sql`${vouchers.createdAt}::date <= ${filters.toDate}::date`,
          ))
          .groupBy(voucherEntries.ledgerId)
      : [];
    const settledByLedger = new Map(settledRows.map(s => [s.ledgerId, parseFloat(s.totalCr) - parseFloat(s.totalDr)]));

    return rows.map(r => {
      const pnl = r.totalSale + r.comm + r.hissa - r.dOpen - r.aOpen;
      const total = r.opening + pnl;
      const tSettleAmt = settledByLedger.get(r.partyId) || 0;
      const closing = total - tSettleAmt;
      return {
        partyId: r.partyId,
        partyName: r.partyName,
        agentName: r.agentName,
        mobile: r.mobile,
        pnl,
        total,
        closing,
        tSettleAmt,
      };
    });
  }

  // Per-staff transaction stats. Free Time / Time Taken / T-Time have no backing data
  // anywhere in this schema (no session-duration tracking exists) — left at 0, same
  // honest-placeholder convention already used for TPC/HP-Amt/RBT elsewhere.
  static async getProductivityReport(filters: { fromDate: string; toDate: string; shiftId?: number }) {
    const conditions = [
      ne(transactions.status, 'VOIDED'),
      sql`${transactions.createdAt}::date >= ${filters.fromDate}::date`,
      sql`${transactions.createdAt}::date <= ${filters.toDate}::date`,
    ];
    if (filters.shiftId) conditions.push(eq(transactions.shiftId, filters.shiftId));

    const rows = await db.select({
      userId: staff.userId,
      name: staff.fullName,
      mobile: staff.mobile,
      address: staff.address,
      role: staff.role,
      username: staff.username,
      tCount: sql<number>`COUNT(${transactions.id})::int`,
      tAmount: sql<string>`COALESCE(SUM(${transactions.totalAmount}), 0)`,
    })
      .from(transactions)
      .innerJoin(staff, eq(transactions.createdBy, staff.userId))
      .where(and(...conditions))
      .groupBy(staff.userId, staff.fullName, staff.mobile, staff.address, staff.role, staff.username);

    return rows.map(r => ({
      staffId: r.userId,
      name: r.name,
      mobile: r.mobile || '-',
      address: r.address || '-',
      role: r.role || '-',
      username: r.username || '-',
      freeTime: 0,
      timeTaken: 0,
      tTime: 0,
      tCount: r.tCount,
      tAmount: parseFloat(r.tAmount),
    })).sort((a, b) => a.name.localeCompare(b.name));
  }

  // Same per-staff base as getProductivityReport, but broken down per shift name instead of
  // a single total — frontend builds its per-market columns dynamically from whatever shift
  // names actually appear here, so no market list is hardcoded anywhere.
  static async getProductivityShiftReport(filters: { fromDate: string; toDate: string }) {
    const rows = await db.select({
      userId: staff.userId,
      name: staff.fullName,
      mobile: staff.mobile,
      address: staff.address,
      role: staff.role,
      username: staff.username,
      shiftName: shifts.name,
      count: sql<number>`COUNT(${transactions.id})::int`,
    })
      .from(transactions)
      .innerJoin(staff, eq(transactions.createdBy, staff.userId))
      .innerJoin(shifts, eq(transactions.shiftId, shifts.id))
      .where(and(
        ne(transactions.status, 'VOIDED'),
        sql`${transactions.createdAt}::date >= ${filters.fromDate}::date`,
        sql`${transactions.createdAt}::date <= ${filters.toDate}::date`,
      ))
      .groupBy(staff.userId, staff.fullName, staff.mobile, staff.address, staff.role, staff.username, shifts.name);

    const byStaff = new Map<number, { staffId: number; name: string; mobile: string; address: string; role: string; username: string; tCount: number; perShift: Record<string, number> }>();
    for (const r of rows) {
      if (!byStaff.has(r.userId)) {
        byStaff.set(r.userId, {
          staffId: r.userId,
          name: r.name,
          mobile: r.mobile || '-',
          address: r.address || '-',
          role: r.role || '-',
          username: r.username || '-',
          tCount: 0,
          perShift: {},
        });
      }
      const entry = byStaff.get(r.userId)!;
      entry.perShift[r.shiftName] = r.count;
      entry.tCount += r.count;
    }

    return Array.from(byStaff.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  // Per-staff audit stats: Mistake = voided, Modify = edited after creation (updatedAt !=
  // createdAt) — both derived from fields already on the transactions table.
  static async getProductivityAudit(filters: { fromDate: string; toDate: string; shiftId?: number }) {
    const conditions = [
      sql`${transactions.createdAt}::date >= ${filters.fromDate}::date`,
      sql`${transactions.createdAt}::date <= ${filters.toDate}::date`,
    ];
    if (filters.shiftId) conditions.push(eq(transactions.shiftId, filters.shiftId));

    const rows = await db.select({
      userId: staff.userId,
      name: staff.fullName,
      mobile: staff.mobile,
      address: staff.address,
      role: staff.role,
      tParty: sql<number>`COUNT(DISTINCT ${transactions.partyId})::int`,
      tCount: sql<number>`COUNT(${transactions.id})::int`,
      valid: sql<number>`COUNT(*) FILTER (WHERE ${transactions.status} != 'VOIDED')::int`,
      mistake: sql<number>`COUNT(*) FILTER (WHERE ${transactions.status} = 'VOIDED')::int`,
      modify: sql<number>`COUNT(*) FILTER (WHERE ${transactions.updatedAt} != ${transactions.createdAt})::int`,
      tAmount: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.status} != 'VOIDED' THEN ${transactions.totalAmount}::numeric ELSE 0 END), 0)`,
    })
      .from(transactions)
      .innerJoin(staff, eq(transactions.createdBy, staff.userId))
      .where(and(...conditions))
      .groupBy(staff.userId, staff.fullName, staff.mobile, staff.address, staff.role);

    return rows.map(r => ({
      staffId: r.userId,
      name: r.name,
      mobile: r.mobile || '-',
      address: r.address || '-',
      role: r.role || '-',
      tParty: r.tParty,
      tCount: r.tCount,
      valid: r.valid,
      mistake: r.mistake,
      modify: r.modify,
      tAmount: parseFloat(r.tAmount),
    })).sort((a, b) => a.name.localeCompare(b.name));
  }

  // Shared before/after-declare split, reused by both getTransBeforeAfterDeclare (row-level,
  // one shift-day) and getPlBeforeAfterDeclare (aggregate-only, many shift-days). P&L reuses
  // the exact winner-matching logic already validated in getAllShiftPartyReport above (DARA
  // matches the declared number, HARUF_ANDAR/BAHAR match its tens/units digit) — just
  // bucketed by whether the transaction landed before or after declarations.declaredAt.
  private static async computeBeforeAfterTotals(shiftId: number, date: string) {
    const [decl] = await db.select().from(declarations)
      .where(and(eq(declarations.shiftId, shiftId), sql`${declarations.declaredAt}::date = ${date}::date`))
      .orderBy(desc(declarations.declaredAt))
      .limit(1);

    const txRows = await db.select().from(transactions).where(and(
      eq(transactions.shiftId, shiftId),
      sql`${transactions.createdAt}::date = ${date}::date`,
      ne(transactions.status, 'VOIDED'),
    ));

    const txIds = txRows.map(t => t.id);
    const entryRows = txIds.length > 0
      ? await db.select().from(transactionEntries).where(inArray(transactionEntries.transactionId, txIds))
      : [];
    const entriesByTx = new Map<number, typeof entryRows>();
    for (const e of entryRows) {
      if (!entriesByTx.has(e.transactionId)) entriesByTx.set(e.transactionId, []);
      entriesByTx.get(e.transactionId)!.push(e);
    }

    const declaredNumber = decl?.winningNumber ? decl.winningNumber.padStart(2, '0') : null;
    const tensDigit = declaredNumber?.[0];
    const unitsDigit = declaredNumber?.[1];

    let saleBefore = 0, saleAfter = 0, payoutBefore = 0, payoutAfter = 0;

    for (const tx of txRows) {
      const isBefore = !decl || new Date(tx.createdAt) < new Date(decl.declaredAt);
      const amt = parseFloat(tx.totalAmount);
      if (isBefore) saleBefore += amt; else saleAfter += amt;

      let payout = 0;
      if (declaredNumber) {
        for (const e of entriesByTx.get(tx.id) || []) {
          const eAmt = parseFloat(e.amount);
          const rate = parseFloat(e.rate);
          if (e.entryType === 'DARA' && e.numberValue === declaredNumber) payout += eAmt * rate;
          else if (e.entryType === 'HARUF_ANDAR' && e.numberValue === tensDigit) payout += eAmt * rate;
          else if (e.entryType === 'HARUF_BAHAR' && e.numberValue === unitsDigit) payout += eAmt * rate;
        }
      }
      if (isBefore) payoutBefore += payout; else payoutAfter += payout;
    }

    const plBefore = saleBefore - payoutBefore;
    const plAfter = saleAfter - payoutAfter;

    return {
      declaration: decl,
      saleBefore, saleAfter, saleDiff: saleAfter - saleBefore,
      plBefore, plAfter, plDiff: plAfter - plBefore,
    };
  }

  static async getTransBeforeAfterDeclare(filters: { shiftId: number; date: string; mode: 'BEFORE' | 'AFTER' }) {
    const totals = await this.computeBeforeAfterTotals(filters.shiftId, filters.date);

    const txRows = await db.select({
      id: transactions.id,
      partyName: ledgers.partyName,
      rateStr: transactions.rateStr,
      totalAmount: transactions.totalAmount,
      isD: transactions.isD,
      addedBy: transactions.addedBy,
      updatedBy: transactions.updatedBy,
      createdAt: transactions.createdAt,
      updatedAt: transactions.updatedAt,
    })
      .from(transactions)
      .innerJoin(ledgers, eq(transactions.partyId, ledgers.id))
      .where(and(
        eq(transactions.shiftId, filters.shiftId),
        sql`${transactions.createdAt}::date = ${filters.date}::date`,
        ne(transactions.status, 'VOIDED'),
      ))
      .orderBy(desc(transactions.createdAt));

    const decl = totals.declaration;
    const filtered = txRows.filter(tx => {
      const isBefore = !decl || new Date(tx.createdAt) < new Date(decl.declaredAt);
      return filters.mode === 'BEFORE' ? isBefore : !isBefore;
    });

    return {
      rows: filtered.map(tx => ({
        id: tx.id,
        partyName: tx.partyName,
        rate: tx.rateStr || '-',
        amount: parseFloat(tx.totalAmount),
        isD: tx.isD,
        addedBy: tx.addedBy || 'SYSTEM',
        createdAt: tx.createdAt.toISOString(),
        updatedBy: tx.updatedBy || 'SYSTEM',
        updatedAt: tx.updatedAt.toISOString(),
      })),
      totals: {
        saleBefore: totals.saleBefore,
        saleAfter: totals.saleAfter,
        saleDiff: totals.saleDiff,
        plBefore: totals.plBefore,
        plAfter: totals.plAfter,
        plDiff: totals.plDiff,
      },
    };
  }

  static async getPlBeforeAfterDeclare(filters: { fromDate: string; toDate: string; shiftId?: number }) {
    const conditions = [
      sql`${declarations.declaredAt}::date >= ${filters.fromDate}::date`,
      sql`${declarations.declaredAt}::date <= ${filters.toDate}::date`,
    ];
    if (filters.shiftId) conditions.push(eq(declarations.shiftId, filters.shiftId));

    const declRows = await db.select({
      shiftId: declarations.shiftId,
      shiftName: shifts.name,
      winningNumber: declarations.winningNumber,
      declaredDate: sql<string>`${declarations.declaredAt}::date`,
    })
      .from(declarations)
      .innerJoin(shifts, eq(declarations.shiftId, shifts.id))
      .where(and(...conditions))
      .orderBy(desc(declarations.declaredAt));

    const results = [];
    for (const d of declRows) {
      const totals = await this.computeBeforeAfterTotals(d.shiftId, d.declaredDate);
      results.push({
        date: d.declaredDate,
        shiftName: d.shiftName,
        result: d.winningNumber,
        saleBefore: totals.saleBefore,
        saleAfter: totals.saleAfter,
        saleDiff: totals.saleDiff,
        plBefore: totals.plBefore,
        plAfter: totals.plAfter,
        plDiff: totals.plDiff,
      });
    }
    return results;
  }

  // Transactions entered after a role's normal cutoff (shiftRoleConfig.closeTime, the same
  // field ShiftService.assertShiftOpenForRole enforces live) could only happen via an admin
  // override — that override is the existing operator_shift_permissions table, already used
  // by Declare Trans Permission. "Allow Till" here is literally that row's expiresAt.
  static async getTransAfterTiming(filters: { fromDate: string; toDate: string }) {
    const txRows = await db.select({
      id: transactions.id,
      shiftId: transactions.shiftId,
      shiftName: shifts.name,
      partyName: ledgers.partyName,
      status: transactions.status,
      totalAmount: transactions.totalAmount,
      addedBy: transactions.addedBy,
      updatedBy: transactions.updatedBy,
      createdAt: transactions.createdAt,
      updatedAt: transactions.updatedAt,
      createdBy: transactions.createdBy,
      createdDate: sql<string>`${transactions.createdAt}::date`,
      createdTime: sql<string>`to_char(${transactions.createdAt}, 'HH24:MI:SS')`,
    })
      .from(transactions)
      .innerJoin(shifts, eq(transactions.shiftId, shifts.id))
      .innerJoin(ledgers, eq(transactions.partyId, ledgers.id))
      .where(and(
        sql`${transactions.createdAt}::date >= ${filters.fromDate}::date`,
        sql`${transactions.createdAt}::date <= ${filters.toDate}::date`,
      ));

    if (txRows.length === 0) return [];

    const userIds = Array.from(new Set(txRows.map(t => t.createdBy)));
    const userRows = await db.select({ id: users.id, roleId: users.roleId }).from(users).where(inArray(users.id, userIds));
    const roleByUser = new Map(userRows.map(u => [u.id, u.roleId]));

    const shiftIds = Array.from(new Set(txRows.map(t => t.shiftId)));
    const configRows = shiftIds.length > 0
      ? await db.select().from(shiftRoleConfig).where(inArray(shiftRoleConfig.shiftId, shiftIds))
      : [];
    const closeTimeByShiftRole = new Map(configRows.map(c => [`${c.shiftId}:${c.roleId}`, c.closeTime]));

    const permRows = await db.select().from(operatorShiftPermissions).where(inArray(operatorShiftPermissions.userId, userIds));
    const permByKey = new Map<string, Date | null>();
    for (const p of permRows) {
      permByKey.set(`${p.userId}:${p.shiftId}:${p.shiftDate}`, p.expiresAt);
    }

    const results: any[] = [];
    for (const tx of txRows) {
      const roleId = roleByUser.get(tx.createdBy);
      const closeTime = roleId != null ? closeTimeByShiftRole.get(`${tx.shiftId}:${roleId}`) : undefined;
      if (!closeTime) continue;
      if (tx.createdTime <= closeTime) continue;

      const allowTill = permByKey.get(`${tx.createdBy}:${tx.shiftId}:${tx.createdDate}`) ?? null;

      results.push({
        id: tx.id,
        date: tx.createdDate,
        shiftName: tx.shiftName,
        partyName: tx.partyName,
        status: tx.status,
        amount: parseFloat(tx.totalAmount),
        addedBy: tx.addedBy || 'SYSTEM',
        createdAt: tx.createdAt.toISOString(),
        updatedBy: tx.updatedBy || 'SYSTEM',
        updatedAt: tx.updatedAt.toISOString(),
        allowTill: allowTill ? new Date(allowTill).toISOString() : null,
      });
    }
    return results.sort((a, b) => a.date.localeCompare(b.date));
  }

  // Day-by-day running ledger statement for ONE party. Balance = OP-Bal + P&L - Payment
  // (validated against a live reference row: 42129 + 45 - 0 = 42174). P&L = TotalSale +
  // Comm + Hissa - D-Open - A-Open (Comm/Hissa already negative). TPC/HP-Amt/RBT have no
  // determinable formula from the reference and are left at 0, same caveat as Daily/All
  // Shift Report. "Payment" = settlement vouchers (CASH_RECEIPT/CASH_PAYMENT) posted
  // against this party via the Save (F2) form below the table.
  static async getSettlingReport(filters: { partyId: number; fromDate: string; toDate: string }) {
    const [party] = await db.select().from(ledgers).where(eq(ledgers.id, filters.partyId));
    if (!party) throw new NotFoundError('Party not found');

    let agentName = '-';
    if (party.agentId) {
      const [agent] = await db.select().from(agents).where(eq(agents.id, party.agentId));
      if (agent) agentName = agent.agentName;
    }

    // Live badge "Rate: 90/10 | 9/10" = Dara rate / Comm% | Akhar rate / Comm%, from the ledger.
    const commPctLabel = Math.round(parseFloat(party.commissionRate || '0'));
    const rateStr = `${Math.round(parseFloat(party.daraRate))}/${commPctLabel} | ${Math.round(parseFloat(party.akharRate))}/${commPctLabel}`;

    // UTC-anchored throughout, so toISOString()'s date slice matches the intended calendar
    // day regardless of the server's local timezone offset.
    const dayBefore = new Date(`${filters.fromDate}T00:00:00Z`);
    dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
    const openingBalances = await VoucherService.getLedgerBalances({ toDate: dayBefore.toISOString().slice(0, 10) });
    // Live sign: positive = Dr (party owes), negative = Cr — "Balance: 592278 Cr" for a
    // -592279 row. getLedgerBalances is Cr − Dr, so it's flipped here.
    let runningBalance = -(openingBalances.find(b => b.ledgerId === filters.partyId)?.balance || 0);

    // day: the slip's date as stored (wall clock) — createdAt.toISOString() is UTC and put
    // slips made before 05:30 IST on the previous day.
    const txRows = await db.select({
      id: transactions.id,
      shiftId: transactions.shiftId,
      totalAmount: transactions.totalAmount,
      day: sql<string>`${transactions.createdAt}::date::text`,
    }).from(transactions).where(
      and(
        eq(transactions.partyId, filters.partyId),
        ne(transactions.status, 'VOIDED'),
        sql`${transactions.createdAt}::date >= ${filters.fromDate}::date`,
        sql`${transactions.createdAt}::date <= ${filters.toDate}::date`
      )
    );
    const txIds = txRows.map(t => t.id);
    const entryRows = txIds.length > 0
      ? await db.select().from(transactionEntries).where(inArray(transactionEntries.transactionId, txIds))
      : [];
    const entriesByTx = new Map<number, typeof entryRows>();
    for (const e of entryRows) {
      if (!entriesByTx.has(e.transactionId)) entriesByTx.set(e.transactionId, []);
      entriesByTx.get(e.transactionId)!.push(e);
    }

    const shiftIds = Array.from(new Set(txRows.map(t => t.shiftId)));
    const shiftRows = shiftIds.length > 0
      ? await db.select({ id: shifts.id, declaredNumber: shifts.declaredNumber }).from(shifts).where(inArray(shifts.id, shiftIds))
      : [];
    const declaredByShift = new Map(shiftRows.map(s => [s.id, s.declaredNumber ? s.declaredNumber.padStart(2, '0') : null]));

    const settleEntries = await db.select({
      entrySide: voucherEntries.entrySide,
      amount: voucherEntries.amount,
      day: sql<string>`${vouchers.createdAt}::date::text`,
    })
      .from(voucherEntries)
      .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
      .where(and(
        eq(voucherEntries.ledgerId, filters.partyId),
        inArray(vouchers.voucherType, ['CASH_RECEIPT', 'CASH_PAYMENT']),
        sql`${vouchers.createdAt}::date >= ${filters.fromDate}::date`,
        sql`${vouchers.createdAt}::date <= ${filters.toDate}::date`
      ));

    const commissionRate = parseFloat(party.commissionRate);
    const hissaPct = parseFloat(party.hissaPercentage);

    const days: string[] = [];
    const cursor = new Date(`${filters.fromDate}T00:00:00Z`);
    const endDay = new Date(`${filters.toDate}T00:00:00Z`);
    while (cursor <= endDay) {
      days.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    const rows = days.map(day => {
      const dayTx = txRows.filter(t => t.day === day);
      // dOpen / aOpen: winning STAKE (live "D/A-Open 1900/0"); payout is stake × rate.
      let totalSale = 0, dSale = 0, aSale = 0, dOpen = 0, aOpen = 0, payout = 0;

      for (const tx of dayTx) {
        totalSale += parseFloat(tx.totalAmount);
        const declaredNumber = declaredByShift.get(tx.shiftId);
        const tensDigit = declaredNumber?.[0];
        const unitsDigit = declaredNumber?.[1];
        for (const e of entriesByTx.get(tx.id) || []) {
          const amt = parseFloat(e.amount);
          const rate = parseFloat(e.rate);
          if (e.entryType === 'DARA') {
            dSale += amt;
            if (declaredNumber && e.numberValue === declaredNumber) { dOpen += amt; payout += amt * rate; }
          } else {
            aSale += amt;
            if (declaredNumber) {
              if (e.entryType === 'HARUF_ANDAR' && e.numberValue === tensDigit) { aOpen += amt; payout += amt * rate; }
              else if (e.entryType === 'HARUF_BAHAR' && e.numberValue === unitsDigit) { aOpen += amt; payout += amt * rate; }
            }
          }
        }
      }

      // Checked against the live row: 171650 sale, Comm −17165, D-Open 1900 (×90 = 171000)
      // → book −16515, Hissa 20% = +3303, P&L −13212, Balance −579067 − 13212 = −592279.
      const comm = -(totalSale * commissionRate / 100);
      const book = totalSale + comm - payout;
      const hissa = -(book * hissaPct / 100);
      const pnl = book + hissa;

      const dayPayments = settleEntries.filter(s => s.day === day);
      const payment = dayPayments.reduce((sum, s) => sum + (s.entrySide === 'CR' ? parseFloat(s.amount) : -parseFloat(s.amount)), 0);

      const opBal = runningBalance;
      const balance = opBal + pnl - payment;
      runningBalance = balance;

      return {
        date: day,
        opBal,
        totalSale,
        dSale,
        aSale,
        comm,
        dOpen,
        aOpen,
        hissa,
        tpc: 0,
        hpAmt: 0,
        rbt: 0,
        pnl,
        payment,
        balance,
      };
    });

    return {
      partyId: party.id,
      partyName: party.partyName,
      agentName,
      rate: rateStr,
      limit: parseFloat(party.betLimit),
      balance: runningBalance,
      rows,
    };
  }
}
