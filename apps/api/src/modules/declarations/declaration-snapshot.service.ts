import {
  db, sql as pgSql, shifts, shiftCycles, transactions, transactionEntries, declarations,
  declarationSnapshots, declarationPartySnapshots, ledgers, ledgerThirdPartyLinks, auditLogs,
} from '@pb/database';
import { eq, and, ne, inArray, sql } from 'drizzle-orm';
import { AppError, NotFoundError, ForbiddenError } from '../../common/errors.js';
import { publishDashboardUpdate } from '../dashboard/dashboard.events.js';
import { publishShiftsUpdate } from '../shifts/shift.events.js';
import { ShiftService } from '../shifts/shift.service.js';
import { UserSession } from '@pb/types';

type PartyFigure = { partyId: number; partyName: string; sale: number; payout: number; pl: number };

// Only declarations this recent are re-checked for a pending ReDeclare on every dashboard
// poll — keeps the poll cheap as the declarations history grows.
const PENDING_LOOKBACK_DAYS = 30;

const round2 = (n: number) => Math.round(n * 100) / 100;

// "29-09-2026 14:53" — the Declare Needed ReDeclare row's sub-line on the live reference.
function formatChangeTime(val: Date | string): string {
  const d = val instanceof Date ? val : new Date(val);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}-${mm}-${d.getFullYear()} ${hh}:${mi}`;
}

// Same DDL as packages/database migrate.ts, run once per process so ReDeclare works even on
// a database where `npm run db:migrate` has not been re-run since this feature was added.
let ensureTablesPromise: Promise<void> | null = null;
function ensureTables(): Promise<void> {
  if (!ensureTablesPromise) {
    ensureTablesPromise = (async () => {
      await pgSql.unsafe(`
        CREATE TABLE IF NOT EXISTS declaration_snapshots (
          id SERIAL PRIMARY KEY,
          declaration_id INTEGER NOT NULL REFERENCES declarations(id) ON DELETE CASCADE,
          shift_id INTEGER NOT NULL REFERENCES shifts(id),
          cycle_date VARCHAR(10) NOT NULL,
          total_sale NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
          total_pl NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
          redeclare_count INTEGER NOT NULL DEFAULT 0,
          snapshot_at TIMESTAMP NOT NULL DEFAULT NOW(),
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS declaration_snapshots_declaration_idx ON declaration_snapshots(declaration_id);
        CREATE INDEX IF NOT EXISTS declaration_snapshots_shift_cycle_idx ON declaration_snapshots(shift_id, cycle_date);
        CREATE TABLE IF NOT EXISTS declaration_party_snapshots (
          id SERIAL PRIMARY KEY,
          snapshot_id INTEGER NOT NULL REFERENCES declaration_snapshots(id) ON DELETE CASCADE,
          party_id INTEGER NOT NULL REFERENCES ledgers(id),
          party_name VARCHAR(100) NOT NULL,
          sale NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
          pl NUMERIC(14, 2) NOT NULL DEFAULT 0.00
        );
        CREATE INDEX IF NOT EXISTS declaration_party_snapshots_snapshot_idx ON declaration_party_snapshots(snapshot_id);
      `);
    })().catch((err) => {
      ensureTablesPromise = null;
      throw err;
    });
  }
  return ensureTablesPromise;
}

const toDisplayDate = (ymd: string) => {
  const p = ymd.split('-');
  return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : ymd;
};

export class DeclarationSnapshotService {
  // Per-party Sale / P&L of one shift cycle against a winning number. Same per-party formula
  // as the Shift P&L report (TransactionService.getShiftProfitLossReport):
  //   Book = Sale + Comm − Payout; Hissa = −Book × S-Hissa%; TPC = −(D-Sale × D-Comm% +
  //   A-Sale × A-Comm%); Closing = Book + Hissa + TPC.
  // P&L is shown from the party's side (−Closing), matching the popup's rows where a party
  // that won nothing reads −Sale; the summary P&L is the company's side (Σ Closing).
  //
  // asOf rebuilds the figures as they stood at that moment (for a declaration made before
  // snapshots existed): slips entered later are left out, and a slip deleted or re-amounted
  // later is taken at its status / amount / entries from the earliest audit log after asOf
  // that recorded each (Delete and amount edits log the whole row, entry edits log
  // {totalAmount, entries}).
  static async computePartyFigures(shiftId: number, cycleDate: string, winningNumber: string, asOf?: string): Promise<PartyFigure[]> {
    let txRows: Array<{ id: number; partyId: number; totalAmount: string }>;
    const entryOverride = new Map<number, any[]>();
    if (!asOf) {
      txRows = await db.select({
        id: transactions.id,
        partyId: transactions.partyId,
        totalAmount: transactions.totalAmount,
      }).from(transactions).where(and(
        eq(transactions.shiftId, shiftId),
        ne(transactions.status, 'VOIDED'),
        sql`${transactions.createdAt}::date = ${cycleDate}::date`,
      ));
    } else {
      const allRows = await db.select({
        id: transactions.id,
        partyId: transactions.partyId,
        totalAmount: transactions.totalAmount,
        status: transactions.status,
      }).from(transactions).where(and(
        eq(transactions.shiftId, shiftId),
        sql`${transactions.createdAt} <= ${asOf}::timestamp`,
        sql`${transactions.createdAt}::date = ${cycleDate}::date`,
      ));
      const logs = allRows.length > 0
        ? await db.select({
            entityId: auditLogs.entityId,
            beforeData: auditLogs.beforeData,
          }).from(auditLogs).where(and(
            eq(auditLogs.entityType, 'TRANSACTION'),
            inArray(auditLogs.action, ['UPDATE', 'DELETE']),
            inArray(auditLogs.entityId, allRows.map(r => r.id.toString())),
            sql`${auditLogs.createdAt} > ${asOf}::timestamp`,
          )).orderBy(auditLogs.createdAt, auditLogs.id)
        : [];
      const firstBefore = new Map<string, { status?: string; totalAmount?: unknown; entries?: any[] }>();
      for (const l of logs) {
        const b = (l.beforeData || {}) as any;
        const cur = firstBefore.get(l.entityId) || {};
        if (cur.status === undefined && typeof b.status === 'string') cur.status = b.status;
        if (cur.totalAmount === undefined && b.totalAmount != null) cur.totalAmount = b.totalAmount;
        if (cur.entries === undefined && Array.isArray(b.entries)) cur.entries = b.entries;
        firstBefore.set(l.entityId, cur);
      }

      txRows = [];
      for (const r of allRows) {
        const before = firstBefore.get(r.id.toString());
        const status = before?.status ?? r.status;
        if (status === 'VOIDED') continue;
        const amount = before?.totalAmount !== undefined ? String(before.totalAmount) : r.totalAmount;
        txRows.push({ id: r.id, partyId: r.partyId, totalAmount: amount });
        if (before?.entries) entryOverride.set(r.id, before.entries);
      }
    }
    if (txRows.length === 0) return [];

    const txIds = txRows.map(t => t.id);
    const entryRows = await db.select().from(transactionEntries).where(inArray(transactionEntries.transactionId, txIds));
    const entriesByTx = new Map<number, typeof entryRows>();
    for (const e of entryRows) {
      if (entryOverride.has(e.transactionId)) continue;
      if (!entriesByTx.has(e.transactionId)) entriesByTx.set(e.transactionId, []);
      entriesByTx.get(e.transactionId)!.push(e);
    }
    for (const [txId, list] of entryOverride) {
      entriesByTx.set(txId, list.map((e: any) => ({
        ...e,
        transactionId: txId,
        amount: String(e.amount),
        rate: String(e.rate),
      })) as typeof entryRows);
    }

    const partyIds = Array.from(new Set(txRows.map(t => t.partyId)));
    const partyRows = await db.select({
      id: ledgers.id,
      partyName: ledgers.partyName,
      commissionRate: ledgers.commissionRate,
      hissaPercentage: ledgers.hissaPercentage,
    }).from(ledgers).where(inArray(ledgers.id, partyIds));
    const partyById = new Map(partyRows.map(p => [p.id, p]));

    const tpcLinks = await db.select({
      ledgerId: ledgerThirdPartyLinks.ledgerId,
      dComm: ledgerThirdPartyLinks.dComm,
      aComm: ledgerThirdPartyLinks.aComm,
    }).from(ledgerThirdPartyLinks).where(and(
      eq(ledgerThirdPartyLinks.linkType, 'TPC'),
      inArray(ledgerThirdPartyLinks.ledgerId, partyIds),
    ));
    const tpcPctByParty = new Map<number, { d: number; a: number }>();
    for (const l of tpcLinks) {
      const cur = tpcPctByParty.get(l.ledgerId) || { d: 0, a: 0 };
      cur.d += parseFloat(l.dComm || '0');
      cur.a += parseFloat(l.aComm || '0');
      tpcPctByParty.set(l.ledgerId, cur);
    }

    const padded = winningNumber.padStart(2, '0');
    const tensDigit = padded[0];
    const unitsDigit = padded[1];

    const perParty = new Map<number, { sale: number; dSale: number; aSale: number; payout: number }>();
    for (const tx of txRows) {
      if (!perParty.has(tx.partyId)) perParty.set(tx.partyId, { sale: 0, dSale: 0, aSale: 0, payout: 0 });
      const agg = perParty.get(tx.partyId)!;
      agg.sale += parseFloat(tx.totalAmount);
      for (const e of entriesByTx.get(tx.id) || []) {
        const amt = parseFloat(e.amount);
        const rate = parseFloat(e.rate);
        if (e.entryType === 'DARA') {
          agg.dSale += amt;
          if (e.numberValue === padded) agg.payout += amt * rate;
        } else {
          agg.aSale += amt;
          if (e.entryType === 'HARUF_ANDAR' && e.numberValue === tensDigit) agg.payout += amt * rate;
          else if (e.entryType === 'HARUF_BAHAR' && e.numberValue === unitsDigit) agg.payout += amt * rate;
        }
      }
    }

    const figures: PartyFigure[] = [];
    for (const [partyId, agg] of perParty) {
      const party = partyById.get(partyId);
      const commissionRate = parseFloat(party?.commissionRate || '0');
      const hissaPct = parseFloat(party?.hissaPercentage || '0');
      const comm = -(agg.sale * commissionRate / 100);
      const book = agg.sale + comm - agg.payout;
      const hissa = -(book * hissaPct / 100);
      const tpcPct = tpcPctByParty.get(partyId);
      const tpc = tpcPct ? -(agg.dSale * tpcPct.d / 100 + agg.aSale * tpcPct.a / 100) : 0;
      const closing = book + hissa + tpc;
      figures.push({
        partyId,
        partyName: party?.partyName || 'UNKNOWN',
        sale: round2(agg.sale),
        payout: round2(agg.payout),
        pl: round2(-closing),
      });
    }
    figures.sort((a, b) => a.partyName.localeCompare(b.partyName));
    return figures;
  }

  private static async writeSnapshot(
    exec: typeof db,
    header: { declarationId: number; shiftId: number; cycleDate: string; existingId?: number; redeclareCount?: number; snapshotAtText?: string },
    figures: PartyFigure[],
  ) {
    const totalSale = figures.reduce((s, f) => s + f.sale, 0);
    const totalPl = -figures.reduce((s, f) => s + f.pl, 0);

    let snapshotId = header.existingId;
    if (snapshotId) {
      await exec.update(declarationSnapshots).set({
        totalSale: totalSale.toFixed(2),
        totalPl: totalPl.toFixed(2),
        redeclareCount: header.redeclareCount ?? 0,
        snapshotAt: new Date(),
      }).where(eq(declarationSnapshots.id, snapshotId));
      await exec.delete(declarationPartySnapshots).where(eq(declarationPartySnapshots.snapshotId, snapshotId));
    } else {
      const [created] = await exec.insert(declarationSnapshots).values({
        declarationId: header.declarationId,
        shiftId: header.shiftId,
        cycleDate: header.cycleDate,
        totalSale: totalSale.toFixed(2),
        totalPl: totalPl.toFixed(2),
        ...(header.snapshotAtText ? { snapshotAt: sql`${header.snapshotAtText}::timestamp` } : {}),
      }).returning();
      snapshotId = created.id;
    }

    if (figures.length > 0) {
      await exec.insert(declarationPartySnapshots).values(figures.map(f => ({
        snapshotId: snapshotId!,
        partyId: f.partyId,
        partyName: f.partyName,
        sale: f.sale.toFixed(2),
        pl: f.pl.toFixed(2),
      })));
    }
    return snapshotId!;
  }

  // Called right after a declare commits. Never throws: a snapshot hiccup must not fail the
  // declaration itself — that declaration just won't be tracked for ReDeclare.
  static async captureOnDeclare(declarationId: number, shiftId: number, cycleDate: string, winningNumber: string) {
    try {
      await ensureTables();
      const figures = await this.computePartyFigures(shiftId, cycleDate, winningNumber);
      await db.transaction(async (tx) => {
        await this.writeSnapshot(tx as unknown as typeof db, { declarationId, shiftId, cycleDate }, figures);
      });
    } catch (err: any) {
      console.warn('[Declaration Snapshot] capture warning:', err?.message || err);
    }
  }

  // Dashboard Declare Needed: declared cycles whose numbers no longer match what they were
  // declared on. A cheap change check (slips added/edited/deleted, or a party's ledger or TPC
  // link changed since the snapshot) picks candidates; only those are fully recomputed, and
  // one is listed only if some party's Sale or P&L really differs.
  static async listPendingRedeclares() {
    await ensureTables();
    await this.backfillMissingSnapshots();

    const candidates = await pgSql<Array<{
      snapshot_id: number;
      declaration_id: number;
      shift_id: number;
      shift_name: string;
      cycle_date: string;
      winning_number: string;
      snapshot_at: Date;
      tx_changes: number;
      tx_last_at: Date | null;
      tx_last_by: string | null;
      ledger_changes: number;
      ledger_last_at: Date | null;
      ledger_last_by: string | null;
      link_changes: number;
    }>>`
      SELECT
        ds.id AS snapshot_id,
        ds.declaration_id,
        ds.shift_id,
        s.name AS shift_name,
        ds.cycle_date,
        d.winning_number,
        ds.snapshot_at,
        tx.cnt AS tx_changes,
        tx.last_at AS tx_last_at,
        tx.last_by AS tx_last_by,
        lg.cnt AS ledger_changes,
        lg.last_at AS ledger_last_at,
        lg.last_by AS ledger_last_by,
        lk.cnt AS link_changes
      FROM declaration_snapshots ds
      JOIN declarations d ON d.id = ds.declaration_id AND d.is_reversed = FALSE
      JOIN shifts s ON s.id = ds.shift_id AND s.is_active = TRUE
      CROSS JOIN LATERAL (
        SELECT
          COUNT(*)::int AS cnt,
          MAX(GREATEST(t.created_at, t.updated_at)) AS last_at,
          (ARRAY_AGG(COALESCE(t.updated_by, t.added_by) ORDER BY GREATEST(t.created_at, t.updated_at) DESC))[1] AS last_by
        FROM transactions t
        WHERE t.shift_id = ds.shift_id
          AND t.created_at::date = ds.cycle_date::date
          AND GREATEST(t.created_at, t.updated_at) > ds.snapshot_at
      ) tx
      CROSS JOIN LATERAL (
        SELECT
          COUNT(*)::int AS cnt,
          MAX(l.updated_at) AS last_at,
          (ARRAY_AGG(l.updated_by ORDER BY l.updated_at DESC))[1] AS last_by
        FROM declaration_party_snapshots ps
        JOIN ledgers l ON l.id = ps.party_id
        WHERE ps.snapshot_id = ds.id AND l.updated_at > ds.snapshot_at
      ) lg
      CROSS JOIN LATERAL (
        SELECT COUNT(*)::int AS cnt
        FROM declaration_party_snapshots ps
        JOIN ledger_third_party_links k ON k.ledger_id = ps.party_id AND k.link_type = 'TPC'
        WHERE ps.snapshot_id = ds.id AND k.created_at > ds.snapshot_at
      ) lk
      WHERE ds.cycle_date::date >= (CURRENT_DATE - ${PENDING_LOOKBACK_DAYS}::int)
        AND (tx.cnt > 0 OR lg.cnt > 0 OR lk.cnt > 0)
      ORDER BY ds.cycle_date DESC, s.name ASC
    `;

    const pending: Array<{
      declarationId: number;
      shiftId: number;
      shiftName: string;
      cycleDate: string;
      changedBy: string;
      changedAt: Date;
      changeCount: number;
    }> = [];

    for (const c of candidates) {
      const diff = await this.buildComparison(c.snapshot_id, c.shift_id, c.cycle_date, c.winning_number);
      if (!diff.hasDifference) continue;

      const txAt = c.tx_last_at ? new Date(c.tx_last_at) : null;
      const lgAt = c.ledger_last_at ? new Date(c.ledger_last_at) : null;
      const useLedger = lgAt && (!txAt || lgAt > txAt);
      pending.push({
        declarationId: c.declaration_id,
        shiftId: c.shift_id,
        shiftName: c.shift_name,
        cycleDate: c.cycle_date,
        changedBy: (useLedger ? c.ledger_last_by : c.tx_last_by) || 'SYSTEM',
        changedAt: (useLedger ? lgAt : txAt) || new Date(c.snapshot_at),
        changeCount: (c.tx_changes || 0) + (c.ledger_changes || 0) + (c.link_changes || 0),
      });
    }

    return pending.map(p => ({
      ...p,
      displayDate: toDisplayDate(p.cycleDate),
      changedAtLabel: formatChangeTime(p.changedAt),
    }));
  }

  // Declarations made before snapshots existed (or whose capture failed) get one rebuilt as
  // of their declare time, so a change made after the declare still surfaces as ReDeclare.
  // Cycle = the declared shift_cycles row for that number on/before the declare day, else
  // the declare day itself (the Shift P&L report's convention).
  private static async backfillMissingSnapshots() {
    const missing = await pgSql<Array<{ id: number; shift_id: number; winning_number: string; declared_at_text: string; cycle_date: string }>>`
      SELECT
        d.id, d.shift_id, d.winning_number, d.declared_at::text AS declared_at_text,
        COALESCE((
          SELECT c.cycle_date FROM shift_cycles c
          WHERE c.shift_id = d.shift_id
            AND c.declared_number = d.winning_number
            AND c.status IN ('DECLARED', 'AUDITED')
            AND c.cycle_date::date <= d.declared_at::date
          ORDER BY c.cycle_date DESC LIMIT 1
        ), d.declared_at::date::text) AS cycle_date
      FROM declarations d
      LEFT JOIN declaration_snapshots ds ON ds.declaration_id = d.id
      WHERE d.is_reversed = FALSE
        AND ds.id IS NULL
        AND d.declared_at::date >= (CURRENT_DATE - ${PENDING_LOOKBACK_DAYS}::int)
    `;

    for (const d of missing) {
      try {
        const figures = await this.computePartyFigures(d.shift_id, d.cycle_date, d.winning_number, d.declared_at_text);
        await db.transaction(async (tx) => {
          await this.writeSnapshot(tx as unknown as typeof db, {
            declarationId: d.id,
            shiftId: d.shift_id,
            cycleDate: d.cycle_date,
            snapshotAtText: d.declared_at_text,
          }, figures);
        });
      } catch (err: any) {
        // e.g. the unique index on declaration_id when another poll wrote it first
        console.warn('[Declaration Snapshot] backfill warning:', err?.message || err);
      }
    }
  }

  private static async buildComparison(snapshotId: number, shiftId: number, cycleDate: string, winningNumber: string) {
    const snapRows = await db.select().from(declarationPartySnapshots).where(eq(declarationPartySnapshots.snapshotId, snapshotId));
    const current = await this.computePartyFigures(shiftId, cycleDate, winningNumber);

    const byParty = new Map<number, { partyId: number; partyName: string; sale: number; reSale: number; pl: number; rePl: number }>();
    for (const r of snapRows) {
      byParty.set(r.partyId, { partyId: r.partyId, partyName: r.partyName, sale: parseFloat(r.sale), reSale: 0, pl: parseFloat(r.pl), rePl: 0 });
    }
    for (const f of current) {
      const row = byParty.get(f.partyId) || { partyId: f.partyId, partyName: f.partyName, sale: 0, reSale: 0, pl: 0, rePl: 0 };
      row.partyName = f.partyName;
      row.reSale = f.sale;
      row.rePl = f.pl;
      byParty.set(f.partyId, row);
    }

    const rows = Array.from(byParty.values())
      .map(r => ({ ...r, diffSale: round2(r.reSale - r.sale), diffPl: round2(r.rePl - r.pl) }))
      .sort((a, b) => a.partyName.localeCompare(b.partyName));

    const hasDifference = rows.some(r => Math.abs(r.diffSale) >= 0.01 || Math.abs(r.diffPl) >= 0.01);
    return { rows, current, hasDifference };
  }

  private static async loadActive(declarationId: number) {
    await ensureTables();
    const [decl] = await db.select().from(declarations).where(eq(declarations.id, declarationId));
    if (!decl) throw new NotFoundError('Declaration not found');
    if (decl.isReversed) throw new AppError('This declaration has been reversed', 400);

    const [snapshot] = await db.select().from(declarationSnapshots).where(eq(declarationSnapshots.declarationId, declarationId));
    if (!snapshot) throw new NotFoundError('No declare snapshot recorded for this declaration');

    const [shift] = await db.select().from(shifts).where(eq(shifts.id, decl.shiftId));
    if (!shift) throw new NotFoundError('Shift not found');
    return { decl, snapshot, shift };
  }

  // Popup data: SUMMARY (Declare / Re-Declare / Diffrance) + the party-wise table.
  static async getRedeclareInfo(declarationId: number) {
    const { decl, snapshot, shift } = await this.loadActive(declarationId);
    const { rows, hasDifference } = await this.buildComparison(snapshot.id, shift.id, snapshot.cycleDate, decl.winningNumber);

    const declareSale = rows.reduce((s, r) => s + r.sale, 0);
    const reDeclareSale = rows.reduce((s, r) => s + r.reSale, 0);
    const declarePl = -rows.reduce((s, r) => s + r.pl, 0);
    const reDeclarePl = -rows.reduce((s, r) => s + r.rePl, 0);

    return {
      declarationId: decl.id,
      shiftId: shift.id,
      shiftName: shift.name,
      cycleDate: snapshot.cycleDate,
      displayDate: toDisplayDate(snapshot.cycleDate),
      winningNumber: decl.winningNumber,
      redeclareCount: snapshot.redeclareCount,
      hasDifference,
      summary: {
        declare: { sale: round2(declareSale), pl: round2(declarePl) },
        reDeclare: { sale: round2(reDeclareSale), pl: round2(reDeclarePl) },
        // Diffrance follows the table: Σ DIFF-SALE and Σ DIFF-P&L (party side).
        difference: {
          sale: round2(rows.reduce((s, r) => s + r.diffSale, 0)),
          pl: round2(rows.reduce((s, r) => s + r.diffPl, 0)),
        },
      },
      rows,
    };
  }

  // RE-DECLARE: same winning number, re-settled on the current slips and party settings.
  // Refreshes the declaration's and cycle's totals and moves the snapshot forward, so the
  // shift drops out of Declare Needed until something changes again.
  static async redeclare(declarationId: number, user: UserSession) {
    if (user.roleName !== 'DEVELOPER' && user.roleName !== 'SUPER ADMIN' && user.roleName !== 'ADMIN') {
      throw new ForbiddenError('Only Super Admin or Admin can re-declare results');
    }
    const { decl, snapshot, shift } = await this.loadActive(declarationId);
    const figures = await this.computePartyFigures(shift.id, snapshot.cycleDate, decl.winningNumber);

    const totalCollected = figures.reduce((s, f) => s + f.sale, 0);
    const totalPayout = figures.reduce((s, f) => s + f.payout, 0);
    const netProfitLoss = totalCollected - totalPayout;

    await db.transaction(async (tx) => {
      await tx.update(declarations).set({
        totalCollected: totalCollected.toFixed(2),
        totalPayout: totalPayout.toFixed(2),
        netProfitLoss: netProfitLoss.toFixed(2),
      }).where(eq(declarations.id, decl.id));

      await tx.update(shiftCycles).set({
        totalCollected: totalCollected.toFixed(2),
        totalPayout: totalPayout.toFixed(2),
        updatedAt: new Date(),
      }).where(and(eq(shiftCycles.shiftId, shift.id), eq(shiftCycles.cycleDate, snapshot.cycleDate)));

      await this.writeSnapshot(tx as unknown as typeof db, {
        declarationId: decl.id,
        shiftId: shift.id,
        cycleDate: snapshot.cycleDate,
        existingId: snapshot.id,
        redeclareCount: snapshot.redeclareCount + 1,
      }, figures);

      await tx.insert(auditLogs).values({
        actorId: user.userId,
        action: 'REDECLARE',
        entityType: 'SHIFT',
        entityId: shift.id.toString(),
        beforeData: {
          declarationId: decl.id,
          totalCollected: parseFloat(decl.totalCollected),
          totalPayout: parseFloat(decl.totalPayout),
          netProfitLoss: parseFloat(decl.netProfitLoss),
          snapshotSale: parseFloat(snapshot.totalSale),
          snapshotPl: parseFloat(snapshot.totalPl),
        },
        afterData: {
          declarationId: decl.id,
          winningNumber: decl.winningNumber,
          cycleDate: snapshot.cycleDate,
          totalCollected,
          totalPayout,
          netProfitLoss,
        },
      });
    });

    publishDashboardUpdate(shift.id);
    publishShiftsUpdate();
    ShiftService.invalidateListCache();

    return {
      declarationId: decl.id,
      shiftId: shift.id,
      shiftName: shift.name,
      winningNumber: decl.winningNumber,
      totalCollected,
      totalPayout,
      netProfitLoss,
      redeclareCount: snapshot.redeclareCount + 1,
    };
  }
}
