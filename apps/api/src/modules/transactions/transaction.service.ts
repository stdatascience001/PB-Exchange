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
  // Live shows the staff USERNAME there (B09, ADM1 — not "GAGGU LDH STAFF A/C"): the staff
  // record's username, else the login username.
  private static staffUsername(staffUsername?: string | null, loginUsername?: string | null): string | null {
    const u = (staffUsername || '').trim();
    if (u && u.toUpperCase() !== 'NONE') return u;
    const l = (loginUsername || '').trim();
    return l && l.toUpperCase() !== 'NONE' ? l : null;
  }

  private static async resolveActorName(user: { userId: number; username?: string }): Promise<string> {
    try {
      const [row] = await db.select({ username: staff.username })
        .from(staff).where(eq(staff.userId, user.userId)).limit(1);
      const name = this.staffUsername(row?.username, user.username);
      if (name) return name;
    } catch (err) {
      console.warn('[Transactions] actor name lookup failed:', err);
    }
    return user.username || 'SYSTEM';
  }

  // Slips saved before the switch above carry the staff FULL NAME ("GAGGU LDH STAFF A/C"); shown
  // as that staff's username instead (ADM1). Display only — nothing stored is rewritten.
  private static async actorDisplayMap(): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    try {
      const rows = await db.select({ fullName: staff.fullName, username: staff.username, login: users.username })
        .from(staff).leftJoin(users, eq(users.id, staff.userId));
      for (const r of rows) {
        const full = (r.fullName || '').trim().toUpperCase();
        const name = this.staffUsername(r.username, r.login);
        if (full && name && full !== name.toUpperCase()) out.set(full, name);
      }
    } catch (err) {
      console.warn('[Transactions] actor display lookup failed:', err);
    }
    return out;
  }
  private static showActor(map: Map<string, string>, v?: string | null): string | null | undefined {
    if (!v) return v;
    return map.get(v.trim().toUpperCase()) || v;
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
      // username (live), as resolveActorName
      for (const r of rows) out.set(r.userId, r.username);
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

  // The slip's Rate as live prints it: Dara rate / Comm% - Akhar rate / Comm% from the party's
  // ledger, decimals only when there are any — "90/10-9/10", "100/0-10/0", "95/5-9.5/5", "50/50-5/50".
  static readonly DEFAULT_RATE_STR = '90/10-9/10';
  static partyRateStr(p: { daraRate?: string | null; akharRate?: string | null; commissionRate?: string | null }): string {
    const num = (v?: string | null) => String(parseFloat(v || '0') || 0);
    const comm = num(p.commissionRate);
    return `${num(p.daraRate)}/${comm}-${num(p.akharRate)}/${comm}`;
  }

  // Company ledgers (group "Company", e.g. X RK KHANNA) take the book's lay-off: their slips are
  // kept as MINUS amounts, so the sale, commission and payout come off the book everywhere
  // (live Daily Report NEW FARIDABAD 14-10: X RK KHANNA −10600, Comm +1060, O-Dara −150,
  // Hissa −1980, Debit 1980). The amounts are typed as usual; every other party is unchanged.
  static isCompanyLedger(p: { groupName?: string | null }): boolean {
    return (p.groupName || '').trim().toUpperCase() === 'COMPANY';
  }
  private static signedAmount(amount: number, isCompany: boolean): number {
    return isCompany ? -Math.abs(amount) : Math.max(0, amount);
  }

  // 3rd Party Comm (Ledger → Re-Config → "3rd Party Comm": party, D-Comm %, A-Comm %) is paid
  // OUT OF the party's own commission: the party keeps Comm% − D-Comm% on its Dara sale and
  // Comm% − A-Comm% on its Akhar sale, the rest goes to the 3rd party (TPC Report). Live Settling
  // GARG KUNAL (Comm 10, "ZZ SHANKY HPT" 10/10): Comm column 0, 16820 − 500×90 = −28180; and the
  // TPC Report pays ZZ SHANKY HPT 16820 × 10% = 1682 from it.
  static async tpcPctByLedger(ledgerIds?: number[]): Promise<Map<number, { d: number; a: number }>> {
    const out = new Map<number, { d: number; a: number }>();
    if (ledgerIds && ledgerIds.length === 0) return out;
    const conds = [eq(ledgerThirdPartyLinks.linkType, 'TPC')];
    if (ledgerIds) conds.push(inArray(ledgerThirdPartyLinks.ledgerId, ledgerIds));
    const rows = await db.select({ ledgerId: ledgerThirdPartyLinks.ledgerId, dComm: ledgerThirdPartyLinks.dComm, aComm: ledgerThirdPartyLinks.aComm })
      .from(ledgerThirdPartyLinks).where(and(...conds));
    for (const r of rows) {
      const cur = out.get(r.ledgerId) || { d: 0, a: 0 };
      cur.d += parseFloat(r.dComm || '0') || 0;
      cur.a += parseFloat(r.aComm || '0') || 0;
      out.set(r.ledgerId, cur);
    }
    return out;
  }
  // The party's Comm (minus) after its 3rd Party Comm share; no 3rd Party Comm -> as before
  static partyComm(totalSale: number, dSale: number, aSale: number, commPct: number, tpc?: { d: number; a: number }): number {
    if (!tpc || (!tpc.d && !tpc.a)) return -(totalSale * commPct / 100);
    return -((dSale * (commPct - tpc.d) + aSale * (commPct - tpc.a)) / 100);
  }

  // transactions.started_at (Productivity Report: when the operator started the slip; created_at
  // is when it was saved). Added on first use, kept out of the drizzle schema (same DDL as migrate.ts).
  private static startedAtReady: Promise<void> | null = null;
  static ensureStartedAtColumn(): Promise<void> {
    if (!this.startedAtReady) {
      this.startedAtReady = pgSql.unsafe('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS started_at TIMESTAMP')
        .then(() => undefined)
        .catch((err) => { TransactionService.startedAtReady = null; throw err; });
    }
    return this.startedAtReady;
  }

  // DATA ENTRY OPERATOR may change only slips nobody above them has touched: a slip added or
  // updated by a DEVELOPER / SUPER ADMIN / ADMIN user (audit_logs CREATE / UPDATE by such a user,
  // or entered by one) is locked for the operator — no Edit / Delete.
  static readonly OPERATOR_LOCKING_ROLES = ['DEVELOPER', 'SUPER ADMIN', 'ADMIN'];
  static readonly OPERATOR_ROLE = 'DATA ENTRY OPERATOR';

  private static async adminTouchedTxIds(txIds: number[]): Promise<Set<number>> {
    const out = new Set<number>();
    const ids = Array.from(new Set(txIds)).filter(Boolean);
    for (let i = 0; i < ids.length; i += 5000) {
      const chunk = ids.slice(i, i + 5000);
      const rows = await pgSql<Array<{ id: number }>>`
        SELECT t.id
        FROM transactions t
        WHERE t.id IN ${pgSql(chunk)}
          AND (
            EXISTS (SELECT 1 FROM users u JOIN roles r ON r.id = u.role_id
                    WHERE u.id = t.created_by AND r.name IN ${pgSql(this.OPERATOR_LOCKING_ROLES)})
            OR EXISTS (SELECT 1 FROM audit_logs a JOIN users u ON u.id = a.actor_id JOIN roles r ON r.id = u.role_id
                       WHERE a.entity_type = 'TRANSACTION' AND a.entity_id = t.id::text
                         AND a.action IN ('CREATE', 'UPDATE')
                         AND r.name IN ${pgSql(this.OPERATOR_LOCKING_ROLES)})
          )
      `;
      for (const r of rows) out.add(Number(r.id));
    }
    return out;
  }

  // Server-side guard for Edit / Delete by a DATA ENTRY OPERATOR: only their own slip, and not
  // one an Admin-level user has added or updated
  private static async assertOperatorMayChange(tx: { id: number; createdBy: number }, user: UserSession) {
    if (user.roleName !== this.OPERATOR_ROLE) return;
    if (tx.createdBy !== user.userId) {
      throw new ForbiddenError('You can edit or delete only your own entries');
    }
    if ((await this.adminTouchedTxIds([tx.id])).has(tx.id)) {
      throw new ForbiddenError('This entry was added or updated by an Admin — it cannot be edited or deleted');
    }
  }

  static async createTransaction(
    input: TransactionCreateInput,
    user: UserSession,
    // Declare Transactions → Add (/declare_transaction_add/:shiftId/:date): a slip entered into
    // that shift's cycle of that date, declared or not ("<SHIFT> [DECLARE]"). The slip carries
    // that date (slip number + created_at) so every report counts it in that cycle. Every other
    // caller keeps the cut-off / "already declared" blocks below.
    opts?: { declareDate?: string }
  ) {
    const declareDate = opts?.declareDate;
    if (declareDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(declareDate)) {
      throw new AppError('Please select a valid date', 400);
    }

    // 1. Enforce shift cutoff for this role
    if (!declareDate) await ShiftService.assertShiftOpenForRole(input.shiftId, user.roleId, user.roleName, user.userId);

    // 2. Fetch Shift & Party details
    const [shift] = await db.select().from(shifts).where(eq(shifts.id, input.shiftId));
    if (!shift) throw new NotFoundError('Shift not found');

    if (declareDate) {
      // Today or an earlier day — never a date still to come
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      if (declareDate > today) {
        throw new AppError('Future date is not allowed', 400);
      }
    } else if (shift.status === 'DECLARED' || shift.status === 'AUDITED' || shift.declaredNumber) {
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
      const amt = this.signedAmount(entry.amount, this.isCompanyLedger(party));
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
    const dateStr = (declareDate || shift.openDate).replace(/-/g, '');
    const randPart = crypto.randomBytes(3).toString('hex').toUpperCase();
    const slipNumber = `SLIP-${dateStr}-${shift.name.slice(0, 3)}-${randPart}`;

    // Slip start for the Productivity Report: save time minus how long the operator took (measured
    // on the Add page, so no clock / timezone difference) — kept only when it is believable
    const elapsedMs = Number(input.elapsedMs);
    const keepStart = Number.isFinite(elapsedMs) && elapsedMs > 0 && elapsedMs < 6 * 60 * 60 * 1000;
    if (keepStart) await this.ensureStartedAtColumn().catch(() => undefined);

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
        // The party's rate at the time of entry (the column default was left on every slip)
        rateStr: this.partyRateStr(party),
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

      // Declare add: the slip sits on its cycle's date (at the time of day it was saved)
      if (declareDate) {
        const [moved] = await tx.update(transactions).set({
          createdAt: sql`${declareDate}::date + ${transactions.createdAt}::time`,
          updatedAt: sql`${declareDate}::date + ${transactions.createdAt}::time`,
        }).where(eq(transactions.id, header.id)).returning();
        if (moved) Object.assign(header, moved);
      }

      if (keepStart) {
        await tx.execute(sql`UPDATE transactions SET started_at = created_at - (${Math.round(elapsedMs)} * interval '1 millisecond') WHERE id = ${header.id}`);
      }

      // Create Audit Log
      await tx.insert(auditLogs).values({
        actorId: user.userId,
        action: 'CREATE',
        entityType: 'TRANSACTION',
        entityId: header.id.toString(),
        afterData: { slipNumber, totalAmount, entryCount: preparedEntries.length, ...(declareDate ? { declareDate } : {}) },
      });

      // Update creator staff live activity status & timestamp
      await tx.update(staff).set({
        isWorkingLive: true,
        updatedAt: new Date(),
      }).where(sql`user_id = ${user.userId} OR LOWER(username) = LOWER(${user.username})`).catch(() => {});

      return header;
    });

    // 8. Atomic Redis Jantri Increments (the cache holds only the shift's live cycle)
    if (!declareDate || declareDate === shift.openDate) try {
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
          // a deleted slip is never the "original" of a new one
          ne(transactions.status, 'VOIDED'),
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
    // A list scoped to a shift / day / party (Live Transactions, Declare Transactions, Trans
    // Audit) returns every slip of it — it used to stop at 100, so on a busy shift SUPER ADMIN
    // (who sees every operator's slips) got only the latest 100 while 200+ had been entered.
    // An unscoped call keeps the old default of 100; an explicit ?limit= is honoured.
    const MAX_LIST = 50000;
    const scoped = !!(filters.shiftId || filters.date || filters.partyId);
    const limit = filters.limit
      ? Math.min(MAX_LIST, Math.max(1, filters.limit))
      : (scoped ? MAX_LIST : 100);
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
      partyDaraRate: ledgers.daraRate,
      partyAkharRate: ledgers.akharRate,
      partyCommissionRate: ledgers.commissionRate,
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
    // in chunks, so a few thousand slips never exceed Postgres' bind-parameter limit
    const allEntries: Array<typeof transactionEntries.$inferSelect> = [];
    for (let i = 0; i < txIds.length; i += 5000) {
      const chunk = txIds.slice(i, i + 5000);
      allEntries.push(...await db.select().from(transactionEntries).where(inArray(transactionEntries.transactionId, chunk)));
    }

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
    const actorMap = await this.actorDisplayMap();
    // DATA ENTRY OPERATOR's list (scoped to their own slips): which ones an Admin-level user has
    // added / updated — the page hides Edit / Delete on those. Other roles: not needed, not run.
    const adminLocked = filters.ownerUserId ? await this.adminTouchedTxIds(txIds) : new Set<number>();

    // Slips edited after they were entered (Edit / amount change) — their Updated column shows
    // in red on the live list. Read from the UPDATE rows every edit already writes to
    // audit_logs, so slips edited before this existed are marked too.
    const editedRows = txIds.length > 0
      ? await db.selectDistinct({ entityId: auditLogs.entityId }).from(auditLogs).where(and(
          eq(auditLogs.entityType, 'TRANSACTION'),
          eq(auditLogs.action, 'UPDATE'),
          inArray(auditLogs.entityId, txIds.map(String)),
        ))
      : [];
    const editedIds = new Set(editedRows.map(r => r.entityId));

    return list.map(({ partyDaraRate, partyAkharRate, partyCommissionRate, ...t }) => ({
      ...t,
      isEdited: editedIds.has(String(t.id)),
      adminLocked: adminLocked.has(t.id),
      addedBy: this.showActor(actorMap, (placeholder(t.addedBy) ? nameByUser.get(t.createdBy) : t.addedBy) || t.addedBy) || 'SYSTEM',
      updatedBy: this.showActor(actorMap, (placeholder(t.updatedBy) ? nameByUser.get(t.createdBy) : t.updatedBy) || t.updatedBy) || 'SYSTEM',
      shiftName: t.shiftName || 'UNKNOWN',
      partyName: t.partyName || 'UNKNOWN',
      // Slips saved before the rate was written carry the column default — show the party's
      // own rate for those (live: AJNALA JLD "100/0-10/0", VINAY KAMAL HBD "95/5-9.5/5")
      rateStr: (t.rateStr && t.rateStr !== this.DEFAULT_RATE_STR)
        ? t.rateStr
        : this.partyRateStr({ daraRate: partyDaraRate, akharRate: partyAkharRate, commissionRate: partyCommissionRate }),
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
      partyDaraRate: ledgers.daraRate,
      partyAkharRate: ledgers.akharRate,
      partyCommissionRate: ledgers.commissionRate,
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
      const { partyDaraRate, partyAkharRate, partyCommissionRate, ...rest } = t;
      return {
        ...rest,
        rateStr: (t.rateStr && t.rateStr !== this.DEFAULT_RATE_STR)
          ? t.rateStr
          : this.partyRateStr({ daraRate: partyDaraRate, akharRate: partyAkharRate, commissionRate: partyCommissionRate }),
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
    await this.assertOperatorMayChange(existing, user);
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
      const amt = this.signedAmount(entry.amount, this.isCompanyLedger(party));
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
          rateStr: this.partyRateStr(party),
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
    await this.assertOperatorMayChange(existing, user);
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
  // The result declared for a shift on a day ("32"), or null while that day is undeclared —
  // the day's cycle number, else the shift's own number when the day is its open date (the
  // same rule the Daily Report uses). Jantri popups paint that number and its haruf red.
  static async declaredNumberFor(shiftId: number, date: string): Promise<string | null> {
    if (!shiftId || !date) return null;
    const [shift] = await db.select().from(shifts).where(eq(shifts.id, shiftId));
    if (!shift) return null;
    const [cycle] = await db.select().from(shiftCycles).where(
      and(eq(shiftCycles.shiftId, shiftId), eq(shiftCycles.cycleDate, date))
    );
    const n = cycle?.declaredNumber || (date === shift.openDate ? shift.declaredNumber : null);
    return n ? String(n).trim().padStart(2, '0') : null;
  }

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
    // HPL-Jantri (live, Live Transactions popup): each amount at the party's net — its
    // Commission off, then its Hissa rows off EXCEPT those paid to a SYSTEM account (the HP A/C
    // share stays in) — with the cells left exact (no rounding up to 50). Live HYDRABAD NIGHT
    // 08-10: DK ROHIT 20% (10% comm, Hissa "20 | DK ROHIT 20%") 100 -> 72; DK ROHIT 50%
    // (10% comm, Hissa "50 | HP A/C") 100 -> 90.
    hpl?: boolean;
    // Main Jantri (live, Live Transactions F7): Commission + Hissa off as above, but Amount
    // Less / Less %age come off each cell's exact amount BEFORE it is rounded up to 50.
    // Live HYDRABAD NIGHT 08-10 (cells exact 45, 36, 72, 144, 720 -> 50, 50, 100, 150, 750):
    // Less 10 -> 7: 710 -> 750 (book 1,100); Less 20 -> 7: 700 -> 700 (1,050);
    // Less 30 -> 5: 42 -> 50, 7: 690 -> 700 (1,000).
    mainJantri?: boolean;
    // Daily Report → Party popup (live): the party's own amounts as entered (no Commission /
    // Hissa off), each cell rounded up to whole 50s. Live JAI LUXMI 12-10: ANKUSH KUMAR 15/85
    // 5..35 a number -> 50 each (book 4,700); GANGA NAGAR 20,400 -> 20,400; HANUMANGARH B9
    // 117 -> 150.
    round50?: boolean;
  }) {
    const conditions = [
      eq(transactions.shiftId, filters.shiftId),
      // every slip that isn't deleted — a duplicate-flagged slip still counts (as on live)
      ne(transactions.status, 'VOIDED'),
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

      // Hissa = every Hissa Party row of the party (Ledger Update → Hissa), each taken off in
      // turn, the same way the net Jantri does. Live HYDRABAD NIGHT 06-10, Hissa ticked:
      // DK ROHIT 20% ("20 | DK ROHIT 20%", its own ledger) 1000 -> 800, and DK ROHIT 50%
      // ("50 | HP A/C") 2000 -> 1000.
      const hissaLinkFactorByParty = new Map<number, number>();
      if (filters.hissa || filters.hpl) {
        const hissaLinks = await db.select({
          ledgerId: ledgerThirdPartyLinks.ledgerId,
          percent: ledgerThirdPartyLinks.percent,
          partyName: ledgerThirdPartyLinks.partyName,
        })
          .from(ledgerThirdPartyLinks)
          .where(and(eq(ledgerThirdPartyLinks.linkType, 'HISSA'), inArray(ledgerThirdPartyLinks.ledgerId, partyIds)));
        // HPL leaves the Hissa paid to SYSTEM accounts (HP A/C) in
        const systemNames = new Set<string>();
        if (filters.hpl && !filters.hissa) {
          const sys = await db.select({ partyName: ledgers.partyName }).from(ledgers).where(eq(ledgers.groupName, 'SYSTEM'));
          for (const r of sys) systemNames.add((r.partyName || '').trim().toUpperCase());
          // …and the HP Ledgers (any ledger set as a party's Info → HP Ledger, e.g. ZZ BHARAT HPT
          // A/C): live HYDRABAD 13-10 keeps KR HBD's "ZZ BHARAT HPT A/C 10" share in (519 × 0.9),
          // the same as its "HP A/C 50" share.
          const hpLedgers = await pgSql<Array<{ party_name: string }>>`
            SELECT DISTINCT h.party_name FROM ledgers l JOIN ledgers h ON h.id = l.hp_ledger_id
            WHERE l.hp_ledger_id IS NOT NULL AND l.hp_ledger_id <> l.id
          `;
          for (const r of hpLedgers) systemNames.add((r.party_name || '').trim().toUpperCase());
        }
        for (const l of hissaLinks) {
          if (systemNames.has((l.partyName || '').trim().toUpperCase())) continue;
          const prev = hissaLinkFactorByParty.get(l.ledgerId) ?? 1;
          hissaLinkFactorByParty.set(l.ledgerId, prev * (1 - (parseFloat(l.percent) || 0) / 100));
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

        // Commission takes the party's own commission % off its amounts. Live HYDRABAD NIGHT
        // 06-10 (both parties at 10%), Commission ticked: 1000 -> 900, 2000 -> 1800, book
        // 11,000 -> 9,900. With Hissa as well the two apply one after the other:
        // 1000 x 0.9 x 0.8 = 720 and 2000 x 0.9 x 0.5 = 900 (cells then rounded, see below).
        if ((filters.commission || filters.hpl) && party) {
          const commPct = parseFloat(party.commissionRate) || 0;
          amt = amt * Math.max(0, 1 - commPct / 100);
        }
        if ((filters.hissa || filters.hpl) && party) {
          const hissaPct = parseFloat(party.hissaPercentage) || 0;
          const linkFactor = hissaLinkFactorByParty.get(party.id) ?? 1;
          amt = amt * Math.max(0, 1 - hissaPct / 100) * linkFactor;
        }

        // Akh-Mix (live): every Andar / Bahar amount is mixed into its ten numbers, a tenth
        // each — Andar d over d0..d9, Bahar d over 0d..9d — and the B / A rows read 0.
        // Live HYDRABAD NIGHT 06-10: B8 2000 -> 200 on 8, 18 .. 98; A9 2000 -> 200 on 90..99
        // (98 with both = 400); A2 100 -> 10 on 20..29, shown 50 (cells round up, below).
        // HPL-Jantri and Main Jantri (live) do the same: HYDRABAD 13-10 shows their B / A rows
        // empty, every haruf a tenth on its ten numbers (all 100 cells then match live).
        if ((filters.akhMix || filters.hpl || filters.mainJantri) && isHaruf) {
          const digit = String(e.numberValue).trim().slice(-1);
          for (let o = 0; o < 10; o++) {
            const numKey = e.entryType === 'HARUF_ANDAR' ? `${digit}${o}` : `${o}${digit}`;
            hash[numKey] = (hash[numKey] || 0) + amt / 10;
          }
          continue;
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
    // With Commission and/or Hissa taken off, or Akh mixed in, each cell shows in whole 50s
    // rounded up, as on live: 720 -> 750 (Commission + Hissa on DK ROHIT 20%), book 6,450;
    // Akh-Mix 210 -> 250, book 9,100 -> 9,500. An untouched book keeps its exact amounts.
    // HPL keeps its cells exact (live: 72, 90 — not rounded up to 50)
    const deducted = (!filters.hpl && !!(filters.commission || filters.hissa || filters.akhMix)) || !!filters.round50;
    const roundUp50 = (v: number) => (v > 0 ? Math.ceil(Math.round(v * 100) / 100 / 50) * 50 : 0);
    const applyLess = (raw: number): number => {
      if (filters.mainJantri) {
        let exact = raw;
        if (filters.amtLess && filters.amtLess > 0) exact = Math.max(0, exact - filters.amtLess);
        if (filters.lessPercent && filters.lessPercent > 0) exact = exact * (1 - filters.lessPercent / 100);
        // Live rounds the cell to whole rupees first, then up to 50: HYDRABAD 13-10 cell 18
        // 150.25 -> 150 (not 200); cell 25 101.42 -> 101 -> 150.
        return deducted ? roundUp50(Math.round(exact)) : exact;
      }
      let amt = deducted ? roundUp50(raw) : raw;
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

    const declaredNumber = await TransactionService.declaredNumberFor(filters.shiftId, filters.date);
    return { grid, haruf, declaredNumber };
  }

  // Kwada Transaction (live rule, from its screenshots): for the shift + day, a party is listed
  // when it has staked at least Amount on at least Count different numbers (its stake per
  // number = the sum over its live slips). Amount shows the party's total sale for the day.
  //   DK ROHIT 50% = 3 -> 100, 4 -> 100 (sale 200):  100 x 1 / 100 x 2 / 50 x 1 list it, 100 x 3 doesn't.
  static async findKwadaTransactions(filters: { shiftId?: number; date?: string; amount: number; count?: number }) {
    const conditions = [ne(transactions.status, 'VOIDED')];
    if (filters.shiftId) conditions.push(eq(transactions.shiftId, filters.shiftId));
    if (filters.date) conditions.push(sql`${transactions.createdAt}::date = ${filters.date}::date`);

    const slips = await db.select({
      id: transactions.id,
      partyId: transactions.partyId,
      partyName: ledgers.partyName,
      totalAmount: transactions.totalAmount,
    })
      .from(transactions)
      .leftJoin(ledgers, eq(transactions.partyId, ledgers.id))
      .where(and(...conditions));
    if (slips.length === 0) return [];

    const entries = await db.select({
      transactionId: transactionEntries.transactionId,
      numberValue: transactionEntries.numberValue,
      entryType: transactionEntries.entryType,
      amount: transactionEntries.amount,
    })
      .from(transactionEntries)
      .where(inArray(transactionEntries.transactionId, slips.map(t => t.id)));

    const partyOfSlip = new Map(slips.map(t => [t.id, t.partyId]));
    const party = new Map<number, { partyName: string; sale: number; perNumber: Map<string, number> }>();
    for (const t of slips) {
      const p = party.get(t.partyId) || { partyName: t.partyName || 'UNKNOWN', sale: 0, perNumber: new Map<string, number>() };
      p.sale += parseFloat(t.totalAmount) || 0;
      party.set(t.partyId, p);
    }
    for (const e of entries) {
      const p = party.get(partyOfSlip.get(e.transactionId)!);
      if (!p) continue;
      const key = `${e.entryType}:${e.numberValue}`;
      p.perNumber.set(key, (p.perNumber.get(key) || 0) + (parseFloat(e.amount) || 0));
    }

    const minCount = filters.count ?? 1;
    const rows = Array.from(party.entries())
      .map(([partyId, p]) => ({
        partyId,
        party: p.partyName,
        sale: p.sale,
        hits: Array.from(p.perNumber.values()).filter(v => v >= filters.amount).length,
      }))
      .filter(r => r.hits >= minCount);

    return rows.map((r, i) => ({ sr: i + 1, partyId: r.partyId, party: r.party, amount: Math.round(r.sale), count: r.hits }));
  }

  // "Abs Party" (Party Not Working) — parties who regularly transact in this shift (any
  // activity in the last 30 days) but have none today. "Work" is a best-effort proxy: their
  // slip count in that same 30-day lookback window (no other source for this metric exists
  // anywhere in the schema), flagged the same honest way TPC/HP-Amt/RBT are flagged elsewhere.
  // Live (Party Not Working, GHAZIABAD 08-10): A-Z list, every row Work = 3 — the regular
  // parties of the shift: they played it on each of the last 3 days (Work = those days) but
  // have no live slip in it today. AGARTALA EXPRESS, in today's book, isn't listed.
  static async getAbsentParties(filters: { shiftId: number; date: string }) {
    const WORK_DAYS = 3;
    const lookbackFrom = new Date(`${filters.date}T00:00:00Z`);
    lookbackFrom.setUTCDate(lookbackFrom.getUTCDate() - WORK_DAYS);
    const fromDateStr = lookbackFrom.toISOString().slice(0, 10);

    const historyRows = await db.select({ partyId: transactions.partyId, day: sql<string>`${transactions.createdAt}::date::text` })
      .from(transactions)
      .where(and(
        eq(transactions.shiftId, filters.shiftId),
        ne(transactions.status, 'VOIDED'),
        sql`${transactions.createdAt}::date >= ${fromDateStr}::date`,
        sql`${transactions.createdAt}::date < ${filters.date}::date`,
      ));

    // Work = the number of different days (of the last 3) the party played this shift
    const daysByParty = new Map<number, Set<string>>();
    for (const r of historyRows) {
      const set = daysByParty.get(r.partyId) || new Set<string>();
      set.add(r.day);
      daysByParty.set(r.partyId, set);
    }
    const workCount = new Map<number, number>();
    for (const [id, days] of daysByParty) {
      if (days.size >= WORK_DAYS) workCount.set(id, days.size);
    }
    if (workCount.size === 0) return [];

    const todayRows = await db.select({ partyId: transactions.partyId })
      .from(transactions)
      .where(and(
        eq(transactions.shiftId, filters.shiftId),
        ne(transactions.status, 'VOIDED'),
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
      .sort((a, b) => (a.partyName || '').toUpperCase().localeCompare((b.partyName || '').toUpperCase()))
      .map((p, i) => ({ sr: i + 1, id: p.id, party: p.partyName, mobile: p.mobile || '-', work: workCount.get(p.id) || 0 }));
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
  // beforeDeclarationId (optional): only the slips saved before that declaration's time — Trans
  // Before-After Declare's P&L-Before (the report as it stood when the result was declared).
  // Compared inside the database, so the stored wall-clock times are never re-zoned. Off for the
  // Daily Report itself.
  static async getDailyReport(filters: { shiftId: number; date?: string; agentId?: number; beforeDeclarationId?: number }) {
    const [shift] = await db.select().from(shifts).where(eq(shifts.id, filters.shiftId));
    if (!shift) throw new NotFoundError('Shift not found');

    const dateFilter = filters.date || shift.openDate;

    // Live: the Daily Report only shows a shift once its result is declared for that day — an
    // undeclared shift gives "Record not avaliable!" with an empty table. Declared = that day's
    // cycle is DECLARED / AUDITED (or has a result number); for the shift's current day, the
    // shift's own state; a past day with no cycle row the shift has already moved past counts
    // as declared (a shift only moves on after declaring).
    const declaredStatuses = ['DECLARED', 'AUDITED'];
    const [cycle] = await db.select().from(shiftCycles).where(
      and(eq(shiftCycles.shiftId, shift.id), eq(shiftCycles.cycleDate, dateFilter))
    );
    let isDeclared: boolean;
    if (cycle && (declaredStatuses.includes(cycle.status) || cycle.declaredNumber)) {
      isDeclared = true;
    } else if (dateFilter === shift.openDate) {
      isDeclared = !!shift.declaredNumber || declaredStatuses.includes(shift.status);
    } else {
      isDeclared = !cycle && !!shift.openDate && dateFilter < shift.openDate;
    }
    if (!isDeclared) {
      return {
        shiftId: shift.id,
        shiftName: shift.name,
        date: dateFilter,
        isDeclared: false,
        partyCount: 0,
        profit: 0,
        rows: [],
        masterTotal: { totalSale: 0, dSale: 0, aSale: 0, comm: 0, oDara: 0, oAkhar: 0, tpc: 0, hissa: 0, debit: 0, credit: 0 },
      };
    }

    const txRows = await db.select().from(transactions).where(
      and(
        eq(transactions.shiftId, filters.shiftId),
        ne(transactions.status, 'VOIDED'),
        sql`${transactions.createdAt}::date = ${dateFilter}::date`,
        ...(filters.beforeDeclarationId
          ? [sql`${transactions.createdAt} < (SELECT d.declared_at FROM declarations d WHERE d.id = ${filters.beforeDeclarationId})`]
          : []),
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
          groupName: ledgers.groupName,
        }).from(ledgers).where(inArray(ledgers.id, partyIds))
      : [];
    const partyById = new Map(partyRows.map(p => [p.id, p]));

    const agentIds = Array.from(new Set(partyRows.map(p => p.agentId).filter((id): id is number => id != null)));
    const agentRows = agentIds.length > 0
      ? await db.select({ id: agents.id, agentName: agents.agentName }).from(agents).where(inArray(agents.id, agentIds))
      : [];
    const agentNameById = new Map(agentRows.map(a => [a.id, a.agentName]));

    // S-Hissa (live Daily Report): the share the party keeps itself — its Self Hissa plus every
    // Hissa Party row (Ledger Update → Hissa) naming the party's OWN ledger. Live: AGARTALA
    // EXPRESS "50 | AGARTALA EXPRESS" -> 50; DK ROHIT 20% "20 | DK ROHIT 20%" -> 20; a row to
    // another ledger ("50 | HP A/C") is not the party's own share -> 0. Same rule as the
    // Transaction ASC report's S-Hissa.
    const dailyHissaLinks = partyIds.length > 0
      ? await db.select({
          ledgerId: ledgerThirdPartyLinks.ledgerId,
          partyName: ledgerThirdPartyLinks.partyName,
          percent: ledgerThirdPartyLinks.percent,
        })
          .from(ledgerThirdPartyLinks)
          .where(and(eq(ledgerThirdPartyLinks.linkType, 'HISSA'), inArray(ledgerThirdPartyLinks.ledgerId, partyIds)))
      : [];
    const selfHissaOf = (party: typeof partyRows[number] | undefined): number => {
      if (!party) return 0;
      const ownName = (party.partyName || '').trim().toUpperCase();
      // Re-Config's Self Hissa box and a Hissa Party row naming the party itself are the same
      // share on live (X RK KHANNA: Self Hissa 50 + "X RK KHANNA 50" -> 50%, not 100%), so the
      // larger of the two counts — with only one of them set, nothing changes
      const field = parseFloat(party.hissaPercentage || '0') || 0;
      let links = 0;
      for (const l of dailyHissaLinks) {
        if (l.ledgerId !== party.id) continue;
        if ((l.partyName || '').trim().toUpperCase() === ownName) links += parseFloat(l.percent) || 0;
      }
      return Math.max(field, links);
    };

    // The result of the day being reported: that day's cycle number (a past day must not use
    // the shift's current result), else the shift's own number for its current day
    const dayResult = cycle?.declaredNumber || (dateFilter === shift.openDate ? shift.declaredNumber : null);
    const declaredNumber = dayResult ? dayResult.padStart(2, '0') : null;
    const tensDigit = declaredNumber?.[0];
    const unitsDigit = declaredNumber?.[1];

    // O-Dara / O-Akhar (live) show the AMOUNT played on the result (ANKUSH KUMAR 5, GANGA NAGAR
    // 150); the payout (amount × the entry's rate, 5 × 90 = 450) is what comes off the book.
    const perParty = new Map<number, { totalSale: number; dSale: number; aSale: number; oDara: number; oAkhar: number; payout: number }>();

    for (const tx of txRows) {
      if (!perParty.has(tx.partyId)) perParty.set(tx.partyId, { totalSale: 0, dSale: 0, aSale: 0, oDara: 0, oAkhar: 0, payout: 0 });
      const agg = perParty.get(tx.partyId)!;
      agg.totalSale += parseFloat(tx.totalAmount);

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

    // Book of each party (Sale + Comm − Payout) — the base the Hissa rows to OTHER ledgers
    // (e.g. "50 | HP A/C") are cut from, below
    const dailyTpc = await TransactionService.tpcPctByLedger(partyIds);
    const bookByParty = new Map<number, number>();
    // Each party's book parts, for the receiver popup's cut list (HP A/C → who was cut, how much)
    const bookPartsByParty = new Map<number, { totalSale: number; comm: number; payout: number }>();
    // Live rounds Debit / Credit half away from zero (RAM HBD −725 × 50% -> Credit 363,
    // YAMUNANAGAR 2799 × 50% -> Debit 1400) and the Hissa column half up (−1399.5 -> −1399,
    // +362.5 -> 363). `+ 0` turns −0 into 0.
    const roundAway = (v: number) => Math.sign(v) * Math.round(Math.abs(v)) + 0;
    const roundHalfUp = (v: number) => Math.round(v) + 0;
    // Company ledgers (X DB …) on the day — kept out of the Master Total's sale columns, below
    const companyPartyIds = new Set<number>();
    let rows = Array.from(perParty.entries()).map(([partyId, agg]) => {
      const party = partyById.get(partyId);
      const commissionRate = parseFloat(party?.commissionRate || '0');
      const hissaPct = selfHissaOf(party);
      const commExact = TransactionService.partyComm(agg.totalSale, agg.dSale, agg.aSale, commissionRate, dailyTpc.get(partyId));
      // Shown rounded (live ANSHIKA 525 -> −52, HANUMANGARH 7087 -> −709); the book keeps the exact cut
      const comm = Math.round(commExact) + 0;
      // Live: Book = Sale + Comm − Payout (O-Dara + O-Akhar); Hissa = −Book × S-Hissa%;
      // Closing = Book + Hissa -> Debit when above 0, Credit when below. AGARTALA EXPRESS
      // 12270 − 1227 − 9000 = 2043 -> Hissa −1021, Debit 1022; ABHISHEK RAWLA (S-Hissa 0)
      // 8100 − 810 − 9000 -> Credit 1710; ANUPGARH 3000 − 600 -> Debit 2400.
      // Live JAI LUXMI 13-09: ANKUSH KUMAR 2420 − 242 − 450 -> Debit 1728; ANSHIKA 525 − 52.5 =
      // 472.5 -> Hissa −236, Debit 236; RAM HBD 3775 − 4500 = −725 -> Hissa 363, Credit 363.
      const book = agg.totalSale + commExact - agg.payout;
      bookByParty.set(partyId, book);
      bookPartsByParty.set(partyId, { totalSale: agg.totalSale, comm: Math.round(commExact * 100) / 100, payout: agg.payout });
      const hissa = roundHalfUp(-(book * hissaPct / 100));
      const closing = roundAway(book * (100 - hissaPct) / 100);

      // A Company ledger's row (live): Agent NA, Rate blank, S-Hissa 0 — its Hissa still applies
      const isCompany = !!party && TransactionService.isCompanyLedger(party);
      if (isCompany) companyPartyIds.add(partyId);
      return {
        partyId,
        partyName: party?.partyName || 'UNKNOWN',
        agentId: party?.agentId ?? null,
        agentName: party?.agentId ? (agentNameById.get(party.agentId) || '-') : (isCompany ? 'NA' : '-'),
        cap: parseFloat(party?.capping || '0'),
        // Rate / commission, as live: "90/10-9/10", RAM HBD (no commission) "100/0-10/0",
        // VINAY KAMAL HBD "95/5-9.5/5" (decimals kept)
        rate: isCompany ? '' : (party ? TransactionService.partyRateStr(party) : '0/0-0/0'),
        sHissa: isCompany ? 0 : hissaPct,
        totalSale: agg.totalSale,
        dSale: agg.dSale,
        aSale: agg.aSale,
        comm,
        oDara: agg.oDara,
        oAkhar: agg.oAkhar,
        tpc: 0,
        hissa,
        debit: closing > 0 ? closing : 0,
        credit: closing < 0 ? -closing : 0,
      };
    });

    // Hissa cut to another ledger (live): a party's Hissa Party row naming a DIFFERENT ledger
    // (Ledger Update → Re-Config → "HP A/C 20") sends that % of the party's book to it. The
    // receiver gets its own row (even with no sales of its own): Hissa −share, and the share
    // lands in its Credit (or nets against its own book). The giving party's row is unchanged.
    // Live JAI LUXMI 13-09: ANKUSH KUMAR 15/85 book 1728 × 50% -> HP A/C Hissa −864, Credit 864;
    // KSG SANTOSH 90/10 482 × 40% -> ZZ ASLAM 40 −193, Credit 193.
    const sharesByReceiver = new Map<string, number>();
    // Per receiver: every party cut into it (Daily Report → click HP A/C)
    type HissaCut = { partyId: number; partyName: string; agentName: string; totalSale: number; comm: number; payout: number; book: number; sHissa: number; percent: number; cutAmount: number };
    const cutsByReceiver = new Map<string, HissaCut[]>();
    for (const l of dailyHissaLinks) {
      const giver = partyById.get(l.ledgerId);
      const receiverName = (l.partyName || '').trim().toUpperCase();
      if (!giver || !receiverName) continue;
      if (receiverName === (giver.partyName || '').trim().toUpperCase()) continue; // own share = S-Hissa
      const book = bookByParty.get(l.ledgerId);
      const pct = parseFloat(l.percent) || 0;
      if (book === undefined || !pct) continue;
      // Exact shares are added up and rounded once per receiver (live 12-10: ANKUSH 551.25 +
      // DAKSH 589.5 = 1140.75 -> HP A/C 1141, not 552 + 590). The share is taken from what is
      // left after the party's own S-Hissa: live HYDRABAD 13-10 SHERA BHARAT (S-Hissa 30,
      // "HP A/C 20") 594 × 0.7 × 20% = 83.16 -> HP A/C −83.
      const giverSHissa = selfHissaOf(giver);
      const share = book * (1 - giverSHissa / 100) * pct / 100;
      if (!share) continue;
      sharesByReceiver.set(receiverName, (sharesByReceiver.get(receiverName) || 0) + share);
      const parts = bookPartsByParty.get(l.ledgerId);
      const cuts = cutsByReceiver.get(receiverName) || [];
      cuts.push({
        partyId: giver.id,
        partyName: giver.partyName,
        agentName: giver.agentId ? (agentNameById.get(giver.agentId) || '-') : '-',
        totalSale: parts?.totalSale || 0,
        comm: parts?.comm || 0,
        payout: Math.round((parts?.payout || 0) * 100) / 100,
        book: Math.round(book * 100) / 100,
        sHissa: giverSHissa,
        percent: pct,
        cutAmount: Math.round(share * 100) / 100,
      });
      cutsByReceiver.set(receiverName, cuts);
    }
    for (const [name, total] of sharesByReceiver) sharesByReceiver.set(name, roundAway(total));
    if (sharesByReceiver.size > 0) {
      const receiverNames = Array.from(sharesByReceiver.keys());
      const receiverLedgers = await db.select({
        id: ledgers.id,
        partyName: ledgers.partyName,
        agentId: ledgers.agentId,
        capping: ledgers.capping,
        daraRate: ledgers.daraRate,
        akharRate: ledgers.akharRate,
        commissionRate: ledgers.commissionRate,
      }).from(ledgers).where(inArray(sql`UPPER(TRIM(${ledgers.partyName}))`, receiverNames));
      const receiverAgentIds = receiverLedgers
        .map(r => r.agentId)
        .filter((id): id is number => id != null && !agentNameById.has(id));
      if (receiverAgentIds.length > 0) {
        const more = await db.select({ id: agents.id, agentName: agents.agentName }).from(agents).where(inArray(agents.id, receiverAgentIds));
        for (const a of more) agentNameById.set(a.id, a.agentName);
      }
      for (const name of receiverNames) {
        const share = sharesByReceiver.get(name) || 0;
        if (!share) continue;
        const ledger = receiverLedgers.find(r => (r.partyName || '').trim().toUpperCase() === name);
        const existing = rows.find(r => (ledger && r.partyId === ledger.id) || r.partyName.trim().toUpperCase() === name);
        const hissaCuts = (cutsByReceiver.get(name) || []).sort((a, b) => a.partyName.localeCompare(b.partyName));
        if (existing) {
          (existing as typeof existing & { hissaCuts?: HissaCut[] }).hissaCuts = hissaCuts;
          existing.hissa += -share;
          const closing = existing.debit - existing.credit - share;
          existing.debit = closing > 0 ? closing : 0;
          existing.credit = closing < 0 ? -closing : 0;
          continue;
        }
        // Live: the receiver gets one row per Rate + S-Hissa of the parties cut into it, the row
        // showing that Rate and S-Hissa. HYDRABAD 13-10 → four HP A/C rows: 100/0-10/0 (KAMAL,
        // AJNALA), 95/5-9.5/5 (VINAY), 90/10-9/10 S-Hissa 30 (SHERA) and 90/10-9/10
        // (AARAV 31.6 + GULATI 832.5 + HASH 165.6 + KR 233.5 + OM 472.8 = −1736).
        const groups = new Map<string, { rate: string; sHissa: number; exact: number; cuts: HissaCut[] }>();
        for (const c of cutsByReceiver.get(name) || []) {
          const giverRow = rows.find(r => r.partyId === c.partyId);
          const rate = giverRow?.rate || '';
          const sHissa = giverRow?.sHissa || 0;
          const key = `${rate}|${sHissa}`;
          const g = groups.get(key) || { rate, sHissa, exact: 0, cuts: [] };
          g.exact += (bookByParty.get(c.partyId) ?? c.book) * (1 - c.sHissa / 100) * c.percent / 100;
          g.cuts.push(c);
          groups.set(key, g);
        }
        for (const g of groups.values()) {
          const gShare = roundAway(g.exact);
          if (!gShare) continue;
          rows.push({
            partyId: ledger?.id ?? 0,
            partyName: ledger?.partyName || name,
            agentId: ledger?.agentId ?? null,
            agentName: ledger?.agentId ? (agentNameById.get(ledger.agentId) || 'NA') : 'NA',
            cap: parseFloat(ledger?.capping || '0'),
            rate: g.rate,
            sHissa: g.sHissa,
            totalSale: 0,
            dSale: 0,
            aSale: 0,
            comm: 0,
            oDara: 0,
            oAkhar: 0,
            tpc: 0,
            hissa: -gShare,
            debit: gShare < 0 ? -gShare : 0,
            credit: gShare > 0 ? gShare : 0,
            hissaCuts: g.cuts.sort((a, b) => a.partyName.localeCompare(b.partyName)),
          } as typeof rows[number]);
        }
        void hissaCuts;
      }
    }

    if (filters.agentId) {
      rows = rows.filter(r => r.agentId === filters.agentId);
    }
    rows.sort((a, b) => a.partyName.localeCompare(b.partyName));

    const sum = (key: 'totalSale' | 'dSale' | 'aSale' | 'comm' | 'oDara' | 'oAkhar' | 'hissa' | 'debit' | 'credit') =>
      rows.reduce((s, r) => s + r[key], 0);
    const saleSum = (key: 'totalSale' | 'dSale' | 'aSale') =>
      rows.reduce((s, r) => s + (companyPartyIds.has(r.partyId) ? 0 : r[key]), 0);


    return {
      shiftId: shift.id,
      shiftName: shift.name,
      date: dateFilter,
      isDeclared: true,
      partyCount: rows.length,
      // Live: Profit = Debit − Credit of the rows (Sale + Comm − Payout + Hissa), e.g. JAI
      // LUXMI 13-09 14095 − 5245 = 8850
      profit: Math.round(sum('debit') - sum('credit')),
      rows,
      masterTotal: {
        // Live: Total / D / A-Sale add up the parties' sale only — a Company ledger's (negative)
        // sale stays on its own row. DELHI BAZAAR 19-10: X DB −49,950 left out -> 632,710 /
        // 613,930, while its Comm (4,995), O-Dara, Hissa and Credit still count in their totals.
        totalSale: saleSum('totalSale'),
        dSale: saleSum('dSale'),
        aSale: saleSum('aSale'),
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
          partyName: ledgers.partyName,
          hissaPercentage: ledgers.hissaPercentage,
          commissionRate: ledgers.commissionRate,
          akharRate: ledgers.akharRate,
        }).from(ledgers).where(inArray(ledgers.id, partyIds))
      : [];
    const partyById = new Map(partyRows.map(p => [p.id, p]));

    // Hissa Party rows (Ledger → Re-Config): the party's own share (S-Hissa — the larger of the
    // Self Hissa box and the rows naming the party itself) and every share cut to another ledger
    // (HP A/C, ZZ ASLAM 40 …), the same Hissa the Daily Report's Master Total adds up per day.
    const plHissaLinks = partyIds.length > 0
      ? await db.select({ ledgerId: ledgerThirdPartyLinks.ledgerId, partyName: ledgerThirdPartyLinks.partyName, percent: ledgerThirdPartyLinks.percent })
          .from(ledgerThirdPartyLinks)
          .where(and(eq(ledgerThirdPartyLinks.linkType, 'HISSA'), inArray(ledgerThirdPartyLinks.ledgerId, partyIds)))
      : [];
    const hissaSplitByParty = new Map<number, { self: number; others: number[] }>();
    for (const p of partyRows) {
      const own = (p.partyName || '').trim().toUpperCase();
      let selfLinks = 0;
      const others: number[] = [];
      for (const l of plHissaLinks) {
        if (l.ledgerId !== p.id) continue;
        const pct = parseFloat(l.percent) || 0;
        if ((l.partyName || '').trim().toUpperCase() === own) selfLinks += pct;
        else others.push(pct);
      }
      hissaSplitByParty.set(p.id, { self: Math.max(parseFloat(p.hissaPercentage || '0') || 0, selfLinks), others });
    }

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
        let rate = parseFloat(e.rate);
        // Older slips saved haruf as a "number": 4 of the same digit (5555) is Andar 5, 3 (555)
        // is Bahar 5 — Akhar sale at the party's Akhar rate, as every slip page shows them
        let entryType = e.entryType;
        let numberValue = e.numberValue;
        if (entryType === 'DARA') {
          const v = (numberValue || '').trim();
          const legacy = /^(\d)\1{3}$/.test(v) ? 'HARUF_ANDAR' : /^(\d)\1{2}$/.test(v) ? 'HARUF_BAHAR' : null;
          if (legacy) {
            entryType = legacy;
            numberValue = v[0];
            rate = parseFloat(partyById.get(tx.partyId)?.akharRate || String(rate)) || rate;
          }
        }
        if (entryType === 'DARA') {
          agg.dSale += amt;
          if (declaredNumber && numberValue === declaredNumber) { agg.oDara += amt; agg.payout += amt * rate; }
        } else {
          agg.aSale += amt;
          if (declaredNumber) {
            if (entryType === 'HARUF_ANDAR' && numberValue === tensDigit) { agg.oAkhar += amt; agg.payout += amt * rate; }
            else if (entryType === 'HARUF_BAHAR' && numberValue === unitsDigit) { agg.oAkhar += amt; agg.payout += amt * rate; }
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
      const comm = -(agg.totalSale * commissionRate / 100);
      const book = agg.totalSale + comm - agg.payout;
      // Hissa = own share + every share cut to another ledger, each taken from what is left after
      // the party's S-Hissa — the Daily Report's per-day Hissa (live HYDRABAD 13-10: SHERA BHARAT
      // S-Hissa 30, "HP A/C 20": 594 × 30% + 594 × 0.7 × 20% = 178.2 + 83.2)
      const split = hissaSplitByParty.get(partyId) || { self: 0, others: [] };
      const hissa = -(book * split.self / 100) - split.others.reduce((sum, pct) => sum + book * (1 - split.self / 100) * pct / 100, 0);
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
  // Every money column is a party balance, Dr − Cr (positive = the party owes), checked against
  // the live report 12-10-2026:
  //   Total / Dara / Akhar Sale  the party's slips in the range (Dara = number entries)
  //   Comm       = −Total Sale × party Comm%
  //   Dara/Akhar Open = stake on that day's declared number / its Andar+Bahar haruf (not payout)
  //   Payout     = Σ winning stake × that entry's rate  (each day judged on its OWN result)
  //   Book       = Total Sale + Comm − Payout
  //   Hissa      = −Book × S-Hissa% (Self Hissa + Hissa Party rows naming the party itself), plus
  //                for a ledger that RECEIVES Hissa (another party's Hissa Party row names it,
  //                e.g. ZZ ASLAM 40) −Σ that party's Book × %. Shares to HP A/C are not added here:
  //                HP A/C is settled for the whole month by Hawa Patti (HP-Amt below).
  //   TPC        = −Σ commission the party earns through other ledgers' 3rd Party Comm rows
  //                (their Dara Sale × D-Comm% + Akhar Sale × A-Comm%)
  //   T-Profit   = Book + Hissa + TPC
  //   Kist / Rebate / HP-Amt / Payment = the ledger's KIST / VAPSI / HAWA_PATTI / cash + other
  //                vouchers in the range (Dr − Cr; LIMIT vouchers are a credit limit, not money)
  //   Opening    = the same balance up to the day before From (every earlier voucher + every
  //                earlier day's T-Profit), i.e. the previous day's Closing
  //   Closing    = Opening + T-Profit + Kist + Rebate + HP-Amt + Payment
  //   DayAv      = days in the range the party had a sale
  // Live AARIT KARNAL: 901960 − 90196 − 8030×90 = 89064; −533607 + 89064 − 100000 = −544543.
  // Live AHAAN 25%: 136460 − 13646 − 370×90 − 500×9 = 85014, Hissa −21253 → 63761;
  //   −13524 + 63761 − 49000 = 1237.
  // settledOnly (Limit & Balance Report): leave out slips of shifts still running — today's
  // undeclared cycle — since those are counted there as TransConsum. Off for every other caller.
  private static async allShiftGame(fromDate: string | null, toDate: string, settledOnly = false) {
    const fromCond = fromDate ? pgSql`AND t.created_at::date >= ${fromDate}::date` : pgSql``;
    const runningCond = settledOnly
      ? pgSql`AND NOT COALESCE(s.declared_number IS NULL AND s.status NOT IN ('DECLARED', 'AUDITED') AND t.created_at::date::text = s.open_date, false)`
      : pgSql``;
    const saleRows = await pgSql<Array<{ party_id: number; day: string; sale: string }>>`
      SELECT t.party_id, t.created_at::date::text AS day, SUM(t.total_amount) AS sale
      FROM transactions t
      JOIN shifts s ON s.id = t.shift_id
      WHERE t.status <> 'VOIDED' ${fromCond} AND t.created_at::date <= ${toDate}::date ${runningCond}
      GROUP BY t.party_id, t.created_at::date
    `;
    // Each (shift, day) is judged on that day's own result: its cycle's number, else the
    // shift's current number when the day is the shift's open day.
    const entryRows = await pgSql<Array<{ party_id: number; d_sale: string; a_sale: string; d_open: string; a_open: string; payout: string }>>`
      SELECT x.party_id,
        SUM(CASE WHEN x.entry_type = 'DARA' THEN x.amount ELSE 0 END) AS d_sale,
        SUM(CASE WHEN x.entry_type <> 'DARA' THEN x.amount ELSE 0 END) AS a_sale,
        SUM(CASE WHEN x.entry_type = 'DARA' AND x.number_value = x.dn THEN x.amount ELSE 0 END) AS d_open,
        SUM(CASE WHEN (x.entry_type = 'HARUF_ANDAR' AND x.number_value = substr(x.dn, 1, 1))
                   OR (x.entry_type = 'HARUF_BAHAR' AND x.number_value = substr(x.dn, 2, 1)) THEN x.amount ELSE 0 END) AS a_open,
        SUM(CASE WHEN (x.entry_type = 'DARA' AND x.number_value = x.dn)
                   OR (x.entry_type = 'HARUF_ANDAR' AND x.number_value = substr(x.dn, 1, 1))
                   OR (x.entry_type = 'HARUF_BAHAR' AND x.number_value = substr(x.dn, 2, 1)) THEN x.amount * x.rate ELSE 0 END) AS payout
      FROM (
        SELECT t.party_id, e.entry_type, e.number_value, e.amount, e.rate,
          lpad(COALESCE(
            CASE WHEN c.status IN ('DECLARED', 'AUDITED') OR c.declared_number IS NOT NULL THEN c.declared_number END,
            CASE WHEN s.open_date = t.created_at::date::text THEN s.declared_number END
          ), 2, '0') AS dn
        FROM transaction_entries e
        JOIN transactions t ON t.id = e.transaction_id
        JOIN shifts s ON s.id = t.shift_id
        LEFT JOIN shift_cycles c ON c.shift_id = t.shift_id AND c.cycle_date = t.created_at::date::text
        WHERE t.status <> 'VOIDED' ${fromCond} AND t.created_at::date <= ${toDate}::date ${runningCond}
      ) x
      GROUP BY x.party_id
    `;

    type Agg = { totalSale: number; dSale: number; aSale: number; dOpen: number; aOpen: number; payout: number; days: Set<string> };
    const agg = new Map<number, Agg>();
    const get = (id: number) => {
      let a = agg.get(id);
      if (!a) { a = { totalSale: 0, dSale: 0, aSale: 0, dOpen: 0, aOpen: 0, payout: 0, days: new Set() }; agg.set(id, a); }
      return a;
    };
    for (const r of saleRows) {
      const a = get(r.party_id);
      a.totalSale += parseFloat(r.sale) || 0;
      a.days.add(r.day);
    }
    for (const r of entryRows) {
      const a = get(r.party_id);
      a.dSale += parseFloat(r.d_sale) || 0;
      a.aSale += parseFloat(r.a_sale) || 0;
      a.dOpen += parseFloat(r.d_open) || 0;
      a.aOpen += parseFloat(r.a_open) || 0;
      a.payout += parseFloat(r.payout) || 0;
    }
    return agg;
  }

  static async getAllShiftReport(filters: {
    fromDate: string;
    toDate: string;
    agentId?: number;
    dealing?: string;
    partyStatus?: 'ACTIVE' | 'INACTIVE';
    search?: string;
    searchMode?: 'START_WITH' | 'CONTAINS' | 'END_WITH';
    // Limit & Balance Report: game of running (undeclared) shifts left out, see allShiftGame
    settledOnly?: boolean;
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

    if (partyRows.length === 0) return { rows: [], dealOptions };

    // Every ledger's rates and Hissa / 3rd Party Comm set-up — a party's T-Profit can come from
    // other ledgers' links, so this is not limited to the listed rows.
    const allLedgers = await db.select({
      id: ledgers.id,
      partyName: ledgers.partyName,
      commissionRate: ledgers.commissionRate,
      hissaPercentage: ledgers.hissaPercentage,
      rebate: ledgers.rebate,
      hpLedgerId: ledgers.hpLedgerId,
    }).from(ledgers);
    const ledgerById = new Map(allLedgers.map(l => [l.id, l]));
    const idByName = new Map<string, number>();
    for (const l of allLedgers) idByName.set((l.partyName || '').trim().toUpperCase(), l.id);
    const links = await db.select({
      ledgerId: ledgerThirdPartyLinks.ledgerId,
      linkType: ledgerThirdPartyLinks.linkType,
      partyName: ledgerThirdPartyLinks.partyName,
      percent: ledgerThirdPartyLinks.percent,
      dComm: ledgerThirdPartyLinks.dComm,
      aComm: ledgerThirdPartyLinks.aComm,
    }).from(ledgerThirdPartyLinks).where(inArray(ledgerThirdPartyLinks.linkType, ['HISSA', 'TPC']));

    // Comm / Book / Hissa / TPC per ledger from a game aggregate (see the comment above)
    type Game = Awaited<ReturnType<typeof TransactionService.allShiftGame>>;
    const allShiftTpc = await TransactionService.tpcPctByLedger();
    const tProfitOf = (game: Game) => {
      const out = new Map<number, { comm: number; book: number; hissa: number; tpc: number }>();
      const get = (id: number) => {
        let o = out.get(id);
        if (!o) { o = { comm: 0, book: 0, hissa: 0, tpc: 0 }; out.set(id, o); }
        return o;
      };
      for (const [id, a] of game) {
        const l = ledgerById.get(id);
        const comm = TransactionService.partyComm(a.totalSale, a.dSale, a.aSale, parseFloat(l?.commissionRate || '0'), allShiftTpc.get(id));
        const o = get(id);
        o.comm = comm;
        o.book = a.totalSale + comm - a.payout;
      }
      // Self share: the larger of Re-Config's Self Hissa box and the Hissa Party rows naming the
      // party itself (the same share on live — see getDailyReport)
      const selfLinkPct = new Map<number, number>();
      for (const k2 of links) {
        if (k2.linkType !== 'HISSA') continue;
        const own = (ledgerById.get(k2.ledgerId)?.partyName || '').trim().toUpperCase();
        if ((k2.partyName || '').trim().toUpperCase() === own) selfLinkPct.set(k2.ledgerId, (selfLinkPct.get(k2.ledgerId) || 0) + (parseFloat(k2.percent) || 0));
      }
      for (const [id] of game) {
        const o = get(id);
        const selfPct = Math.max(parseFloat(ledgerById.get(id)?.hissaPercentage || '0') || 0, selfLinkPct.get(id) || 0);
        o.hissa += -(o.book * selfPct / 100);
      }
      for (const k of links) {
        const giver = game.get(k.ledgerId);
        if (!giver) continue;
        const name = (k.partyName || '').trim().toUpperCase();
        const ownName = (ledgerById.get(k.ledgerId)?.partyName || '').trim().toUpperCase();
        if (k.linkType === 'HISSA') {
          const pct = parseFloat(k.percent) || 0;
          const book = out.get(k.ledgerId)?.book || 0;
          if (!pct || !book) continue;
          if (name === ownName) {
            continue; // counted above as the self share
          } else if (name !== TransactionService.HP_ACCOUNT) {
            const receiverId = idByName.get(name);
            if (receiverId) get(receiverId).hissa += -(book * pct / 100);
          }
        } else {
          const receiverId = idByName.get(name);
          if (!receiverId) continue;
          const earned = giver.dSale * (parseFloat(k.dComm) || 0) / 100 + giver.aSale * (parseFloat(k.aComm) || 0) / 100;
          if (earned) get(receiverId).tpc += -earned;
        }
      }
      return out;
    };

    const dayBefore = new Date(`${filters.fromDate}T00:00:00Z`);
    dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
    const dayBeforeStr = dayBefore.toISOString().slice(0, 10);

    const [gameNow, gameBefore] = await Promise.all([
      this.allShiftGame(filters.fromDate, filters.toDate, !!filters.settledOnly),
      this.allShiftGame(null, dayBeforeStr, !!filters.settledOnly),
    ]);
    const nowByParty = tProfitOf(gameNow);
    const beforeByParty = tProfitOf(gameBefore);

    // Month-end HR (live: Rebate / HP-Amt are worked out when the range ends on a month's last
    // day — a single day mid-month shows 0, 01-09 → 30-09 shows them). For every party with a
    // game in the range, booked to its HP party (Info → HP Ledger, else itself):
    //   HP-Base = T-Profit when it has a Hissa Party row to HP A/C, HP-% that row's %, HP-Amt = Base × %
    //   RBT-Base = T-Profit when above 0, RBT-% = ledger Rebate, RBT-Amt = (T-Profit − HP-Amt) × %
    //   T-HR = HP-Amt + RBT-Amt; the HP party's Rebate / HP-Amt columns = −Σ (Cr to it)
    // Live AARAV JLD HBD Sep: 3812 × 20% = 762 → HP-Amt −762, (3812 − 762.4) × 10% → Rebate −305;
    // MIRJA WASIM: 756819 × 15% = 113523, (756819 − 113523) × 10% = 64330, plus MIRJA WASIM 40%
    // (HP Ledger MIRJA WASIM) −17910 × 50% = −8955 → HR 168898.
    const toD = new Date(`${filters.toDate}T00:00:00Z`);
    const nextD = new Date(toD); nextD.setUTCDate(nextD.getUTCDate() + 1);
    const monthEnd = nextD.getUTCDate() === 1;
    type HrRow = { partyId: number; partyName: string; hpBase: number; hpPct: number; hpAmt: number; rbtBase: number; rbtPct: number; rbtAmt: number; tHr: number; settleAmt: number };
    const hrByHpParty = new Map<number, HrRow[]>();
    if (monthEnd) {
      const hpPct = new Map<number, number>();
      for (const k of links) {
        if (k.linkType !== 'HISSA') continue;
        if ((k.partyName || '').trim().toUpperCase() !== TransactionService.HP_ACCOUNT) continue;
        hpPct.set(k.ledgerId, (hpPct.get(k.ledgerId) || 0) + (parseFloat(k.percent) || 0));
      }
      for (const [id, o] of nowByParty) {
        if (!gameNow.has(id)) continue;
        const l = ledgerById.get(id);
        const tp = o.book + o.hissa + o.tpc;
        const pct = hpPct.get(id) || 0;
        const hpBase = pct ? tp : 0;
        const hpAmt = hpBase * pct / 100;
        const rbtPct = parseFloat(l?.rebate || '0') || 0;
        const rbtBase = tp > 0 ? tp : 0;
        const rbtAmt = rbtPct && tp - hpAmt > 0 ? (tp - hpAmt) * rbtPct / 100 : 0;
        if (!hpAmt && !rbtAmt) continue;
        const hpParty = l?.hpLedgerId || id;
        const list = hrByHpParty.get(hpParty) || [];
        list.push({ partyId: id, partyName: l?.partyName || '', hpBase, hpPct: pct, hpAmt, rbtBase, rbtPct, rbtAmt, tHr: hpAmt + rbtAmt, settleAmt: 0 });
        hrByHpParty.set(hpParty, list);
      }
    }

    // Vouchers, Dr − Cr (positive = the party owes); LIMIT vouchers are a credit limit, not money
    const voucherRows = await pgSql<Array<{ ledger_id: number; bucket: string; net: string }>>`
      SELECT e.ledger_id,
        CASE WHEN v.created_at::date < ${filters.fromDate}::date THEN 'OPENING'
             WHEN v.voucher_type = 'KIST' THEN 'KIST'
             WHEN v.voucher_type = 'VAPSI' THEN 'REBATE'
             WHEN v.voucher_type = 'HAWA_PATTI' THEN 'HP'
             ELSE 'PAYMENT' END AS bucket,
        SUM(CASE WHEN e.entry_side = 'DR' THEN e.amount ELSE -e.amount END) AS net
      FROM voucher_entries e
      JOIN vouchers v ON v.id = e.voucher_id
      WHERE v.voucher_type <> 'LIMIT' AND v.created_at::date <= ${filters.toDate}::date
      GROUP BY 1, 2
    `;
    const moves = new Map<number, { opening: number; kist: number; rebate: number; hpAmt: number; payment: number }>();
    // Month-end: the range's VAPSI / HAWA_PATTI vouchers are the posting of the HR worked out
    // above, so they show as SETTEL in its popup instead of being counted a second time
    const settleByLedger = new Map<number, number>();
    for (const m of voucherRows) {
      if (!moves.has(m.ledger_id)) moves.set(m.ledger_id, { opening: 0, kist: 0, rebate: 0, hpAmt: 0, payment: 0 });
      const mv = moves.get(m.ledger_id)!;
      const amt = parseFloat(m.net) || 0;
      if (m.bucket === 'OPENING') mv.opening += amt;
      else if (m.bucket === 'KIST') mv.kist += amt;
      else if (monthEnd && (m.bucket === 'REBATE' || m.bucket === 'HP')) settleByLedger.set(m.ledger_id, (settleByLedger.get(m.ledger_id) || 0) - amt);
      else if (m.bucket === 'REBATE') mv.rebate += amt;
      else if (m.bucket === 'HP') mv.hpAmt += amt;
      else mv.payment += amt;
    }

    const agentIds = Array.from(new Set(partyRows.map(p => p.agentId).filter((id): id is number => id != null)));
    const agentRows = agentIds.length > 0
      ? await db.select({ id: agents.id, agentName: agents.agentName }).from(agents).where(inArray(agents.id, agentIds))
      : [];
    const agentNameById = new Map(agentRows.map(a => [a.id, a.agentName]));

    const zero = { comm: 0, book: 0, hissa: 0, tpc: 0 };
    let rows = partyRows.map(p => {
      const a = gameNow.get(p.id);
      const now = nowByParty.get(p.id) || zero;
      const before = beforeByParty.get(p.id) || zero;
      const mv = moves.get(p.id) || { opening: 0, kist: 0, rebate: 0, hpAmt: 0, payment: 0 };
      const tProfit = now.book + now.hissa + now.tpc;
      const opening = mv.opening + before.book + before.hissa + before.tpc;
      const hrRows = (hrByHpParty.get(p.id) || []).map(h => ({ ...h, settleAmt: settleByLedger.get(h.partyId) || 0 }));
      const rebate = monthEnd ? -hrRows.reduce((s2, h) => s2 + h.rbtAmt, 0) + 0 : mv.rebate;
      const hpAmt = monthEnd ? -hrRows.reduce((s2, h) => s2 + h.hpAmt, 0) + 0 : mv.hpAmt;
      return {
        partyId: p.id,
        partyName: p.partyName,
        mobile: p.mobile || '-',
        agentName: p.agentId ? (agentNameById.get(p.agentId) || '-') : '-',
        limit: parseFloat(p.betLimit || '0'),
        opening,
        totalSale: a?.totalSale || 0,
        dSale: a?.dSale || 0,
        aSale: a?.aSale || 0,
        comm: now.comm,
        dOpen: a?.dOpen || 0,
        aOpen: a?.aOpen || 0,
        tpc: now.tpc,
        hissa: now.hissa,
        tProfit,
        kist: mv.kist,
        rebate,
        hpAmt,
        payment: mv.payment,
        closing: opening + tProfit + mv.kist + rebate + hpAmt + mv.payment,
        dayAv: a?.days.size || 0,
        // the days behind DayAv (YYYY-MM-DD, oldest first) — DayAv click popup
        saleDays: a ? Array.from(a.days).sort() : [],
        // Rebate click popup (month-end HR): every party booked to this one, with its HP / RBT parts
        hrRows,
      };
    });

    // ACTIVE = had a sale in the range; INACTIVE = didn't.
    if (filters.partyStatus === 'ACTIVE') rows = rows.filter(r => r.dayAv > 0);
    else if (filters.partyStatus === 'INACTIVE') rows = rows.filter(r => r.dayAv === 0);

    rows.sort((a, b) => a.partyName.localeCompare(b.partyName));
    return { rows, dealOptions };
  }

  // All Shift Report → click a Party (live "ALL SHIFT REPORT" popup): that party's range broken
  // down by shift — one row per shift it played, each with the Daily Report columns summed over
  // the range (every day judged on its own result) — and underneath the party's balance line
  // from the main report: OPENING, P&L (= T-Profit), HP-AMT, REBATE, TPC, PAYMENT, CLOSING.
  // Live AARAV JLD HBD 01-09 → 30-09: HYDRABAD 11185 − 1118 − 80×90 → Debit 2867; FARIDABAD 45;
  // GALI 900; P&L 3812; 41468 + 3812 − 762 − 305 − 44212 = 0 (Closing).
  static async getAllShiftPartyDetail(filters: { partyId: number; fromDate: string; toDate: string }) {
    const [party] = await db.select().from(ledgers).where(eq(ledgers.id, filters.partyId));
    if (!party) throw new NotFoundError('Party not found');

    const ownLinks = await db.select({ partyName: ledgerThirdPartyLinks.partyName, percent: ledgerThirdPartyLinks.percent })
      .from(ledgerThirdPartyLinks)
      .where(and(eq(ledgerThirdPartyLinks.linkType, 'HISSA'), eq(ledgerThirdPartyLinks.ledgerId, party.id)));
    const ownName = (party.partyName || '').trim().toUpperCase();
    // the larger of Self Hissa and the Hissa Party rows naming the party itself (see getDailyReport)
    let selfLinks = 0;
    for (const l of ownLinks) if ((l.partyName || '').trim().toUpperCase() === ownName) selfLinks += parseFloat(l.percent) || 0;
    const sHissa = Math.max(parseFloat(party.hissaPercentage || '0') || 0, selfLinks);
    const commPct = parseFloat(party.commissionRate || '0') || 0;
    const rate = `${Math.round(parseFloat(party.daraRate || '0'))}/${Math.round(commPct)}-${Math.round(parseFloat(party.akharRate || '0'))}/${Math.round(commPct)}`;

    // Per shift: sale, Dara / Akhar sale, winning stakes and payout — each day on its own result
    const saleRows = await pgSql<Array<{ shift_id: number; shift_name: string; sale: string }>>`
      SELECT t.shift_id, s.name AS shift_name, SUM(t.total_amount) AS sale
      FROM transactions t JOIN shifts s ON s.id = t.shift_id
      WHERE t.party_id = ${party.id} AND t.status <> 'VOIDED'
        AND t.created_at::date >= ${filters.fromDate}::date AND t.created_at::date <= ${filters.toDate}::date
      GROUP BY t.shift_id, s.name
    `;
    const entryRows = await pgSql<Array<{ shift_id: number; d_sale: string; a_sale: string; d_open: string; a_open: string; payout: string }>>`
      SELECT x.shift_id,
        SUM(CASE WHEN x.entry_type = 'DARA' THEN x.amount ELSE 0 END) AS d_sale,
        SUM(CASE WHEN x.entry_type <> 'DARA' THEN x.amount ELSE 0 END) AS a_sale,
        SUM(CASE WHEN x.entry_type = 'DARA' AND x.number_value = x.dn THEN x.amount ELSE 0 END) AS d_open,
        SUM(CASE WHEN (x.entry_type = 'HARUF_ANDAR' AND x.number_value = substr(x.dn, 1, 1))
                   OR (x.entry_type = 'HARUF_BAHAR' AND x.number_value = substr(x.dn, 2, 1)) THEN x.amount ELSE 0 END) AS a_open,
        SUM(CASE WHEN (x.entry_type = 'DARA' AND x.number_value = x.dn)
                   OR (x.entry_type = 'HARUF_ANDAR' AND x.number_value = substr(x.dn, 1, 1))
                   OR (x.entry_type = 'HARUF_BAHAR' AND x.number_value = substr(x.dn, 2, 1)) THEN x.amount * x.rate ELSE 0 END) AS payout
      FROM (
        SELECT t.shift_id, e.entry_type, e.number_value, e.amount, e.rate,
          lpad(COALESCE(
            CASE WHEN c.status IN ('DECLARED', 'AUDITED') OR c.declared_number IS NOT NULL THEN c.declared_number END,
            CASE WHEN s.open_date = t.created_at::date::text THEN s.declared_number END
          ), 2, '0') AS dn
        FROM transaction_entries e
        JOIN transactions t ON t.id = e.transaction_id
        JOIN shifts s ON s.id = t.shift_id
        LEFT JOIN shift_cycles c ON c.shift_id = t.shift_id AND c.cycle_date = t.created_at::date::text
        WHERE t.party_id = ${party.id} AND t.status <> 'VOIDED'
          AND t.created_at::date >= ${filters.fromDate}::date AND t.created_at::date <= ${filters.toDate}::date
      ) x
      GROUP BY x.shift_id
    `;
    const entryByShift = new Map(entryRows.map(r => [r.shift_id, r]));
    const partyTpc = await TransactionService.tpcPctByLedger([party.id]);

    const roundAway = (v: number) => Math.sign(v) * Math.round(Math.abs(v)) + 0;
    const rows = saleRows.map(r => {
      const e = entryByShift.get(r.shift_id);
      const totalSale = parseFloat(r.sale) || 0;
      const commExact = TransactionService.partyComm(totalSale, parseFloat(e?.d_sale || '0') || 0, parseFloat(e?.a_sale || '0') || 0, commPct, partyTpc.get(party.id));
      const payout = parseFloat(e?.payout || '0') || 0;
      const book = totalSale + commExact - payout;
      const closing = roundAway(book * (100 - sHissa) / 100);
      return {
        shiftId: r.shift_id,
        shiftName: r.shift_name,
        rate,
        sHissa,
        totalSale,
        dSale: parseFloat(e?.d_sale || '0') || 0,
        aSale: parseFloat(e?.a_sale || '0') || 0,
        comm: Math.round(commExact) + 0,
        oDara: parseFloat(e?.d_open || '0') || 0,
        oAkhar: parseFloat(e?.a_open || '0') || 0,
        tpc: 0,
        hissa: Math.round(-(book * sHissa / 100)) + 0,
        debit: closing > 0 ? closing : 0,
        credit: closing < 0 ? -closing : 0,
      };
    }).sort((a, b) => a.shiftId - b.shiftId);

    const sum = (k: 'totalSale' | 'dSale' | 'aSale' | 'comm' | 'oDara' | 'oAkhar' | 'tpc' | 'hissa' | 'debit' | 'credit') =>
      rows.reduce((s, r) => s + r[k], 0);

    // The party's balance line — the same figures as its row on the All Shift Report
    const full = await this.getAllShiftReport({ fromDate: filters.fromDate, toDate: filters.toDate });
    const line = full.rows.find(r => r.partyId === party.id);

    return {
      partyId: party.id,
      partyName: party.partyName,
      userName: party.userName || '',
      fromDate: filters.fromDate,
      toDate: filters.toDate,
      rows,
      masterTotal: {
        totalSale: sum('totalSale'), dSale: sum('dSale'), aSale: sum('aSale'), comm: sum('comm'),
        oDara: sum('oDara'), oAkhar: sum('oAkhar'), tpc: sum('tpc'), hissa: sum('hissa'),
        debit: sum('debit'), credit: sum('credit'),
      },
      summary: {
        opening: line?.opening || 0,
        pnl: line?.tProfit || 0,
        hpAmt: line?.hpAmt || 0,
        rebate: line?.rebate || 0,
        tpc: line?.tpc || 0,
        kist: line?.kist || 0,
        payment: line?.payment || 0,
        closing: line?.closing || 0,
      },
    };
  }

  // TPC Report (rpt_tpc): Third Party Commission earned by each party named in a ledger's
  // TPC links (Ledger master → Hissa/TPC tab: party, D-Comm %, A-Comm %).
  //   TPC for one link = that ledger's Dara Sale × D-Comm% + Akhar Sale × A-Comm% in the range
  //   Row per receiving party = Σ its links; Agent = the receiving party's own agent.
  static async getTpcReport(filters: { fromDate: string; toDate: string }) {
    const links = await db.select({
      id: ledgerThirdPartyLinks.id,
      ledgerId: ledgerThirdPartyLinks.ledgerId,
      partyName: ledgerThirdPartyLinks.partyName,
      dComm: ledgerThirdPartyLinks.dComm,
      aComm: ledgerThirdPartyLinks.aComm,
    })
      .from(ledgerThirdPartyLinks)
      .innerJoin(ledgers, eq(ledgerThirdPartyLinks.ledgerId, ledgers.id))
      .where(and(eq(ledgerThirdPartyLinks.linkType, 'TPC'), isNull(ledgers.deletedAt)))
      .orderBy(asc(ledgerThirdPartyLinks.id));
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

    // The giving parties (click on a row, live): their names and agents
    const giverRows = await db.select({ id: ledgers.id, partyName: ledgers.partyName, agentName: agents.agentName })
      .from(ledgers)
      .leftJoin(agents, eq(ledgers.agentId, agents.id))
      .where(inArray(ledgers.id, sourceIds));
    const giverById = new Map(giverRows.map(g => [g.id, g]));

    // Receivers in the order their 3rd Party Comm rows were set up (live lists ZZ HARRY OJLA,
    // ZZ SHANKY HPT, ZZ HARRY TULSIDAS … — not A-Z), each with the parties that paid it
    type Giver = { partyId: number; partyName: string; agentName: string; amount: number };
    const byReceiver = new Map<string, { partyName: string; amount: number; givers: Giver[] }>();
    for (const l of links) {
      const sale = saleByLedger.get(l.ledgerId);
      if (!sale) continue;
      const amount = sale.d * parseFloat(l.dComm || '0') / 100 + sale.a * parseFloat(l.aComm || '0') / 100;
      if (!amount) continue;
      const key = l.partyName.trim().toUpperCase();
      if (!byReceiver.has(key)) byReceiver.set(key, { partyName: l.partyName.trim(), amount: 0, givers: [] });
      const rec = byReceiver.get(key)!;
      rec.amount += amount;
      const g = giverById.get(l.ledgerId);
      const prev = rec.givers.find(x => x.partyId === l.ledgerId);
      if (prev) prev.amount += amount;
      else rec.givers.push({ partyId: l.ledgerId, partyName: g?.partyName || '-', agentName: g?.agentName || '-', amount });
    }
    if (byReceiver.size === 0) return { rows: [] };

    // Receiving party's agent, looked up by its ledger name.
    const receiverLedgers = await db.select({ partyName: ledgers.partyName, agentName: agents.agentName })
      .from(ledgers)
      .leftJoin(agents, eq(ledgers.agentId, agents.id))
      .where(inArray(sql`UPPER(${ledgers.partyName})`, Array.from(byReceiver.keys())));
    const agentByName = new Map(receiverLedgers.map(r => [r.partyName.toUpperCase(), r.agentName || '-']));

    const rows = Array.from(byReceiver.entries())
      .map(([key, r]) => ({ partyName: r.partyName, amount: r.amount, agentName: agentByName.get(key) || '-', givers: r.givers }));
    return { rows };
  }

  // Party's game result per declared shift + day — the party's Debit / Credit on that day's
  // Daily Report, so Admin Cash, Daily Report, Settling and All Shift agree:
  //   declared = that day's cycle number (DECLARED / AUDITED or a number set), else the shift's
  //              own number when the day is its open day (the Daily Report rule)
  //   Comm     = partyComm (the party's Comm%, or Comm% − D/A-Comm% when it has 3rd Party Comm rows)
  //   Book     = Sale + Comm − Payout
  //   P&L      = Book × (100 − S-Hissa)% rounded half away from zero, S-Hissa = the larger of the
  //              Self Hissa box and the Hissa Party rows naming the party itself
  // Positive = party lost (Dr to party). fromDate/toDate are inclusive days; either may be left out.
  private static async getPartyCyclePnl(
    party: { id: number; partyName?: string | null; commissionRate: string | null; hissaPercentage: string | null },
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
    const shiftRows = await db.select({
      id: shifts.id,
      name: shifts.name,
      openDate: shifts.openDate,
      declaredNumber: shifts.declaredNumber,
      updatedAt: shifts.updatedAt,
    }).from(shifts).where(inArray(shifts.id, shiftIds));
    const shiftById = new Map(shiftRows.map(s => [s.id, s]));
    const cycles = await db.select({
      shiftId: shiftCycles.shiftId,
      cycleDate: shiftCycles.cycleDate,
      status: shiftCycles.status,
      declaredNumber: shiftCycles.declaredNumber,
      updatedAt: shiftCycles.updatedAt,
    })
      .from(shiftCycles)
      .where(inArray(shiftCycles.shiftId, shiftIds));
    const cycleByKey = new Map(cycles.map(c => [`${c.shiftId}:${c.cycleDate}`, c]));
    // The day's result and when it was posted, or null while the day is undeclared
    const resultOf = (shiftId: number, day: string): { number: string; postedAt: Date; shiftName: string } | null => {
      const sh = shiftById.get(shiftId);
      const c = cycleByKey.get(`${shiftId}:${day}`);
      if (c && c.declaredNumber && (['DECLARED', 'AUDITED'].includes(c.status) || c.declaredNumber)) {
        return { number: c.declaredNumber.padStart(2, '0'), postedAt: c.updatedAt, shiftName: sh?.name || '-' };
      }
      if (sh && sh.openDate === day && sh.declaredNumber) {
        return { number: sh.declaredNumber.padStart(2, '0'), postedAt: c?.updatedAt || sh.updatedAt, shiftName: sh.name };
      }
      return null;
    };

    const txIds = txRows.map(t => t.id);
    const entryRows = await db.select().from(transactionEntries).where(inArray(transactionEntries.transactionId, txIds));
    const entriesByTx = new Map<number, typeof entryRows>();
    for (const e of entryRows) {
      if (!entriesByTx.has(e.transactionId)) entriesByTx.set(e.transactionId, []);
      entriesByTx.get(e.transactionId)!.push(e);
    }

    // S-Hissa: the larger of the Self Hissa box and the Hissa Party rows naming the party itself
    const ownLinks = await db.select({ partyName: ledgerThirdPartyLinks.partyName, percent: ledgerThirdPartyLinks.percent })
      .from(ledgerThirdPartyLinks)
      .where(and(eq(ledgerThirdPartyLinks.linkType, 'HISSA'), eq(ledgerThirdPartyLinks.ledgerId, party.id)));
    const ownName = (party.partyName || '').trim().toUpperCase();
    let selfLinks = 0;
    for (const l of ownLinks) if ((l.partyName || '').trim().toUpperCase() === ownName) selfLinks += parseFloat(l.percent) || 0;
    const sHissa = Math.max(parseFloat(party.hissaPercentage || '0') || 0, selfLinks);
    const commPct = parseFloat(party.commissionRate || '0') || 0;
    const tpc = (await TransactionService.tpcPctByLedger([party.id])).get(party.id);

    type Agg = { shiftId: number; day: string; sale: number; dSale: number; aSale: number; payout: number; result: { postedAt: Date; shiftName: string } };
    const perCycle = new Map<string, Agg>();
    for (const tx of txRows) {
      const result = resultOf(tx.shiftId, tx.day);
      if (!result) continue; // not declared yet — no result to post
      const declared = result.number;
      const key = `${tx.shiftId}:${tx.day}`;
      if (!perCycle.has(key)) perCycle.set(key, { shiftId: tx.shiftId, day: tx.day, sale: 0, dSale: 0, aSale: 0, payout: 0, result });
      const agg = perCycle.get(key)!;
      agg.sale += parseFloat(tx.totalAmount);
      for (const e of entriesByTx.get(tx.id) || []) {
        const amt = parseFloat(e.amount);
        if (e.entryType === 'DARA') agg.dSale += amt; else agg.aSale += amt;
        const wins = (e.entryType === 'DARA' && e.numberValue === declared)
          || (e.entryType === 'HARUF_ANDAR' && e.numberValue === declared[0])
          || (e.entryType === 'HARUF_BAHAR' && e.numberValue === declared[1]);
        if (wins) agg.payout += amt * parseFloat(e.rate);
      }
    }

    const roundAway = (v: number) => Math.sign(v) * Math.round(Math.abs(v)) + 0;
    return Array.from(perCycle.values()).map(agg => {
      const comm = TransactionService.partyComm(agg.sale, agg.dSale, agg.aSale, commPct, tpc);
      const book = agg.sale + comm - agg.payout;
      const pnl = roundAway(book * (100 - sHissa) / 100);
      return { shiftId: agg.shiftId, shiftName: agg.result.shiftName, cycleDate: agg.day, postedAt: agg.result.postedAt, pnl };
    });
  }

  // Party's ledger balance BEFORE a date, Dr − Cr (positive = party owes): every voucher (LIMIT
  // vouchers left out — they are the credit limit, LMT, as on All Shift / Settling) plus every
  // declared day's game result dated earlier.
  private static async getPartyBalanceBefore(
    party: { id: number; partyName?: string | null; commissionRate: string | null; hissaPercentage: string | null },
    beforeDate: string
  ) {
    const [v] = await db.select({
      net: sql<string>`COALESCE(SUM(CASE WHEN ${voucherEntries.entrySide} = 'DR' THEN ${voucherEntries.amount}::numeric ELSE -${voucherEntries.amount}::numeric END), 0)`,
    })
      .from(voucherEntries)
      .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
      .where(and(
        eq(voucherEntries.ledgerId, party.id),
        ne(vouchers.voucherType, 'LIMIT'),
        sql`${vouchers.createdAt}::date < ${beforeDate}::date`,
      ));
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

    type Entry = { date: string; at: Date; partyName: string; credit: number; debit: number; remark: string; updatedBy: string; voucherId: number | null; deletable: boolean; shiftId: number | null };
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
        // SERVER row → click opens the party's jantri of that shift + day
        shiftId: g.shiftId,
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
        // LIMIT vouchers are the credit limit (LMT above), not a passbook line
        ne(vouchers.voucherType, 'LIMIT'),
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
        shiftId: null,
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
        shiftId: e.shiftId,
      };
    });

    const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
    const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    const currentBalance = await this.getPartyBalanceBefore(party, tomorrowStr);
    // LMT (live "LMT: 2383540 Cr"): the balance with the party's LIMIT vouchers added — the
    // Settling Report's Limit, Dr − Cr
    const [limitRow] = await pgSql<Array<{ net: string | null }>>`
      SELECT SUM(CASE WHEN e.entry_side = 'DR' THEN e.amount ELSE -e.amount END) AS net
      FROM voucher_entries e JOIN vouchers v ON v.id = e.voucher_id
      WHERE e.ledger_id = ${party.id} AND v.voucher_type = 'LIMIT' AND v.created_at::date < ${tomorrowStr}::date
    `;
    const limitVouchers = parseFloat(limitRow?.net || '0') || 0;

    return {
      partyId: party.id,
      partyName: party.partyName,
      agentName,
      rate,
      balance: currentBalance,
      limit: parseFloat(party.betLimit || '0'),
      lmt: currentBalance + limitVouchers,
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
  //             line) + every declared day's game result up to the date — the party's Daily
  //             Report Debit / Credit per shift and day, the same result Admin Cash posts as its
  //             SERVER rows (see getLedgerBalancesAsOf).
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
  // vouchers Dr − Cr (LIMIT vouchers returned separately as `limit`) + every declared day's game
  // result — per party, shift and day the party's Daily Report Debit / Credit, the same figure
  // Admin Cash posts as its SERVER rows:
  //   declared = the day's cycle number (DECLARED / AUDITED or a number set), else the shift's
  //              own number when the day is its open day
  //   Book     = Sale + partyComm (Comm%, or Comm% − D/A-Comm% with 3rd Party Comm rows) − Payout
  //   P&L      = Book × (100 − S-Hissa)%, rounded half away from zero; S-Hissa = the larger of
  //              the Self Hissa box and the Hissa Party rows naming the party itself
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

    // Sale per party, shift and declared day; then Dara / Akhar sale and winning payout
    const saleRows = await pgSql<Array<{ party_id: number; shift_id: number; day: string; sale: string }>>`
      SELECT t.party_id, t.shift_id, t.created_at::date::text AS day, SUM(t.total_amount) AS sale
      FROM transactions t
      JOIN shifts s ON s.id = t.shift_id
      LEFT JOIN shift_cycles c ON c.shift_id = t.shift_id AND c.cycle_date = t.created_at::date::text
      WHERE t.status <> 'VOIDED' AND t.created_at::date <= ${asOf}::date
        AND COALESCE(
          CASE WHEN c.status IN ('DECLARED', 'AUDITED') OR c.declared_number IS NOT NULL THEN c.declared_number END,
          CASE WHEN s.open_date = t.created_at::date::text THEN s.declared_number END
        ) IS NOT NULL
      GROUP BY t.party_id, t.shift_id, t.created_at::date
    `;
    const entryRows = await pgSql<Array<{ party_id: number; shift_id: number; day: string; d_sale: string; a_sale: string; payout: string }>>`
      SELECT x.party_id, x.shift_id, x.day,
        SUM(CASE WHEN x.entry_type = 'DARA' THEN x.amount ELSE 0 END) AS d_sale,
        SUM(CASE WHEN x.entry_type <> 'DARA' THEN x.amount ELSE 0 END) AS a_sale,
        SUM(CASE WHEN (x.entry_type = 'DARA' AND x.number_value = x.dn)
                   OR (x.entry_type = 'HARUF_ANDAR' AND x.number_value = substr(x.dn, 1, 1))
                   OR (x.entry_type = 'HARUF_BAHAR' AND x.number_value = substr(x.dn, 2, 1)) THEN x.amount * x.rate ELSE 0 END) AS payout
      FROM (
        SELECT t.party_id, t.shift_id, t.created_at::date::text AS day, e.entry_type, e.number_value, e.amount, e.rate,
          lpad(COALESCE(
            CASE WHEN c.status IN ('DECLARED', 'AUDITED') OR c.declared_number IS NOT NULL THEN c.declared_number END,
            CASE WHEN s.open_date = t.created_at::date::text THEN s.declared_number END
          ), 2, '0') AS dn
        FROM transaction_entries e
        JOIN transactions t ON t.id = e.transaction_id
        JOIN shifts s ON s.id = t.shift_id
        LEFT JOIN shift_cycles c ON c.shift_id = t.shift_id AND c.cycle_date = t.created_at::date::text
        WHERE t.status <> 'VOIDED' AND t.created_at::date <= ${asOf}::date
      ) x
      WHERE x.dn IS NOT NULL
      GROUP BY x.party_id, x.shift_id, x.day
    `;

    const balance = new Map<number, number>();
    const limit = new Map<number, number>();
    for (const v of voucherRows) {
      const target = v.is_limit ? limit : balance;
      target.set(v.ledger_id, (target.get(v.ledger_id) || 0) + parseFloat(v.net));
    }

    // S-Hissa per party: the larger of the Self Hissa box and its Hissa rows naming itself
    const hissaLinks = await db.select({ ledgerId: ledgerThirdPartyLinks.ledgerId, partyName: ledgerThirdPartyLinks.partyName, percent: ledgerThirdPartyLinks.percent })
      .from(ledgerThirdPartyLinks)
      .where(eq(ledgerThirdPartyLinks.linkType, 'HISSA'));
    const ledgerById = new Map(ledgerRows.map(l => [l.id, l]));
    const selfLinks = new Map<number, number>();
    for (const h of hissaLinks) {
      const l = ledgerById.get(h.ledgerId);
      if (!l) continue;
      if ((h.partyName || '').trim().toUpperCase() !== (l.partyName || '').trim().toUpperCase()) continue;
      selfLinks.set(l.id, (selfLinks.get(l.id) || 0) + (parseFloat(h.percent) || 0));
    }
    const sHissaOf = (l: typeof ledgerRows[number]) => Math.max(parseFloat(l.hissaPercentage || '0') || 0, selfLinks.get(l.id) || 0);
    const tpcByLedger = await TransactionService.tpcPctByLedger();

    const roundAway = (v: number) => Math.sign(v) * Math.round(Math.abs(v)) + 0;
    const entryByKey = new Map(entryRows.map(p => [`${p.party_id}:${p.shift_id}:${p.day}`, p]));
    for (const srow of saleRows) {
      const l = ledgerById.get(srow.party_id);
      if (!l) continue;
      const sale = parseFloat(srow.sale) || 0;
      const e = entryByKey.get(`${srow.party_id}:${srow.shift_id}:${srow.day}`);
      const dSale = parseFloat(e?.d_sale || '0') || 0;
      const aSale = parseFloat(e?.a_sale || '0') || 0;
      const payout = parseFloat(e?.payout || '0') || 0;
      const comm = TransactionService.partyComm(sale, dSale, aSale, parseFloat(l.commissionRate || '0') || 0, tpcByLedger.get(l.id));
      const book = sale + comm - payout;
      const pnl = roundAway(book * (100 - sHissaOf(l)) / 100);
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

  // Cash Report (rpt_cash / rpt_cash_agent): every Cash Agent ledger (Ledger Group "Cash Agent"),
  // A-Z, with its balance — the same Dr − Cr balance Trail Balance / OutStanding / Admin Cash use
  // (vouchers without LIMIT + declared game results):
  //   Opening = balance up to the day before From     Amount = its movement From → To
  //   Closing = Opening + Amount (= balance up to To)
  // A cash agent with nothing in either (Opening and Amount both 0) is left out — live lists 50
  // of its Cash Agents, skipping e.g. CASH 13 13 A/C. Totals: count, Σ Opening, Σ Amount, Σ Closing.
  static async getCashAgentReport(filters: { fromDate: string; toDate: string }) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(filters.fromDate || '') || !/^\d{4}-\d{2}-\d{2}$/.test(filters.toDate || '')) {
      throw new AppError('Please select both Dates!');
    }
    if (filters.fromDate > filters.toDate) throw new AppError('From Date cannot be after To Date!');
    const dayBefore = new Date(`${filters.fromDate}T00:00:00Z`);
    dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
    const cashIds = new Set((await db.select({ id: ledgers.id }).from(ledgers)
      .where(and(eq(ledgers.groupName, 'Cash Agent'), isNull(ledgers.deletedAt)))).map(l => l.id));
    const [before, upTo] = await Promise.all([
      this.getLedgerBalancesAsOf(dayBefore.toISOString().slice(0, 10)),
      this.getLedgerBalancesAsOf(filters.toDate),
    ]);
    const openingById = new Map(before.map(b => [b.ledgerId, b.balance]));
    const rows = upTo
      .filter(l => cashIds.has(l.ledgerId))
      .map(l => {
        const opening = openingById.get(l.ledgerId) || 0;
        const closing = l.balance;
        return { ledgerId: l.ledgerId, partyName: l.partyName, opening, amount: closing - opening, closing };
      })
      .filter(r => Math.round(r.opening) !== 0 || Math.round(r.amount) !== 0)
      .sort((a, b) => a.partyName.localeCompare(b.partyName));
    return {
      fromDate: filters.fromDate,
      toDate: filters.toDate,
      rows,
      totalOpening: rows.reduce((s, r) => s + r.opening, 0),
      totalAmount: rows.reduce((s, r) => s + r.amount, 0),
      totalClosing: rows.reduce((s, r) => s + r.closing, 0),
    };
  }

  // Settlement Agent (rpt_settlement_agent_group): every party of the chosen agent group, A-Z,
  // with its balance up to the month's end — the OutStanding / Admin Cash balance (Dr − Cr):
  //   Credit / Debit = that balance on its side (Cr → Credit, Dr → Debit; 0 → both blank)
  //   Balance        = running total down the list, Σ (Debit − Credit) so far, "… Cr" / "… Dr"
  //                    (live AAHIL DL: DILSAD 2605 Cr, IMRAN DL +17388 → 19993 Cr, ISTKIR −100559
  //                    → 80566 Dr … footer 276561 − 98870 = 177691 Dr)
  //   Updated By / Updated Date = the ledger's own (live 13-10-2025, 01-10-2024 …)
  // periodCredit / periodDebit: the month's voucher entries, kept for reference.
  static async getSettlementAgentRows(filters: { fromDate: string; toDate: string; agentId: number }) {
    if (!filters.agentId) throw new AppError('Please enter a valid agent!');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(filters.fromDate || '') || !/^\d{4}-\d{2}-\d{2}$/.test(filters.toDate || '')) {
      throw new AppError('Please select a valid Month and Year!');
    }
    const [partyRows, balances, periodRows] = await Promise.all([
      db.select({ id: ledgers.id, partyName: ledgers.partyName, updatedBy: ledgers.updatedBy, updatedAt: ledgers.updatedAt })
        .from(ledgers)
        .where(and(eq(ledgers.agentId, filters.agentId), isNull(ledgers.deletedAt))),
      this.getLedgerBalancesAsOf(filters.toDate),
      pgSql<Array<{ ledger_id: number; cr: string; dr: string }>>`
        SELECT e.ledger_id,
               SUM(CASE WHEN e.entry_side = 'CR' THEN e.amount ELSE 0 END) AS cr,
               SUM(CASE WHEN e.entry_side = 'DR' THEN e.amount ELSE 0 END) AS dr
        FROM voucher_entries e
        JOIN vouchers v ON v.id = e.voucher_id
        JOIN ledgers l ON l.id = e.ledger_id
        WHERE l.agent_id = ${filters.agentId} AND v.voucher_type <> 'LIMIT'
          AND v.created_at::date BETWEEN ${filters.fromDate}::date AND ${filters.toDate}::date
        GROUP BY e.ledger_id
      `,
    ]);
    const balanceById = new Map(balances.map(b => [b.ledgerId, b.balance]));
    const periodById = new Map(periodRows.map(p => [p.ledger_id, p]));
    let running = 0;
    const rows = partyRows
      .sort((a, b) => a.partyName.localeCompare(b.partyName))
      .map(p => {
        const bal = balanceById.get(p.id) || 0;
        running += bal;
        const period = periodById.get(p.id);
        return {
          ledgerId: p.id,
          partyName: p.partyName,
          agentId: filters.agentId,
          credit: bal < 0 ? -bal : 0,
          debit: bal > 0 ? bal : 0,
          // the party's own balance (Dr − Cr) — the Save form's "Party & Balance"
          partyBalance: bal,
          balance: running,
          periodCredit: parseFloat(period?.cr || '0') || 0,
          periodDebit: parseFloat(period?.dr || '0') || 0,
          updatedBy: p.updatedBy || 'A100',
          updatedAt: TransactionService.stampIso(p.updatedAt),
        };
      });
    const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
    const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
    return { rows, totalCredit, totalDebit, totalBalance: totalDebit - totalCredit };
  }

  // OutStanding Agent-Group (rpt_agent_group_outstanding): the OutStanding Report rolled up — one
  // row per agent group under the chosen Agent (agents master: Group = ASLAM 40, Agent = its
  // Main Agent, CASH ASLAM), its parties' balances as of the date summed (Dr − Cr: vouchers
  // without LIMIT + declared game). The sum goes on its side — Dr → Debit, Cr → Credit — and a
  // group that nets to 0 is left out. Final = Σ Debit − Σ Credit
  // (live CASH ASLAM 16-10: ASLAM 40 Debit 1013146, ASLAM 60 Credit 1380 → Final 1011766).
  static async getOutstandingAgentGroup(filters: { asOfDate: string; agentIds: number[] }) {
    if (filters.agentIds.length === 0) return { rows: [], totalCredit: 0, totalDebit: 0, final: 0 };
    const [groupRows, all] = await Promise.all([
      db.select({ id: agents.id, agentName: agents.agentName, mainAgentName: agents.mainAgentName })
        .from(agents).where(inArray(agents.id, filters.agentIds)),
      this.getLedgerBalancesAsOf(filters.asOfDate),
    ]);
    const net = new Map<number, number>();
    for (const l of all) {
      if (l.agentId == null) continue;
      net.set(l.agentId, (net.get(l.agentId) || 0) + l.balance);
    }
    const rows = groupRows
      .map(g => {
        const bal = net.get(g.id) || 0;
        return {
          agentId: g.id,
          agentGroup: g.agentName,
          // the agents master's Agent column (no Main Agent reads VIKAS CASH, as on the Agents page)
          agentName: g.mainAgentName || 'VIKAS CASH',
          credit: bal < 0 ? -bal : 0,
          debit: bal > 0 ? bal : 0,
        };
      })
      .filter(r => Math.round(r.credit) !== 0 || Math.round(r.debit) !== 0)
      .sort((a, b) => a.agentGroup.localeCompare(b.agentGroup));
    const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
    const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
    return { rows, totalCredit, totalDebit, final: totalDebit - totalCredit };
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
      // Group by group (live: ASLAM 40's parties together, A-Z, then ASLAM 60's), then party A-Z
      .sort((a, b) => a.agentGroup.localeCompare(b.agentGroup) || a.partyName.localeCompare(b.partyName));
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

  // range (optional): a From–To inside the month in place of the whole month (HVS Process filter);
  // the month still names the vouchers (DONE)
  static async getVapsiSummary(filters: { month: number; year: number; agentId?: number; partyId?: number; withHp?: boolean; onBase?: boolean; range?: { from: string; to: string } }) {
    if (!(filters.month >= 1 && filters.month <= 12) || !(filters.year > 2000)) throw new AppError('Please select a valid Month and Year!');
    const { from, to } = filters.range || this.monthRange(filters.month, filters.year);
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
    // HP % = the party's Hissa Party row(s) to HP A/C — the share Hawa Patti takes before Vapsi
    const hpLinkRows = await db.select({ ledgerId: ledgerThirdPartyLinks.ledgerId, percent: ledgerThirdPartyLinks.percent })
      .from(ledgerThirdPartyLinks)
      .where(and(eq(ledgerThirdPartyLinks.linkType, 'HISSA'), sql`UPPER(TRIM(${ledgerThirdPartyLinks.partyName})) = ${this.HP_ACCOUNT}`));
    const hpLinkPct = new Map<number, number>();
    for (const h of hpLinkRows) hpLinkPct.set(h.ledgerId, (hpLinkPct.get(h.ledgerId) || 0) + (parseFloat(h.percent) || 0));
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
        // Vapsi is worked out on what is left after Hawa Patti (live, and the All Shift month-end
        // HR): ANKUSH FARIDABAD 224154, HP A/C 50% → (224154 − 112077) × 10% = 11208; KADAR 25%
        // 27878, HP 10% → 2509. A party with no HP A/C row keeps its Self Hissa % as before.
        const hissaPct = hpLinkPct.has(l.id) ? (hpLinkPct.get(l.id) || 0) : parseFloat(l.hissaPercentage || '0');
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
          // ledger "Vapsi | TPR" second part — the live TPV column's YES / NO
          tpr,
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

  // Vapsi Report (rpt_vapsi) needs each processed line's Party, Base-Amt and Vapsi-% as they were
  // when the month was processed — the voucher itself only carries the amount. Kept in vapsi_lines
  // (one row per VAPSI voucher), created on first use (same DDL as migrate.ts).
  private static vapsiLinesReady: Promise<void> | null = null;
  private static ensureVapsiLines(): Promise<void> {
    if (!this.vapsiLinesReady) {
      this.vapsiLinesReady = pgSql.unsafe(`
        CREATE TABLE IF NOT EXISTS vapsi_lines (
          id SERIAL PRIMARY KEY,
          voucher_id INTEGER NOT NULL,
          month INTEGER NOT NULL,
          year INTEGER NOT NULL,
          party_id INTEGER,
          party_name VARCHAR(150),
          ledger_id INTEGER,
          base_amt NUMERIC(14, 2),
          vapsi_pct NUMERIC(6, 2),
          vapsi_amt NUMERIC(14, 2),
          added_by VARCHAR(100),
          added_at TIMESTAMP NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS vapsi_lines_voucher_idx ON vapsi_lines(voucher_id);
        CREATE INDEX IF NOT EXISTS vapsi_lines_month_idx ON vapsi_lines(year, month);
      `).then(() => undefined).catch((err) => {
        TransactionService.vapsiLinesReady = null;
        throw err;
      });
    }
    return this.vapsiLinesReady;
  }

  // Vapsi Report (rpt_vapsi): the month's processed Vapsi lines — one row per VAPSI voucher
  // narrated "<Month> <Year>" (Auto Vapsi / Vapsi Voucher → Process):
  //   Party      the playing party (a 3rd Party Rebate line shows it too: live ANUPGARH 10% and 5%)
  //   Base-Amt   its month P&L (or Payment when processed "On Base")
  //   Vapsi-%    the % the line was worked out at     Vapsi-Amt  the amount posted
  //              ((Base − HP-Amt) × %: ANKUSH FARIDABAD 224154, HP 50% → 11208)
  //   AddedBy / AddedDate  who processed it and when
  // A voucher processed before the line record existed falls back to the credited ledger as the
  // Party, its Vapsi % today (ledger Vapsi | TPR) and Base = Amount ÷ %.
  static async getVapsiReport(filters: { month: number; year: number }) {
    if (!(filters.month >= 1 && filters.month <= 12) || !(filters.year > 2000)) throw new AppError('Please select a valid Month and Year!');
    await this.ensureVapsiLines();
    const label = `${this.VAPSI_MONTHS[filters.month - 1]} ${filters.year}`;
    const vRows = await pgSql<Array<{
      id: number; updated_by: string | null; updated_at: Date | string; username: string | null;
      party_id: number | null; party_name: string | null; base_amt: string | null; vapsi_pct: string | null;
      added_by: string | null; added_at: Date | string | null;
      cr_ledger: string | null; cr_vapsi: string | null; amount: string | null;
    }>>`
      SELECT v.id, v.updated_by, v.updated_at, u.username,
             l.party_id, l.party_name, l.base_amt, l.vapsi_pct, l.added_by, l.added_at,
             cr.party_name AS cr_ledger, cr.vapsi_tpr AS cr_vapsi, e.amount
      FROM vouchers v
      LEFT JOIN users u ON u.id = v.created_by
      LEFT JOIN vapsi_lines l ON l.voucher_id = v.id
      LEFT JOIN voucher_entries e ON e.voucher_id = v.id AND e.entry_side = 'CR'
      LEFT JOIN ledgers cr ON cr.id = e.ledger_id
      WHERE v.voucher_type = 'VAPSI' AND v.narration = ${label}
    `;
    const rows = vRows.map(v => {
      const vapsiAmt = parseFloat(v.amount || '0') || 0;
      const ledgerPct = parseFloat(String(v.cr_vapsi || '0').split('|')[0]) || 0;
      const vapsiPct = v.vapsi_pct !== null ? parseFloat(v.vapsi_pct) : ledgerPct;
      const baseAmt = v.base_amt !== null ? parseFloat(v.base_amt) : (vapsiPct ? vapsiAmt * 100 / vapsiPct : 0);
      return {
        voucherId: v.id,
        partyId: v.party_id,
        partyName: v.party_name || v.cr_ledger || '-',
        receiverName: v.cr_ledger || '-',
        baseAmt,
        vapsiPct,
        vapsiAmt,
        addedBy: v.added_by || v.username || v.updated_by || '-',
        addedAt: TransactionService.stampIso(v.added_at || v.updated_at),
      };
    }).sort((a, b) => a.addedAt.localeCompare(b.addedAt) || a.voucherId - b.voucherId);
    return {
      month: filters.month,
      year: filters.year,
      rows,
      totalBase: rows.reduce((s, r) => s + r.baseAmt, 0),
      totalVapsiAmt: rows.reduce((s, r) => s + r.vapsiAmt, 0),
    };
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
    // baseAmt / vapsiPct / thirdParties[].percent (optional): kept for the Vapsi Report
    items: { partyId: number; amount: number; baseAmt?: number; vapsiPct?: number; thirdParties?: { ledgerId: number; amount: number; percent?: number }[] }[];
  }, user: UserSession) {
    if (!(data.month >= 1 && data.month <= 12) || !(data.year > 2000)) throw new AppError('Please select a valid Month and Year!');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.voucherDate || '')) throw new AppError('Please select Voucher Date!');
    const lines: { ledgerId: number; amount: number; partyId: number; baseAmt?: number; pct?: number }[] = [];
    for (const it of data.items || []) {
      if (Number(it.amount) > 0) lines.push({ ledgerId: Number(it.partyId), amount: Number(it.amount), partyId: Number(it.partyId), baseAmt: it.baseAmt, pct: it.vapsiPct });
      for (const t of it.thirdParties || []) {
        if (t.ledgerId && Number(t.amount) > 0) lines.push({ ledgerId: Number(t.ledgerId), amount: Number(t.amount), partyId: Number(it.partyId), baseAmt: it.baseAmt, pct: t.percent });
      }
    }
    if (lines.length === 0) throw new AppError('Please tick at least one party with a Vapsi amount!');

    const vapsiLedgerId = await this.getOrCreateLedger('VAPSI A/C');
    const narration = `${this.VAPSI_MONTHS[data.month - 1]} ${data.year}`;
    const createdAt = new Date(`${data.voucherDate}T12:00:00`);
    await this.ensureVapsiLines();
    const partyNames = new Map((await db.select({ id: ledgers.id, n: ledgers.partyName }).from(ledgers)
      .where(inArray(ledgers.id, Array.from(new Set(lines.map(l => l.partyId)))))).map(l => [l.id, l.n]));

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
        const num = (v: unknown) => (v === undefined || v === null || !isFinite(Number(v)) ? null : Number(v).toFixed(2));
        await tx.execute(sql`
          INSERT INTO vapsi_lines (voucher_id, month, year, party_id, party_name, ledger_id, base_amt, vapsi_pct, vapsi_amt, added_by)
          VALUES (${voucher.id}, ${data.month}, ${data.year}, ${line.partyId}, ${partyNames.get(line.partyId) || null},
                  ${line.ledgerId}, ${num(line.baseAmt)}, ${num(line.pct)}, ${line.amount.toFixed(2)}, ${user.username || 'SYSTEM'})
        `);
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

  // A raw-SQL timestamp comes back as a Date or as the stored wall-clock text
  // ("2026-09-30 11:05:12.3"); either way → "2026-09-30T11:05:12" for the report pages.
  private static stampIso(v: Date | string | null | undefined): string {
    if (!v) return '';
    if (v instanceof Date) return v.toISOString();
    return String(v).replace(' ', 'T');
  }

  // HawaPatti Rpt (rpt_hawa_patti) needs each processed line's Party, Base-Amt and HP-% as they
  // were when the month was processed — the voucher itself only carries the HP-Amt. Kept in
  // hawa_patti_lines (one row per HAWA_PATTI voucher), created on first use (same DDL as migrate.ts).
  private static hawaPattiLinesReady: Promise<void> | null = null;
  private static ensureHawaPattiLines(): Promise<void> {
    if (!this.hawaPattiLinesReady) {
      this.hawaPattiLinesReady = pgSql.unsafe(`
        CREATE TABLE IF NOT EXISTS hawa_patti_lines (
          id SERIAL PRIMARY KEY,
          voucher_id INTEGER NOT NULL,
          month INTEGER NOT NULL,
          year INTEGER NOT NULL,
          party_id INTEGER,
          party_name VARCHAR(150),
          hp_party_id INTEGER,
          base_amt NUMERIC(14, 2),
          hp_pct NUMERIC(6, 2),
          hp_amt NUMERIC(14, 2),
          added_by VARCHAR(100),
          added_at TIMESTAMP NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS hawa_patti_lines_voucher_idx ON hawa_patti_lines(voucher_id);
        CREATE INDEX IF NOT EXISTS hawa_patti_lines_month_idx ON hawa_patti_lines(year, month);
      `).then(() => undefined).catch((err) => {
        TransactionService.hawaPattiLinesReady = null;
        throw err;
      });
    }
    return this.hawaPattiLinesReady;
  }

  // range (optional): as getVapsiSummary — the HVS Process From–To in place of the whole month
  static async getHawaPattiSummary(filters: { month: number; year: number; agentId?: number; onBase?: boolean; range?: { from: string; to: string } }) {
    if (!(filters.month >= 1 && filters.month <= 12) || !(filters.year > 2000)) throw new AppError('Please select a valid Month and Year!');
    const { from, to } = filters.range || this.monthRange(filters.month, filters.year);

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
    // DONE = the month already has this party's Hawa Patti voucher ("October 2026 | ARE J")
    const hpLabel = `${this.VAPSI_MONTHS[filters.month - 1]} ${filters.year}`;
    const doneRows = await pgSql<Array<{ narration: string }>>`
      SELECT narration FROM vouchers WHERE voucher_type = 'HAWA_PATTI' AND narration LIKE ${hpLabel + ' | %'}
    `;
    const doneNames = new Set(doneRows.map(d => d.narration.slice(hpLabel.length + 3).trim().toUpperCase()));

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
          done: doneNames.has((l.partyName || '').trim().toUpperCase()),
        };
      })
      .sort((a, b) => a.partyName.localeCompare(b.partyName));
    return { month: filters.month, year: filters.year, from, to, rows };
  }

  static async processHawaPatti(data: {
    month: number;
    year: number;
    voucherDate: string;
    // partyId / baseAmt / hpPct (optional): the playing party, its month P&L and HP % — kept for
    // the HawaPatti Rpt
    items: { hpPartyId: number; amount: number; partyName?: string; partyId?: number; baseAmt?: number; hpPct?: number }[];
  }, user: UserSession) {
    if (!(data.month >= 1 && data.month <= 12) || !(data.year > 2000)) throw new AppError('Please select a valid Month and Year!');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.voucherDate || '')) throw new AppError('Please select Voucher Date!');
    const lines = (data.items || []).filter(i => i.hpPartyId && Number(i.amount) !== 0);
    if (lines.length === 0) throw new AppError('Please tick at least one party with an HP amount!');

    const hpAccountId = await this.getOrCreateLedger(this.HP_ACCOUNT);
    const month = `${this.VAPSI_MONTHS[data.month - 1]} ${data.year}`;
    const createdAt = new Date(`${data.voucherDate}T12:00:00`);
    await this.ensureHawaPattiLines();

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
        const num = (v: unknown) => (v === undefined || v === null || !isFinite(Number(v)) ? null : Number(v).toFixed(2));
        await tx.execute(sql`
          INSERT INTO hawa_patti_lines (voucher_id, month, year, party_id, party_name, hp_party_id, base_amt, hp_pct, hp_amt, added_by)
          VALUES (${voucher.id}, ${data.month}, ${data.year}, ${line.partyId ? Number(line.partyId) : null}, ${line.partyName || null},
                  ${Number(line.hpPartyId)}, ${num(line.baseAmt)}, ${num(line.hpPct)}, ${Number(line.amount).toFixed(2)}, ${user.username || 'SYSTEM'})
        `);
      }
    });
    return { posted: lines.length };
  }

  // HawaPatti Rpt (rpt_hawa_patti): the month's processed Hawa Patti lines — one row per
  // HAWA_PATTI voucher narrated "<Month> <Year>" (Auto Hawa Patti → Process Voucher):
  //   Party     the playing party            HP-Party  the ledger the share was posted to
  //   Base-Amt  the party's month P&L        HP-%      its HP A/C Hissa %
  //   HP-Amt    Base × HP-% — signed: + when the HP party was credited, − when debited
  //             (live ABHISHEK RAWLA −28385 × 20% → −5677)
  //   AddedBy / AddedDate  who processed it and when
  // A voucher processed before the line record existed falls back to its narration (Party), its
  // entries (HP-Party, HP-Amt), the party's HP A/C % today and Base = HP-Amt ÷ HP-%.
  static async getHawaPattiReport(filters: { month: number; year: number }) {
    if (!(filters.month >= 1 && filters.month <= 12) || !(filters.year > 2000)) throw new AppError('Please select a valid Month and Year!');
    await this.ensureHawaPattiLines();
    const label = `${this.VAPSI_MONTHS[filters.month - 1]} ${filters.year}`;
    const vRows = await pgSql<Array<{
      id: number; narration: string | null; updated_by: string | null; updated_at: Date | string; username: string | null;
      party_id: number | null; party_name: string | null; hp_party_id: number | null; base_amt: string | null; hp_pct: string | null;
      added_by: string | null; added_at: Date | string | null;
    }>>`
      SELECT v.id, v.narration, v.updated_by, v.updated_at, u.username,
             l.party_id, l.party_name, l.hp_party_id, l.base_amt, l.hp_pct, l.added_by, l.added_at
      FROM vouchers v
      LEFT JOIN users u ON u.id = v.created_by
      LEFT JOIN hawa_patti_lines l ON l.voucher_id = v.id
      WHERE v.voucher_type = 'HAWA_PATTI' AND (v.narration = ${label} OR v.narration LIKE ${label + ' | %'})
    `;
    if (vRows.length === 0) return { month: filters.month, year: filters.year, rows: [], totalBase: 0, totalHpAmt: 0 };

    const ids = vRows.map(v => v.id);
    const entries = await pgSql<Array<{ voucher_id: number; ledger_id: number; entry_side: string; amount: string; party_name: string }>>`
      SELECT e.voucher_id, e.ledger_id, e.entry_side, e.amount, l.party_name
      FROM voucher_entries e JOIN ledgers l ON l.id = e.ledger_id
      WHERE e.voucher_id IN ${pgSql(ids)}
    `;
    const hpLinks = await db.select({ ledgerId: ledgerThirdPartyLinks.ledgerId, percent: ledgerThirdPartyLinks.percent, owner: ledgers.partyName })
      .from(ledgerThirdPartyLinks)
      .innerJoin(ledgers, eq(ledgers.id, ledgerThirdPartyLinks.ledgerId))
      .where(and(eq(ledgerThirdPartyLinks.linkType, 'HISSA'), sql`UPPER(TRIM(${ledgerThirdPartyLinks.partyName})) = ${this.HP_ACCOUNT}`));
    const hpPctByName = new Map<string, number>();
    for (const h of hpLinks) {
      const k = (h.owner || '').trim().toUpperCase();
      hpPctByName.set(k, (hpPctByName.get(k) || 0) + (parseFloat(h.percent) || 0));
    }

    const rows = vRows.map(v => {
      const mine = entries.filter(e => e.voucher_id === v.id);
      const hpLine = (v.hp_party_id ? mine.find(e => e.ledger_id === v.hp_party_id) : undefined)
        || mine.find(e => (e.party_name || '').trim().toUpperCase() !== this.HP_ACCOUNT)
        || mine[0];
      const amt = parseFloat(hpLine?.amount || '0') || 0;
      const hpAmt = hpLine?.entry_side === 'DR' ? -amt : amt;
      const fromNarration = (v.narration || '').includes(' | ') ? (v.narration || '').split(' | ').slice(1).join(' | ').trim() : '';
      const partyName = v.party_name || fromNarration || hpLine?.party_name || '-';
      const hpPct = v.hp_pct !== null ? parseFloat(v.hp_pct) : (hpPctByName.get(partyName.trim().toUpperCase()) || 0);
      const baseAmt = v.base_amt !== null ? parseFloat(v.base_amt) : (hpPct ? hpAmt * 100 / hpPct : 0);
      return {
        voucherId: v.id,
        partyId: v.party_id,
        partyName,
        hpPartyName: hpLine?.party_name || partyName,
        baseAmt,
        hpPct,
        hpAmt,
        addedBy: v.added_by || v.username || v.updated_by || '-',
        addedAt: TransactionService.stampIso(v.added_at || v.updated_at),
      };
    }).sort((a, b) => a.partyName.localeCompare(b.partyName));
    return {
      month: filters.month,
      year: filters.year,
      rows,
      totalBase: rows.reduce((s, r) => s + r.baseAmt, 0),
      totalHpAmt: rows.reduce((s, r) => s + r.hpAmt, 0),
    };
  }

  // HVS Process (process_hvs) — the month-end settlement desk, one row per party that played in
  // the month (live 11 columns):
  //   P&L         = the month's Sale − Comm − Payout over its declared cycles (the Auto Hawa
  //                 Patti / Auto Vapsi P&L)
  //   HP-Amt      = P&L × HP %  (HP A/C Hissa row) — only while the month's Hawa Patti for the
  //                 party is still to post; once posted it is in Closing, so it reads 0
  //   Vapsi-Amt   = (P&L − HP-Amt) × Vapsi %, when above 0 — likewise 0 once posted
  //                 (live September: Vapsi posted → 0)
  //   Total       = HP-Amt + Vapsi-Amt
  //   Closing     = the party's balance at the month's end (Dr − Cr: vouchers without LIMIT +
  //                 declared game, the OutStanding / Admin Cash balance)
  //   T-Settle-Amt = Closing − Total  (live footer 7763431 − 250955 = 7512476)
  // Built from the month summaries and the balances, all SQL-aggregated and run side by side —
  // no slip or entry rows are pulled into memory.
  static async getHvsProcessData(filters: { fromDate: string; toDate: string; agentId?: number }) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(filters.fromDate || '') || !/^\d{4}-\d{2}-\d{2}$/.test(filters.toDate || '')) {
      throw new AppError('Please select a valid Month and Year!');
    }
    if (filters.fromDate > filters.toDate) throw new AppError('From Date cannot be after To Date!');
    const month = parseInt(filters.fromDate.slice(5, 7), 10);
    const year = parseInt(filters.fromDate.slice(0, 4), 10);
    // P&L / HP / Vapsi over the From–To on screen (the whole month by default); Closing up to To
    const range = { from: filters.fromDate, to: filters.toDate };
    const [vapsi, hp, balances] = await Promise.all([
      this.getVapsiSummary({ month, year, agentId: filters.agentId, withHp: true, range }),
      this.getHawaPattiSummary({ month, year, agentId: filters.agentId, range }),
      this.getLedgerBalancesAsOf(filters.toDate),
    ]);
    const hpById = new Map(hp.rows.map(r => [r.partyId, r]));
    const closingById = new Map(balances.map(b => [b.ledgerId, b.balance]));
    const played = vapsi.rows.filter(r => r.tSale !== 0);
    const ids = played.map(r => r.partyId);
    const mobileRows = ids.length > 0
      ? await db.select({ id: ledgers.id, mobile: ledgers.mobile }).from(ledgers).where(inArray(ledgers.id, ids))
      : [];
    const mobileById = new Map(mobileRows.map(m => [m.id, m.mobile]));

    return played.map(r => {
      const h = hpById.get(r.partyId);
      const hpAmt = h && h.isHp && !h.done ? Math.round(h.hpAmt) : 0;
      const vapsiAmt = !r.done && r.vapsiAmt > 0 ? Math.round(r.vapsiAmt) : 0;
      const total = hpAmt + vapsiAmt;
      const closing = closingById.get(r.partyId) || 0;
      return {
        partyId: r.partyId,
        partyName: r.partyName,
        agentName: r.agentName,
        mobile: mobileById.get(r.partyId) || '-',
        pnl: r.pnl,
        hpAmt,
        vapsiAmt,
        total,
        closing,
        tSettleAmt: closing - total,
      };
    });
  }

  // HVS Go-Process: each ticked party's T-Settle-Amt posted as a cash settlement entry (the party
  // owes, > 0 → received from it, Cr; < 0 → paid to it, Dr), narrated "HVS Process <Month> <Year>",
  // all in one database transaction — every entry is posted or none is.
  static async processHvs(data: { month: number; year: number; voucherDate: string; items: { partyId: number; amount: number }[] }, user: UserSession) {
    if (!(data.month >= 1 && data.month <= 12) || !(data.year > 2000)) throw new AppError('Please select a valid Month and Year!');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.voucherDate || '')) throw new AppError('Please select Date!');
    const lines = (data.items || []).filter(i => i.partyId && Math.round(Number(i.amount) || 0) !== 0);
    if (lines.length === 0) throw new AppError('Please check at least one party with a T-Settle amount!');
    const narration = `HVS Process ${this.VAPSI_MONTHS[data.month - 1]} ${data.year}`;
    const createdAt = new Date(`${data.voucherDate}T12:00:00`);
    await db.transaction(async (tx) => {
      for (const line of lines) {
        const amt = Math.abs(Number(line.amount));
        const side = Number(line.amount) > 0 ? 'CR' : 'DR';
        const voucherType = side === 'CR' ? 'CASH_RECEIPT' : 'CASH_PAYMENT';
        const [voucher] = await tx.insert(vouchers).values({
          voucherNumber: `VOUCH-${voucherType}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
          voucherType,
          totalAmount: amt.toFixed(2),
          narration,
          createdBy: user.userId,
          updatedBy: user.username || 'SYSTEM',
          createdAt,
        }).returning();
        await tx.insert(voucherEntries).values([
          { voucherId: voucher.id, ledgerId: Number(line.partyId), entrySide: side, amount: amt.toFixed(2) },
        ]);
      }
    });
    return { posted: lines.length };
  }

  // Per-staff transaction stats. Free Time / Time Taken / T-Time have no backing data
  // anywhere in this schema (no session-duration tracking exists) — left at 0, same
  // honest-placeholder convention already used for TPC/HP-Amt/RBT elsewhere.
  // Productivity Report (rpt_productivity): per operator (staff), the slips saved in From–To (and
  // Shift), sorted by T-Count as live. Per slip: Start = started_at (when the slip was begun on the
  // Add page; a slip saved before that was tracked starts at its save), End = created_at,
  // Time Taken = End − Start, Free Time = Start − the operator's previous slip's End that day.
  //   Free Count  = slips                  T-Count  = number entries     T-Amount = Σ slip amount
  //   Time Taken  = Σ Time Taken           T-Time   = Σ Time Taken + Σ Free Time (time at the desk)
  //   Free Time   = Σ Free Time gaps longer than D-Min minutes (D-Min blank → 0, as live shows)
  // Times go out in seconds; the page prints them as live (H.MM: 0.17, 1.50). One SQL pass over
  // an index range on created_at (no ::date cast on the column).
  private static async productivitySlips(filters: { fromDate: string; toDate: string; shiftId?: number; userId?: number }) {
    await this.ensureStartedAtColumn();
    const shiftCond = filters.shiftId ? pgSql`AND t.shift_id = ${filters.shiftId}` : pgSql``;
    const userCond = filters.userId ? pgSql`AND t.created_by = ${filters.userId}` : pgSql``;
    return pgSql<Array<{
      id: number; created_by: number; party_name: string; shift_name: string; start_at: string; end_at: string;
      taken_s: string; gap_s: string | null; entries: number; total_amount: string; updated_by: string | null; updated_at: string;
    }>>`
      WITH s AS (
        SELECT t.id, t.created_by, t.created_at AS end_at, COALESCE(t.started_at, t.created_at) AS start_at,
               t.total_amount, t.updated_by, t.updated_at, t.party_id, t.shift_id,
               (SELECT COUNT(*) FROM transaction_entries e WHERE e.transaction_id = t.id)::int AS entries
        FROM transactions t
        WHERE t.status <> 'VOIDED'
          AND t.created_at >= ${filters.fromDate}::date AND t.created_at < (${filters.toDate}::date + 1)
          ${shiftCond} ${userCond}
      ), g AS (
        SELECT s.*, LAG(s.end_at) OVER (PARTITION BY s.created_by, s.end_at::date ORDER BY s.start_at, s.id) AS prev_end
        FROM s
      )
      SELECT g.id, g.created_by, l.party_name, sh.name AS shift_name,
             g.start_at::text AS start_at, g.end_at::text AS end_at,
             GREATEST(EXTRACT(EPOCH FROM (g.end_at - g.start_at)), 0) AS taken_s,
             CASE WHEN g.prev_end IS NULL THEN NULL ELSE GREATEST(EXTRACT(EPOCH FROM (g.start_at - g.prev_end)), 0) END AS gap_s,
             -- slip amount as entered: a Company party's slip is stored negative (signedAmount),
             -- but the operator still entered that much (live X DB 49950, not -49950)
             g.entries, ABS(g.total_amount) AS total_amount, g.updated_by, g.updated_at::text AS updated_at
      FROM g
      JOIN ledgers l ON l.id = g.party_id
      JOIN shifts sh ON sh.id = g.shift_id
      ORDER BY g.created_by, g.start_at, g.id
    `;
  }

  static async getProductivityReport(filters: { fromDate: string; toDate: string; shiftId?: number; dMin?: number }) {
    const [slips, staffRows] = await Promise.all([
      this.productivitySlips(filters),
      db.select({
        userId: staff.userId,
        name: staff.fullName,
        mobile: staff.mobile,
        address: staff.address,
        role: staff.role,
        username: staff.username,
      }).from(staff),
    ]);
    const staffById = new Map(staffRows.map(s => [s.userId, s]));
    const minGap = (filters.dMin && filters.dMin > 0 ? filters.dMin : 0) * 60;
    const agg = new Map<number, { slips: number; entries: number; amount: number; taken: number; gaps: number; free: number }>();
    for (const s of slips) {
      if (!staffById.has(s.created_by)) continue; // operators without a staff record stay out, as before
      const a = agg.get(s.created_by) || { slips: 0, entries: 0, amount: 0, taken: 0, gaps: 0, free: 0 };
      const gap = s.gap_s === null ? 0 : parseFloat(s.gap_s) || 0;
      a.slips += 1;
      a.entries += Number(s.entries) || 0;
      a.amount += parseFloat(s.total_amount) || 0;
      a.taken += parseFloat(s.taken_s) || 0;
      a.gaps += gap;
      if (minGap > 0 && gap > minGap) a.free += gap;
      agg.set(s.created_by, a);
    }
    return Array.from(agg.entries()).map(([userId, a]) => {
      const st = staffById.get(userId)!;
      return {
        staffId: userId,
        name: st.name,
        mobile: st.mobile || '-',
        address: st.address || '-',
        role: st.role || '-',
        username: st.username || '-',
        freeCount: a.slips,
        // seconds
        freeTime: Math.round(a.free),
        timeTaken: Math.round(a.taken),
        tTime: Math.round(a.taken + a.gaps),
        // T-Count = number entries (live GAGGU 47 slips → 1038)
        tCount: a.entries,
        tAmount: a.amount,
      };
    }).sort((a, b) => a.tCount - b.tCount || a.name.localeCompare(b.name));
  }

  // Productivity Report → click a Name: that operator's slips (live "TRANSACTION PRODUCTIVITY
  // REPORT"): Party, Shift, Start Time, Time Taken, End Time, Free Time, T-Count, T-Amt,
  // Update By, Update Date — oldest first.
  static async getProductivityDetail(filters: { fromDate: string; toDate: string; shiftId?: number; userId: number }) {
    if (!filters.userId) throw new AppError('Please select a user!');
    const slips = await this.productivitySlips(filters);
    const actorMap = await this.actorDisplayMap();
    return slips.map(s => ({
      transactionId: s.id,
      partyName: s.party_name,
      shiftName: s.shift_name,
      startAt: s.start_at,
      endAt: s.end_at,
      timeTaken: Math.round(parseFloat(s.taken_s) || 0),
      freeTime: s.gap_s === null ? 0 : Math.round(parseFloat(s.gap_s) || 0),
      tCount: Number(s.entries) || 0,
      tAmount: parseFloat(s.total_amount) || 0,
      updatedBy: this.showActor(actorMap, s.updated_by) || '-',
      updatedAt: s.updated_at,
    }));
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
      // live: number entries per shift (B18 JAI LUXMI 284 = its Productivity Report T-Count)
      count: sql<number>`COALESCE(SUM((SELECT COUNT(*) FROM transaction_entries e WHERE e.transaction_id = ${transactions.id})), 0)::int`,
    })
      .from(transactions)
      .innerJoin(staff, eq(transactions.createdBy, staff.userId))
      .innerJoin(shifts, eq(transactions.shiftId, shifts.id))
      .where(and(
        ne(transactions.status, 'VOIDED'),
        // index-friendly day range (no ::date cast on the column)
        sql`${transactions.createdAt} >= ${filters.fromDate}::date`,
        sql`${transactions.createdAt} < (${filters.toDate}::date + 1)`,
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
      entry.perShift[r.shiftName] = Number(r.count) || 0;
      entry.tCount += Number(r.count) || 0;
    }

    // live order: fewest entries first (SUBHASH 104 … B10 9019)
    return Array.from(byStaff.values()).sort((a, b) => a.tCount - b.tCount || a.name.localeCompare(b.name));
  }

  // Per-staff audit stats: Mistake = voided, Modify = edited after creation (updatedAt !=
  // createdAt) — both derived from fields already on the transactions table.
  // Productivity Audit (rpt_productivity_trans_audit) — the AUDITORS' work, not the operators':
  // every Valid / Mistake verdict given on Declare Trans-Audit in From–To (audit_logs, action
  // AUDIT), the latest verdict per slip counting once. Per auditor (live S09, TALLY OPERATOR):
  //   T-Party = parties of the slips audited    T-Count = slips audited = Valid + Mistake
  //   Modify  = slips edited after the verdict  T-Amount = Σ those slips' amount
  // Shift filters on the slip's shift. Index-friendly day range on audit_logs.created_at.
  private static async productivityAuditEvents(filters: { fromDate: string; toDate: string; shiftId?: number; userId?: number }) {
    const shiftCond = filters.shiftId ? pgSql`AND t.shift_id = ${filters.shiftId}` : pgSql``;
    const userCond = filters.userId ? pgSql`AND a.actor_id = ${filters.userId}` : pgSql``;
    return pgSql<Array<{
      actor_id: number; transaction_id: number; audited_at: string; status: string; remark: string | null;
      party_id: number; party_name: string; shift_name: string; total_amount: string; modified: boolean;
    }>>`
      SELECT * FROM (
        SELECT DISTINCT ON (a.actor_id, t.id)
               a.actor_id, t.id AS transaction_id, a.created_at::text AS audited_at,
               a.after_data->>'auditStatus' AS status, a.after_data->>'mistakeRemark' AS remark,
               t.party_id, l.party_name, sh.name AS shift_name, t.total_amount,
               (t.updated_at > a.created_at) AS modified
        FROM audit_logs a
        JOIN transactions t ON t.id::text = a.entity_id
        JOIN ledgers l ON l.id = t.party_id
        JOIN shifts sh ON sh.id = t.shift_id
        WHERE a.action = 'AUDIT' AND a.entity_type = 'TRANSACTION'
          AND a.created_at >= ${filters.fromDate}::date AND a.created_at < (${filters.toDate}::date + 1)
          AND a.after_data->>'auditStatus' IN ('VALID', 'MISTAKE')
          ${shiftCond} ${userCond}
        ORDER BY a.actor_id, t.id, a.created_at DESC
      ) x
      ORDER BY x.actor_id, x.audited_at, x.transaction_id
    `;
  }

  static async getProductivityAudit(filters: { fromDate: string; toDate: string; shiftId?: number }) {
    const events = await this.productivityAuditEvents(filters);
    const actorIds = Array.from(new Set(events.map(e => e.actor_id)));
    if (actorIds.length === 0) return [];
    const [staffRows, userRows] = await Promise.all([
      db.select({ userId: staff.userId, name: staff.fullName, mobile: staff.mobile, address: staff.address, role: staff.role, username: staff.username })
        .from(staff).where(inArray(staff.userId, actorIds)),
      db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, actorIds)),
    ]);
    const staffById = new Map(staffRows.map(s => [s.userId, s]));
    const userById = new Map(userRows.map(u => [u.id, u.username]));
    const agg = new Map<number, { parties: Set<number>; count: number; valid: number; mistake: number; modify: number; amount: number }>();
    for (const e of events) {
      const a = agg.get(e.actor_id) || { parties: new Set<number>(), count: 0, valid: 0, mistake: 0, modify: 0, amount: 0 };
      a.parties.add(e.party_id);
      a.count += 1;
      if (e.status === 'MISTAKE') a.mistake += 1; else a.valid += 1;
      if (e.modified) a.modify += 1;
      a.amount += parseFloat(e.total_amount) || 0;
      agg.set(e.actor_id, a);
    }
    return Array.from(agg.entries()).map(([actorId, a]) => {
      const st = staffById.get(actorId);
      const username = st?.username || userById.get(actorId) || '-';
      return {
        staffId: actorId,
        name: st?.name || username,
        mobile: st?.mobile || '-',
        address: st?.address || '-',
        role: st?.role || '-',
        username,
        tParty: a.parties.size,
        tCount: a.count,
        valid: a.valid,
        mistake: a.mistake,
        modify: a.modify,
        tAmount: a.amount,
      };
    }).sort((a, b) => a.tCount - b.tCount || a.name.localeCompare(b.name));
  }

  // Productivity Audit → click a Name (live "TRANSACTION PRODUCTIVITY REPORT"): that auditor's
  // verdicts in time order — Party, Shift, Added Time (when the verdict was given), Diff Time
  // (since the previous verdict; the first reads START), Status (VALID / MISTAKE + its remark),
  // T-Amount, Update By (the auditor), Update Date.
  static async getProductivityAuditDetail(filters: { fromDate: string; toDate: string; shiftId?: number; userId: number }) {
    if (!filters.userId) throw new AppError('Please select a user!');
    const events = await this.productivityAuditEvents(filters);
    const [u] = await db.select({ username: users.username }).from(users).where(eq(users.id, filters.userId));
    let prev: number | null = null;
    return events.map(e => {
      const at = new Date(e.audited_at.replace(' ', 'T')).getTime();
      const diff = prev === null || !Number.isFinite(at) ? null : Math.max(0, Math.round((at - prev) / 1000));
      if (Number.isFinite(at)) prev = at;
      return {
        transactionId: e.transaction_id,
        partyName: e.party_name,
        shiftName: e.shift_name,
        auditedAt: e.audited_at,
        // seconds since the previous verdict; null on the first (START)
        diffSeconds: diff,
        status: e.status,
        remark: e.remark || '',
        modified: e.modified,
        tAmount: parseFloat(e.total_amount) || 0,
        updatedBy: u?.username || '-',
        updatedAt: e.audited_at,
      };
    });
  }

  // Shared before/after-declare split, reused by both getTransBeforeAfterDeclare (row-level,
  // one shift-day) and getPlBeforeAfterDeclare (aggregate-only, many shift-days). P&L reuses
  // the exact winner-matching logic already validated in getAllShiftPartyReport above (DARA
  // matches the declared number, HARUF_ANDAR/BAHAR match its tens/units digit) — just
  // bucketed by whether the transaction landed before or after declarations.declaredAt.
  private static async computeBeforeAfterTotals(shiftId: number, date: string) {
    let [decl] = await db.select().from(declarations)
      .where(and(eq(declarations.shiftId, shiftId), sql`${declarations.declaredAt}::date = ${date}::date`))
      .orderBy(desc(declarations.declaredAt))
      .limit(1);
    // A late shift declared after midnight carries the next day's date on its declaration
    if (!decl) {
      [decl] = await db.select().from(declarations)
        .where(and(eq(declarations.shiftId, shiftId), sql`${declarations.declaredAt}::date = (${date}::date + 1)`))
        .orderBy(declarations.declaredAt)
        .limit(1);
    }

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

    void payoutBefore; void payoutAfter;
    // Live (JAI LUXMI 16-10): Sale-Before 32989 / Sale-After 32989 / P&L 8237 / 8237 — the P&L is
    // the Daily Report's Profit (Σ Debit − Σ Credit) for the shift and day:
    //   Before = the slips saved before the result was declared (the book as declared)
    //   After  = every slip now (the book as it stands) — so Sale-After is the whole day's sale,
    //            not just what came in after; Difference = After − Before
    // Undeclared day → the Daily Report has no result yet, P&L reads 0 on both.
    const saleAll = saleBefore + saleAfter;
    let plBefore = 0;
    let plAfter = 0;
    if (decl) {
      const [beforeRpt, nowRpt] = await Promise.all([
        this.getDailyReport({ shiftId, date, beforeDeclarationId: decl.id }),
        this.getDailyReport({ shiftId, date }),
      ]);
      plBefore = beforeRpt.profit || 0;
      plAfter = nowRpt.profit || 0;
    }

    return {
      declaration: decl,
      saleBefore, saleAfter: saleAll, saleDiff: saleAll - saleBefore,
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

  // P&L Before-After Declare (pl_before_after_declare): one row per shift per declared DAY in
  // From–To (the shift's cycle day, as the Daily Report — not the day the declaration was saved),
  // oldest day first, then shift A-Z (live 15-10 → 16-10). Result = that day's number; S / PL
  // Before-After-Diff as Trans Before-After Declare (P&L = the Daily Report Profit). A day that
  // was declared again (ReDeclare) is still one row.
  static async getPlBeforeAfterDeclare(filters: { fromDate: string; toDate: string; shiftId?: number }) {
    const shiftCond = filters.shiftId ? pgSql`AND s.id = ${filters.shiftId}` : pgSql``;
    const days = await pgSql<Array<{ shift_id: number; shift_name: string; day: string; result: string }>>`
      SELECT s.id AS shift_id, s.name AS shift_name, c.cycle_date AS day, c.declared_number AS result
      FROM shift_cycles c JOIN shifts s ON s.id = c.shift_id
      WHERE c.cycle_date BETWEEN ${filters.fromDate} AND ${filters.toDate}
        AND c.declared_number IS NOT NULL ${shiftCond}
      UNION
      SELECT s.id, s.name, s.open_date, s.declared_number
      FROM shifts s
      WHERE s.open_date BETWEEN ${filters.fromDate} AND ${filters.toDate}
        AND s.declared_number IS NOT NULL ${shiftCond}
        AND NOT EXISTS (
          SELECT 1 FROM shift_cycles c2
          WHERE c2.shift_id = s.id AND c2.cycle_date = s.open_date AND c2.declared_number IS NOT NULL
        )
      ORDER BY day, shift_name
    `;
    return Promise.all(days.map(async d => {
      const totals = await this.computeBeforeAfterTotals(d.shift_id, d.day);
      return {
        date: d.day,
        shiftName: d.shift_name,
        result: String(d.result || '').padStart(2, '0'),
        saleBefore: totals.saleBefore,
        saleAfter: totals.saleAfter,
        saleDiff: totals.saleDiff,
        plBefore: totals.plBefore,
        plAfter: totals.plAfter,
        plDiff: totals.plDiff,
      };
    }));
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
    void dayBefore;
    // OP-Bal on From = the party's balance up to the day before: every earlier voucher (LIMIT
    // vouchers are the credit limit, not money) plus every earlier day's game result — the same
    // Opening the All Shift Report shows for the party (positive = Dr, the party owes).
    const allShift = await this.getAllShiftReport({ fromDate: filters.fromDate, toDate: filters.toDate });
    let runningBalance = allShift.rows.find(r => r.partyId === filters.partyId)?.opening || 0;
    // Live "Limit: 141725 Dr": the party's LIMIT vouchers up to To (Dr − Cr)
    const [limitRow] = await pgSql<Array<{ net: string | null }>>`
      SELECT SUM(CASE WHEN e.entry_side = 'DR' THEN e.amount ELSE -e.amount END) AS net
      FROM voucher_entries e JOIN vouchers v ON v.id = e.voucher_id
      WHERE e.ledger_id = ${filters.partyId} AND v.voucher_type = 'LIMIT' AND v.created_at::date <= ${filters.toDate}::date
    `;
    const limitBalance = parseFloat(limitRow?.net || '0') || 0;

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
      ? await db.select({ id: shifts.id, declaredNumber: shifts.declaredNumber, openDate: shifts.openDate }).from(shifts).where(inArray(shifts.id, shiftIds))
      : [];
    // Each day is judged on that day's own result (its cycle's number; the shift's current number
    // only for its open day) — a past day must not use today's result.
    const cycleRows = shiftIds.length > 0
      ? await db.select({ shiftId: shiftCycles.shiftId, cycleDate: shiftCycles.cycleDate, status: shiftCycles.status, declaredNumber: shiftCycles.declaredNumber })
          .from(shiftCycles).where(inArray(shiftCycles.shiftId, shiftIds))
      : [];
    const cycleResult = new Map<string, string | null>();
    for (const c of cycleRows) {
      const n = (c.status === 'DECLARED' || c.status === 'AUDITED' || c.declaredNumber) ? c.declaredNumber : null;
      cycleResult.set(`${c.shiftId}|${c.cycleDate}`, n ? n.padStart(2, '0') : null);
    }
    const shiftById = new Map(shiftRows.map(s => [s.id, s]));
    const declaredFor = (shiftId: number, day: string): string | null => {
      const key = `${shiftId}|${day}`;
      if (cycleResult.has(key) && cycleResult.get(key)) return cycleResult.get(key)!;
      const sh = shiftById.get(shiftId);
      return sh && sh.openDate === day && sh.declaredNumber ? sh.declaredNumber.padStart(2, '0') : null;
    };

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
    const settlingTpc = await TransactionService.tpcPctByLedger([party.id]);
    // S-Hissa: the larger of Re-Config's Self Hissa and the Hissa Party rows naming the party
    // itself (live DK ROHIT 20%: "DK ROHIT 20% 20" -> 105900 − 10590 − 300×90 = 68310, Hissa −13662)
    const selfLinks = await db.select({ partyName: ledgerThirdPartyLinks.partyName, percent: ledgerThirdPartyLinks.percent })
      .from(ledgerThirdPartyLinks)
      .where(and(eq(ledgerThirdPartyLinks.linkType, 'HISSA'), eq(ledgerThirdPartyLinks.ledgerId, party.id)));
    const ownName = (party.partyName || '').trim().toUpperCase();
    const selfLinkPct = selfLinks.filter(l => (l.partyName || '').trim().toUpperCase() === ownName)
      .reduce((a, l) => a + (parseFloat(l.percent) || 0), 0);
    const hissaPct = Math.max(parseFloat(party.hissaPercentage) || 0, selfLinkPct);

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
        const declaredNumber = declaredFor(tx.shiftId, day);
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
      const comm = TransactionService.partyComm(totalSale, dSale, aSale, commissionRate, settlingTpc.get(party.id));
      const book = totalSale + comm - payout;
      const hissa = -(book * hissaPct / 100) + 0;
      const pnl = book + hissa;

      // Payment as live shows it, Dr − Cr: money the party paid in is minus and brings the
      // balance down (live DAKSH JAI LUXMI 13-10: 43825 + 3277 + (−50000) = −2898)
      const dayPayments = settleEntries.filter(s => s.day === day);
      const payment = dayPayments.reduce((sum, s) => sum + (s.entrySide === 'DR' ? parseFloat(s.amount) : -parseFloat(s.amount)), 0) + 0;

      const opBal = runningBalance;
      const balance = opBal + pnl + payment;
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

    // Live lists only the days the party played or paid (DAKSH JAI LUXMI: no 02-10 row); the
    // balance still runs through every day (an empty day changes nothing)
    const shownRows = rows.filter(r => r.totalSale !== 0 || r.payment !== 0);

    return {
      partyId: party.id,
      partyName: party.partyName,
      agentName,
      rate: rateStr,
      // Live "Limit": the balance with the party's LIMIT vouchers on top — DAKSH JAI LUXMI (no
      // LIMIT voucher) Limit 3351 Cr = Balance 3351 Cr; DK ROHIT 20% Balance 225725 Dr, Limit 141725 Dr
      limit: runningBalance + limitBalance,
      betLimit: parseFloat(party.betLimit),
      balance: runningBalance,
      rows: shownRows,
    };
  }
}
