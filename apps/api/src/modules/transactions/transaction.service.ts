import { db, transactions, transactionEntries, ledgers, ledgerThirdPartyLinks, shifts, shiftCycles, agents, vouchers, voucherEntries, auditLogs, duplicateReviews, staff, declarations, users, roles, shiftRoleConfig, operatorShiftPermissions } from '@pb/database';
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
    return trimmed;
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
      const rate = entry.entryType === 'DARA' ? partyDaraRate : partyAkharRate;
      const payout = amt * rate;

      return {
        entryType: entry.entryType,
        numberValue: this.normalizeNumberValue(entry.numberValue, entry.entryType),
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
        pipeline.hincrbyfloat(jantriKey, e.numberValue, parseFloat(e.amount));
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
  }) {
    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(200, Math.max(1, filters.limit || 100));
    const offset = (page - 1) * limit;

    const conditions = [];
    if (filters.ownerUserId) conditions.push(eq(transactions.createdBy, filters.ownerUserId));
    if (filters.shiftId) conditions.push(eq(transactions.shiftId, filters.shiftId));
    if (filters.partyId) conditions.push(eq(transactions.partyId, filters.partyId));
    if (filters.status && filters.status !== 'ALL') {
      conditions.push(eq(transactions.status, filters.status));
    }
    if (filters.auditStatus && filters.auditStatus !== 'ALL') {
      conditions.push(eq(transactions.auditStatus, filters.auditStatus));
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

    const entriesMap = new Map<number, { numberValue: string; amount: number; rate: number }[]>();
    for (const e of allEntries) {
      if (!entriesMap.has(e.transactionId)) {
        entriesMap.set(e.transactionId, []);
      }
      entriesMap.get(e.transactionId)!.push({
        numberValue: e.numberValue,
        amount: parseFloat(e.amount),
        rate: parseFloat(e.rate),
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
    user: UserSession
  ) {
    const [existing] = await db.select().from(transactions).where(eq(transactions.id, id));
    if (!existing) throw new NotFoundError('Transaction not found');

    const [shift] = await db.select().from(shifts).where(eq(shifts.id, existing.shiftId));
    if (!shift) throw new NotFoundError('Shift not found');
    if (shift.status === 'DECLARED' || shift.status === 'AUDITED' || shift.declaredNumber) {
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
      const rate = entry.entryType === 'DARA' ? partyDaraRate : partyAkharRate;
      const payout = amt * rate;
      return {
        entryType: entry.entryType,
        numberValue: this.normalizeNumberValue(entry.numberValue, entry.entryType),
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

    // Reconcile Redis jantri cache: remove the old entries' contribution, apply the new one
    try {
      const jantriKey = `jantri:${shift.id}:${shift.openDate}`;
      const pipeline = redis.pipeline();
      for (const e of oldEntries) {
        pipeline.hincrbyfloat(jantriKey, e.numberValue, -e.amount);
      }
      pipeline.hincrbyfloat(jantriKey, 'TOTAL_COLLECTED', -parseFloat(existing.totalAmount));
      for (const e of preparedEntries) {
        pipeline.hincrbyfloat(jantriKey, e.numberValue, parseFloat(e.amount));
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

  static async updateAuditStatus(id: number, auditStatus: 'VALID' | 'MISTAKE' | 'NOT-AUDIT', user: UserSession) {
    const [existing] = await db.select().from(transactions).where(eq(transactions.id, id));
    if (!existing) throw new NotFoundError('Transaction not found');

    const [updated] = await db.update(transactions)
      .set({
        auditStatus,
        isAudited: auditStatus !== 'NOT-AUDIT',
        updatedAt: new Date(),
        updatedBy: await this.resolveActorName(user),
      })
      .where(eq(transactions.id, id))
      .returning();

    return updated;
  }

  static async deleteTransaction(id: number, user: UserSession) {
    const [existing] = await db.select().from(transactions).where(eq(transactions.id, id));
    if (!existing) throw new NotFoundError('Transaction not found');

    await db.delete(transactionEntries).where(eq(transactionEntries.transactionId, id));
    await db.delete(transactions).where(eq(transactions.id, id));

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
        commissionRate: ledgers.commissionRate,
        hissaPercentage: ledgers.hissaPercentage,
        dibba: ledgers.dibba,
        akharRate: ledgers.akharRate,
      }).from(ledgers).where(inArray(ledgers.id, partyIds));
      const partyById = new Map(partyRows.map(p => [p.id, p]));
      const partyByTx = new Map(txRows.map(t => [t.id, t.partyId]));

      const txIds = txRows.map(t => t.id);
      const entries = await db.select().from(transactionEntries).where(inArray(transactionEntries.transactionId, txIds));

      for (const e of entries) {
        const partyId = partyByTx.get(e.transactionId);
        const party = partyId !== undefined ? partyById.get(partyId) : undefined;
        if (filters.dibba && !party?.dibba) continue;

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
          const hissaPct = parseFloat(party.hissaPercentage) || 0;
          amt = amt * (1 - hissaPct / 100);
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

    return filtered.map(r => {
      const amount = parseFloat(r.amount);
      const rate = parseFloat(r.rate);
      const partyHissa = hissaByParty.get(r.partyId) || { self: 0, other: 0 };
      let pnlAmount = 0;

      const cycleDeclared = declaredFor(r);
      if (cycleDeclared) {
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
        sale: amount,
        pnlAmount,
        rate: r.rateStr || `${rate}/10`,
        sHissa: partyHissa.self,
        oHissa: partyHissa.other,
        shiftId: r.shiftId,
        shiftName: r.shiftName,
      };
    });
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
  // TPC is left at 0, same already-flagged "formula not determined" placeholder as
  // getDailyReport uses — real live data (e.g. GHAZIABAD) does show non-zero TPC, but no
  // reference screenshot has isolated its exact source. "Closing" is likewise a best-effort
  // placeholder (0) pending the exact formula — tested against every real row from the live
  // screenshot and no combination of the other columns reproduces it, so it isn't guessed here.
  static async getShiftProfitLossReport(filters: { fromDate: string; toDate: string }) {
    const declRows = await db.select({
      shiftId: declarations.shiftId,
      winningNumber: declarations.winningNumber,
      declaredAt: declarations.declaredAt,
    }).from(declarations).where(and(
      eq(declarations.isReversed, false),
      sql`${declarations.declaredAt}::date >= ${filters.fromDate}::date`,
      sql`${declarations.declaredAt}::date <= ${filters.toDate}::date`,
    ));

    const declaredNumberByShiftDate = new Map<string, string>();
    const shiftIdsWithDeclaration = new Set<number>();
    for (const d of declRows) {
      const dateStr = d.declaredAt.toISOString().slice(0, 10);
      declaredNumberByShiftDate.set(`${d.shiftId}:${dateStr}`, d.winningNumber.padStart(2, '0'));
      shiftIdsWithDeclaration.add(d.shiftId);
    }

    if (shiftIdsWithDeclaration.size === 0) return { rows: [], masterTotal: null };

    const shiftIds = Array.from(shiftIdsWithDeclaration);
    const shiftRows = await db.select().from(shifts).where(inArray(shifts.id, shiftIds));
    const shiftById = new Map(shiftRows.map(s => [s.id, s]));

    const txRows = await db.select().from(transactions).where(and(
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

    // Per (shiftId, partyId): raw totals, matching getDailyReport's per-party aggregation
    // exactly before the Comm/Hissa formula is applied.
    const perShiftParty = new Map<string, { shiftId: number; totalSale: number; dSale: number; aSale: number; oDara: number; oAkhar: number }>();

    for (const tx of txRows) {
      const key = `${tx.shiftId}:${tx.partyId}`;
      if (!perShiftParty.has(key)) {
        perShiftParty.set(key, { shiftId: tx.shiftId, totalSale: 0, dSale: 0, aSale: 0, oDara: 0, oAkhar: 0 });
      }
      const agg = perShiftParty.get(key)!;
      agg.totalSale += parseFloat(tx.totalAmount);

      const txDateStr = tx.createdAt.toISOString().slice(0, 10);
      const declaredNumber = declaredNumberByShiftDate.get(`${tx.shiftId}:${txDateStr}`);
      const tensDigit = declaredNumber?.[0];
      const unitsDigit = declaredNumber?.[1];

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

    // Sum each party's Comm/Hissa (computed with that party's own rates) up into their shift.
    const perShift = new Map<number, { totalSale: number; dSale: number; aSale: number; comm: number; oDara: number; oAkhar: number; hissa: number }>();
    for (const [key, agg] of perShiftParty) {
      const partyId = parseInt(key.split(':')[1], 10);
      const party = partyById.get(partyId);
      const commissionRate = parseFloat(party?.commissionRate || '0');
      const hissaPct = parseFloat(party?.hissaPercentage || '0');
      const comm = -(agg.totalSale * commissionRate / 100);
      const hissa = -((agg.totalSale + comm) * hissaPct / 100);

      if (!perShift.has(agg.shiftId)) {
        perShift.set(agg.shiftId, { totalSale: 0, dSale: 0, aSale: 0, comm: 0, oDara: 0, oAkhar: 0, hissa: 0 });
      }
      const shiftAgg = perShift.get(agg.shiftId)!;
      shiftAgg.totalSale += agg.totalSale;
      shiftAgg.dSale += agg.dSale;
      shiftAgg.aSale += agg.aSale;
      shiftAgg.comm += comm;
      shiftAgg.oDara += agg.oDara;
      shiftAgg.oAkhar += agg.oAkhar;
      shiftAgg.hissa += hissa;
    }

    const rows = shiftIds
      .filter(id => shiftById.has(id))
      .map(shiftId => {
        const shift = shiftById.get(shiftId)!;
        const agg = perShift.get(shiftId) || { totalSale: 0, dSale: 0, aSale: 0, comm: 0, oDara: 0, oAkhar: 0, hissa: 0 };
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
          tpc: 0,
          hissa: agg.hissa,
          closing: 0,
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

    const rateStr = `${Math.round(parseFloat(party.daraRate))}/10 | ${Math.round(parseFloat(party.akharRate))}/10`;

    // UTC-anchored throughout, so toISOString()'s date slice matches the intended calendar
    // day regardless of the server's local timezone offset.
    const dayBefore = new Date(`${filters.fromDate}T00:00:00Z`);
    dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
    const openingBalances = await VoucherService.getLedgerBalances({ toDate: dayBefore.toISOString().slice(0, 10) });
    let runningBalance = openingBalances.find(b => b.ledgerId === filters.partyId)?.balance || 0;

    const txRows = await db.select().from(transactions).where(
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
      createdAt: vouchers.createdAt,
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
      const dayTx = txRows.filter(t => t.createdAt.toISOString().slice(0, 10) === day);
      let totalSale = 0, dSale = 0, aSale = 0, dOpen = 0, aOpen = 0;

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
            if (declaredNumber && e.numberValue === declaredNumber) dOpen += amt * rate;
          } else {
            aSale += amt;
            if (declaredNumber) {
              if (e.entryType === 'HARUF_ANDAR' && e.numberValue === tensDigit) aOpen += amt * rate;
              else if (e.entryType === 'HARUF_BAHAR' && e.numberValue === unitsDigit) aOpen += amt * rate;
            }
          }
        }
      }

      const comm = -(totalSale * commissionRate / 100);
      const hissa = -((totalSale + comm) * hissaPct / 100);
      const pnl = totalSale + comm + hissa - dOpen - aOpen;

      const dayPayments = settleEntries.filter(s => s.createdAt.toISOString().slice(0, 10) === day);
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
