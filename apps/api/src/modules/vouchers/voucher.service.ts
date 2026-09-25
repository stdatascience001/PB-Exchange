import { db, vouchers, voucherEntries, shifts, ledgers, users, agents } from '@pb/database';
import { eq, desc, asc, and, inArray, sql, isNull } from 'drizzle-orm';
import { NotFoundError } from '../../common/errors.js';
import { UserSession } from '@pb/types';
import crypto from 'crypto';

export class VoucherService {
  static async listVouchers(filters: { shiftId?: number; voucherType?: string; auditStatus?: string }) {
    const conditions = [];
    if (filters.shiftId) conditions.push(eq(vouchers.shiftId, filters.shiftId));
    if (filters.voucherType) conditions.push(eq(vouchers.voucherType, filters.voucherType));
    if (filters.auditStatus && filters.auditStatus !== 'ALL') {
      conditions.push(eq(vouchers.auditStatus, filters.auditStatus));
    }

    const list = await db.select({
      id: vouchers.id,
      voucherNumber: vouchers.voucherNumber,
      voucherType: vouchers.voucherType,
      shiftId: vouchers.shiftId,
      shiftName: shifts.name,
      totalAmount: vouchers.totalAmount,
      narration: vouchers.narration,
      auditStatus: vouchers.auditStatus,
      createdBy: vouchers.createdBy,
      createdByUsername: users.username,
      updatedBy: vouchers.updatedBy,
      createdAt: vouchers.createdAt,
      updatedAt: vouchers.updatedAt,
    })
      .from(vouchers)
      .leftJoin(shifts, eq(vouchers.shiftId, shifts.id))
      .leftJoin(users, eq(vouchers.createdBy, users.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(vouchers.createdAt));

    return list.map(v => ({
      ...v,
      shiftName: v.shiftName || '-',
      totalAmount: parseFloat(v.totalAmount),
      createdByUsername: v.createdByUsername || 'SYSTEM',
      updatedBy: v.updatedBy || 'SYSTEM',
      createdAt: v.createdAt.toISOString(),
      updatedAt: v.updatedAt.toISOString(),
    }));
  }

  static async getVoucherEntries(voucherId: number) {
    const list = await db.select({
      id: voucherEntries.id,
      ledgerId: voucherEntries.ledgerId,
      partyName: ledgers.partyName,
      entrySide: voucherEntries.entrySide,
      amount: voucherEntries.amount,
      createdAt: voucherEntries.createdAt,
    })
      .from(voucherEntries)
      .leftJoin(ledgers, eq(voucherEntries.ledgerId, ledgers.id))
      .where(eq(voucherEntries.voucherId, voucherId))
      .orderBy(desc(voucherEntries.createdAt));

    return list.map(e => ({
      ...e,
      amount: parseFloat(e.amount),
      createdAt: e.createdAt.toISOString(),
    }));
  }

  // Manual double-entry vouchers (Journal/Limit/Kist/Vapsi/Hawa Patti): each voucher has
  // exactly 2 entries — the "Party" side and the balancing "Opposite Party" side.
  static async listManualVouchers(filters: {
    voucherType?: string;
    auditStatus?: string;
    fromDate?: string;
    toDate?: string;
    search?: string;
  }) {
    const conditions = [];
    if (filters.voucherType) conditions.push(eq(vouchers.voucherType, filters.voucherType));
    if (filters.auditStatus && filters.auditStatus !== 'ALL') conditions.push(eq(vouchers.auditStatus, filters.auditStatus));
    // Cast to ::date rather than comparing absolute instants — created_at is stored as a
    // timezone-less "wall clock" value (same convention as dashboard.service.ts's shift-cycle
    // date matching), so comparing raw date strings this way stays consistent with it.
    if (filters.fromDate) conditions.push(sql`${vouchers.createdAt}::date >= ${filters.fromDate}::date`);
    if (filters.toDate) conditions.push(sql`${vouchers.createdAt}::date <= ${filters.toDate}::date`);

    const voucherRows = await db.select({
      id: vouchers.id,
      voucherNumber: vouchers.voucherNumber,
      voucherType: vouchers.voucherType,
      totalAmount: vouchers.totalAmount,
      narration: vouchers.narration,
      auditStatus: vouchers.auditStatus,
      createdBy: vouchers.createdBy,
      createdByUsername: users.username,
      updatedBy: vouchers.updatedBy,
      createdAt: vouchers.createdAt,
      updatedAt: vouchers.updatedAt,
    })
      .from(vouchers)
      .leftJoin(users, eq(vouchers.createdBy, users.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(vouchers.createdAt));

    const voucherIds = voucherRows.map(v => v.id);
    const entryRows = voucherIds.length > 0
      ? await db.select({
          id: voucherEntries.id,
          voucherId: voucherEntries.voucherId,
          ledgerId: voucherEntries.ledgerId,
          partyName: ledgers.partyName,
          entrySide: voucherEntries.entrySide,
        })
          .from(voucherEntries)
          .leftJoin(ledgers, eq(voucherEntries.ledgerId, ledgers.id))
          .where(inArray(voucherEntries.voucherId, voucherIds))
          .orderBy(asc(voucherEntries.id))
      : [];

    const entriesByVoucher = new Map<number, typeof entryRows>();
    for (const e of entryRows) {
      if (!entriesByVoucher.has(e.voucherId)) entriesByVoucher.set(e.voucherId, []);
      entriesByVoucher.get(e.voucherId)!.push(e);
    }

    const result = voucherRows.map(v => {
      const ents = entriesByVoucher.get(v.id) || [];
      const first = ents[0];
      const second = ents[1];
      return {
        id: v.id,
        voucherNumber: v.voucherNumber,
        voucherType: v.voucherType,
        totalAmount: parseFloat(v.totalAmount),
        narration: v.narration,
        auditStatus: v.auditStatus,
        partyLedgerId: first?.ledgerId ?? 0,
        partyName: first?.partyName || '-',
        entrySide: first?.entrySide || 'DR',
        oppositeLedgerId: second?.ledgerId ?? 0,
        oppositePartyName: second?.partyName || '-',
        createdBy: v.createdBy,
        createdByUsername: v.createdByUsername || 'SYSTEM',
        updatedBy: v.updatedBy || 'SYSTEM',
        createdAt: v.createdAt.toISOString(),
        updatedAt: v.updatedAt.toISOString(),
      };
    });

    if (filters.search && filters.search.trim()) {
      const term = filters.search.trim().toLowerCase();
      return result.filter(r =>
        r.partyName.toLowerCase().includes(term) || r.oppositePartyName.toLowerCase().includes(term)
      );
    }

    return result;
  }

  // Single-sided settlement entry (Settling Report's Save (F2) form) — deliberately relaxes
  // the double-entry pairing createManualVoucher enforces, since a cash settlement against
  // one party has no natural "opposite ledger" in this schema. Tagged as CASH_RECEIPT/
  // CASH_PAYMENT so it shows up in the Admin Cash report and this party's Payment column.
  static async createSettlementEntry(data: {
    partyLedgerId: number;
    entrySide: 'DR' | 'CR';
    amount: number;
    narration?: string;
    voucherDate?: string;
  }, user: UserSession) {
    const voucherType = data.entrySide === 'CR' ? 'CASH_RECEIPT' : 'CASH_PAYMENT';
    const voucherNum = `VOUCH-${voucherType}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const createdAt = data.voucherDate ? new Date(`${data.voucherDate}T12:00:00`) : undefined;

    return await db.transaction(async (tx) => {
      const [voucher] = await tx.insert(vouchers).values({
        voucherNumber: voucherNum,
        voucherType,
        totalAmount: data.amount.toFixed(2),
        narration: data.narration || 'Settlement entry',
        createdBy: user.userId,
        updatedBy: user.username || 'SYSTEM',
        ...(createdAt ? { createdAt } : {}),
      }).returning();

      await tx.insert(voucherEntries).values([
        { voucherId: voucher.id, ledgerId: data.partyLedgerId, entrySide: data.entrySide, amount: data.amount.toFixed(2) },
      ]);

      return voucher;
    });
  }

  static async createManualVoucher(data: {
    voucherType: string;
    partyLedgerId: number;
    entrySide: 'DR' | 'CR';
    oppositeLedgerId: number;
    amount: number;
    narration?: string;
    shiftId?: number;
    voucherDate?: string;
  }, user: UserSession) {
    const oppositeSide = data.entrySide === 'DR' ? 'CR' : 'DR';
    const voucherNum = `VOUCH-${data.voucherType}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    // Anchored at noon to avoid the date shifting by a day under the server's local timezone.
    const createdAt = data.voucherDate ? new Date(`${data.voucherDate}T12:00:00`) : undefined;

    return await db.transaction(async (tx) => {
      const [voucher] = await tx.insert(vouchers).values({
        voucherNumber: voucherNum,
        voucherType: data.voucherType,
        shiftId: data.shiftId,
        totalAmount: data.amount.toFixed(2),
        narration: data.narration || null,
        createdBy: user.userId,
        updatedBy: user.username || 'SYSTEM',
        ...(createdAt ? { createdAt } : {}),
      }).returning();

      await tx.insert(voucherEntries).values([
        { voucherId: voucher.id, ledgerId: data.partyLedgerId, entrySide: data.entrySide, amount: data.amount.toFixed(2) },
        { voucherId: voucher.id, ledgerId: data.oppositeLedgerId, entrySide: oppositeSide, amount: data.amount.toFixed(2) },
      ]);

      return voucher;
    });
  }

  static async updateManualVoucher(id: number, data: {
    partyLedgerId?: number;
    entrySide?: 'DR' | 'CR';
    oppositeLedgerId?: number;
    amount?: number;
    narration?: string;
    voucherDate?: string;
  }, user: UserSession) {
    const [existing] = await db.select().from(vouchers).where(eq(vouchers.id, id));
    if (!existing) throw new NotFoundError('Voucher not found');

    const updatePayload: any = { updatedAt: new Date(), updatedBy: user.username || 'SYSTEM' };
    if (data.amount !== undefined) updatePayload.totalAmount = data.amount.toFixed(2);
    if (data.narration !== undefined) updatePayload.narration = data.narration;
    if (data.voucherDate) updatePayload.createdAt = new Date(`${data.voucherDate}T12:00:00`);

    const [updated] = await db.update(vouchers).set(updatePayload).where(eq(vouchers.id, id)).returning();

    const touchesEntries = data.partyLedgerId !== undefined || data.oppositeLedgerId !== undefined
      || data.amount !== undefined || data.entrySide !== undefined;

    if (touchesEntries) {
      const entries = await db.select().from(voucherEntries)
        .where(eq(voucherEntries.voucherId, id))
        .orderBy(asc(voucherEntries.id));

      if (entries.length >= 2) {
        const side = data.entrySide || entries[0].entrySide;
        const oppositeSide = side === 'DR' ? 'CR' : 'DR';
        const amt = (data.amount ?? parseFloat(entries[0].amount)).toFixed(2);

        await db.update(voucherEntries).set({
          ledgerId: data.partyLedgerId ?? entries[0].ledgerId,
          entrySide: side,
          amount: amt,
        }).where(eq(voucherEntries.id, entries[0].id));

        await db.update(voucherEntries).set({
          ledgerId: data.oppositeLedgerId ?? entries[1].ledgerId,
          entrySide: oppositeSide,
          amount: amt,
        }).where(eq(voucherEntries.id, entries[1].id));
      }
    }

    return updated;
  }

  static async deleteVoucher(id: number) {
    const [deleted] = await db.delete(vouchers).where(eq(vouchers.id, id)).returning();
    if (!deleted) throw new NotFoundError('Voucher not found');
    return deleted;
  }

  static async updateVoucherAuditStatus(id: number, auditStatus: 'FOR_AUDIT' | 'ALLOWED' | 'CANCELED', user: UserSession) {
    const [existing] = await db.select().from(vouchers).where(eq(vouchers.id, id));
    if (!existing) throw new NotFoundError('Voucher not found');

    const [updated] = await db.update(vouchers).set({
      auditStatus,
      updatedAt: new Date(),
      updatedBy: user.username || 'AUDITOR',
    }).where(eq(vouchers.id, id)).returning();

    return updated;
  }

  // Simple on-the-fly duplicate detection: same party + amount + calendar day, no stored review table.
  static async getVoucherDuplicateCounts(filters: { voucherType: string; fromDate?: string; toDate?: string }) {
    const list = await this.listManualVouchers({
      voucherType: filters.voucherType,
      fromDate: filters.fromDate,
      toDate: filters.toDate,
    });

    const groups = new Map<string, typeof list>();
    for (const v of list) {
      const dateKey = v.createdAt.slice(0, 10);
      const key = `${v.partyLedgerId}:${v.totalAmount}:${dateKey}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(v);
    }

    const duplicates: Array<{
      partyLedgerId: number;
      partyName: string;
      amount: number;
      voucherDate: string;
      entrySide: string;
      oppositePartyName: string;
      count: number;
      voucherIds: number[];
    }> = [];

    for (const group of groups.values()) {
      if (group.length > 1) {
        const first = group[0];
        duplicates.push({
          partyLedgerId: first.partyLedgerId,
          partyName: first.partyName,
          amount: first.totalAmount,
          voucherDate: first.createdAt.slice(0, 10),
          entrySide: first.entrySide,
          oppositePartyName: first.oppositePartyName,
          count: group.length,
          voucherIds: group.map(g => g.id),
        });
      }
    }

    return duplicates;
  }

  // Ledger balance derived purely from voucher DR/CR activity — betting activity has its
  // own reporting (Jantri/Daily Report) and is deliberately not mixed in here. Powers
  // Trial Balance, OutStanding, Limit & Balance, and Admin Cash (via voucherTypes filter).
  static async getLedgerBalances(filters: {
    voucherType?: string;
    voucherTypes?: string[];
    fromDate?: string;
    toDate?: string;
    agentId?: number;
  }) {
    const conditions = [];
    if (filters.voucherType) conditions.push(eq(vouchers.voucherType, filters.voucherType));
    if (filters.voucherTypes && filters.voucherTypes.length > 0) {
      conditions.push(inArray(vouchers.voucherType, filters.voucherTypes));
    }
    if (filters.fromDate) conditions.push(sql`${vouchers.createdAt}::date >= ${filters.fromDate}::date`);
    if (filters.toDate) conditions.push(sql`${vouchers.createdAt}::date <= ${filters.toDate}::date`);
    if (filters.agentId) conditions.push(eq(ledgers.agentId, filters.agentId));

    const rows = await db.select({
      ledgerId: voucherEntries.ledgerId,
      partyName: ledgers.partyName,
      betLimit: ledgers.betLimit,
      agentId: ledgers.agentId,
      totalDr: sql<string>`COALESCE(SUM(CASE WHEN ${voucherEntries.entrySide} = 'DR' THEN ${voucherEntries.amount}::numeric ELSE 0 END), 0)`,
      totalCr: sql<string>`COALESCE(SUM(CASE WHEN ${voucherEntries.entrySide} = 'CR' THEN ${voucherEntries.amount}::numeric ELSE 0 END), 0)`,
    })
      .from(voucherEntries)
      .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
      .innerJoin(ledgers, eq(voucherEntries.ledgerId, ledgers.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .groupBy(voucherEntries.ledgerId, ledgers.partyName, ledgers.betLimit, ledgers.agentId);

    const agentIds = Array.from(new Set(rows.map(r => r.agentId).filter((id): id is number => id != null)));
    const agentRows = agentIds.length > 0
      ? await db.select({ id: agents.id, agentName: agents.agentName }).from(agents).where(inArray(agents.id, agentIds))
      : [];
    const agentNameById = new Map(agentRows.map(a => [a.id, a.agentName]));

    return rows.map(r => {
      const totalDr = parseFloat(r.totalDr);
      const totalCr = parseFloat(r.totalCr);
      return {
        ledgerId: r.ledgerId,
        partyName: r.partyName,
        betLimit: parseFloat(r.betLimit),
        agentId: r.agentId,
        agentName: r.agentId ? (agentNameById.get(r.agentId) || '-') : '-',
        totalDr,
        totalCr,
        balance: totalCr - totalDr,
      };
    });
  }

  // Ledgers grouped as "Cash Agent" — powers the "Agents" dropdown on the OutStanding
  // Report page. Selecting one resolves to its own agentId, which then scopes the report
  // the same way the "Group" (agents master) dropdown does.
  static async listCashAgentLedgers() {
    return db.select({
      id: ledgers.id,
      partyName: ledgers.partyName,
      agentId: ledgers.agentId,
    })
      .from(ledgers)
      .where(and(eq(ledgers.groupName, 'Cash Agent'), isNull(ledgers.deletedAt)))
      .orderBy(asc(ledgers.id));
  }

  // Per-party rows for the Settlement / Settlement Agent pages: Credit/Debit scoped to the
  // selected period, Balance reuses the same cumulative getLedgerBalances(toDate) concept
  // already validated for Settling/All-Shift Report's "Opening" balance (not a new formula).
  static async getPartySettlementRows(filters: {
    fromDate: string;
    toDate: string;
    agentId?: number;
    search?: string;
  }) {
    const conditions = [
      sql`${vouchers.createdAt}::date >= ${filters.fromDate}::date`,
      sql`${vouchers.createdAt}::date <= ${filters.toDate}::date`,
    ];
    if (filters.agentId) conditions.push(eq(ledgers.agentId, filters.agentId));

    const rows = await db.select({
      ledgerId: voucherEntries.ledgerId,
      partyName: ledgers.partyName,
      agentId: ledgers.agentId,
      totalDr: sql<string>`COALESCE(SUM(CASE WHEN ${voucherEntries.entrySide} = 'DR' THEN ${voucherEntries.amount}::numeric ELSE 0 END), 0)`,
      totalCr: sql<string>`COALESCE(SUM(CASE WHEN ${voucherEntries.entrySide} = 'CR' THEN ${voucherEntries.amount}::numeric ELSE 0 END), 0)`,
      lastUpdatedBy: sql<string>`(array_agg(${vouchers.updatedBy} ORDER BY ${vouchers.updatedAt} DESC))[1]`,
      lastUpdatedAt: sql<Date>`(array_agg(${vouchers.updatedAt} ORDER BY ${vouchers.updatedAt} DESC))[1]`,
    })
      .from(voucherEntries)
      .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
      .innerJoin(ledgers, eq(voucherEntries.ledgerId, ledgers.id))
      .where(and(...conditions))
      .groupBy(voucherEntries.ledgerId, ledgers.partyName, ledgers.agentId);

    const ledgerIds = rows.map(r => r.ledgerId);
    const agentIds = Array.from(new Set(rows.map(r => r.agentId).filter((id): id is number => id != null)));
    const agentRows = agentIds.length > 0
      ? await db.select({ id: agents.id, agentName: agents.agentName }).from(agents).where(inArray(agents.id, agentIds))
      : [];
    const agentNameById = new Map(agentRows.map(a => [a.id, a.agentName]));

    // Balance = cumulative ledger balance as of toDate (same helper used everywhere else).
    const balances = await this.getLedgerBalances({ toDate: filters.toDate });
    const balanceByLedger = new Map(balances.map(b => [b.ledgerId, b.balance]));

    let result = rows.map(r => ({
      ledgerId: r.ledgerId,
      partyName: r.partyName,
      agentId: r.agentId,
      agentName: r.agentId ? (agentNameById.get(r.agentId) || '-') : '-',
      credit: parseFloat(r.totalCr),
      debit: parseFloat(r.totalDr),
      balance: balanceByLedger.get(r.ledgerId) ?? 0,
      updatedBy: r.lastUpdatedBy || 'SYSTEM',
      updatedAt: r.lastUpdatedAt ? new Date(r.lastUpdatedAt).toISOString() : null,
    }));

    if (filters.search && filters.search.trim()) {
      const term = filters.search.trim().toLowerCase();
      result = result.filter(r => r.partyName.toLowerCase().includes(term));
    }

    return result.sort((a, b) => a.partyName.localeCompare(b.partyName));
  }

  // Ledger balances rolled up by agent group. Powers OutStanding Agent-Group.
  static async getAgentGroupBalances(filters: { fromDate?: string; toDate?: string; agentId?: number }) {
    const conditions = [];
    if (filters.fromDate) conditions.push(sql`${vouchers.createdAt}::date >= ${filters.fromDate}::date`);
    if (filters.toDate) conditions.push(sql`${vouchers.createdAt}::date <= ${filters.toDate}::date`);
    if (filters.agentId) conditions.push(eq(ledgers.agentId, filters.agentId));

    const rows = await db.select({
      agentId: ledgers.agentId,
      agentName: agents.agentName,
      mainAgentName: agents.mainAgentName,
      totalDr: sql<string>`COALESCE(SUM(CASE WHEN ${voucherEntries.entrySide} = 'DR' THEN ${voucherEntries.amount}::numeric ELSE 0 END), 0)`,
      totalCr: sql<string>`COALESCE(SUM(CASE WHEN ${voucherEntries.entrySide} = 'CR' THEN ${voucherEntries.amount}::numeric ELSE 0 END), 0)`,
    })
      .from(voucherEntries)
      .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
      .innerJoin(ledgers, eq(voucherEntries.ledgerId, ledgers.id))
      .innerJoin(agents, eq(ledgers.agentId, agents.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .groupBy(ledgers.agentId, agents.agentName, agents.mainAgentName);

    return rows.map(r => ({
      agentId: r.agentId,
      agentGroup: r.mainAgentName || r.agentName,
      agentName: r.agentName,
      credit: parseFloat(r.totalCr),
      debit: parseFloat(r.totalDr),
    })).sort((a, b) => a.agentName.localeCompare(b.agentName));
  }
}
