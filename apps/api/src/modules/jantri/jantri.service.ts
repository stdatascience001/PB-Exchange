import { db, shifts, shiftCycles, transactions, transactionEntries, ledgers, agents, ledgerThirdPartyLinks, sql as pgSql } from '@pb/database';
import { eq, and, inArray, sql as dsql } from 'drizzle-orm';
import { redis } from '../../config/redis.js';
import { NotFoundError } from '../../common/errors.js';
import { JantriViewDto, JantriCell, HarufCell } from '@pb/types';

export class JantriService {
  static async getJantriView(shiftId: number, date?: string): Promise<JantriViewDto> {
    const [shift] = await db.select().from(shifts).where(eq(shifts.id, shiftId));
    if (!shift) throw new NotFoundError('Shift not found');

    // The Redis hash is a live cache for the CURRENT cycle only (see rebuildJantriFromSql's
    // comment) — it's only trustworthy when the requested date is today's live open_date.
    // Any other (historical) date bypasses it and always computes fresh from SQL.
    const targetDate = date || shift.openDate;
    let cachedHash: Record<string, string> = {};

    if (targetDate === shift.openDate) {
      const jantriKey = `jantri:${shift.id}:${targetDate}`;
      try {
        cachedHash = await redis.hgetall(jantriKey);
      } catch (err) {
        console.warn('[Jantri] Redis read failed, falling back to SQL:', err);
      }

      if (!cachedHash || Object.keys(cachedHash).length === 0) {
        cachedHash = await this.rebuildJantriFromSql(shift.id, targetDate);
      }
    } else {
      cachedHash = await this.rebuildJantriFromSql(shift.id, targetDate);
    }

    const grid: JantriCell[] = [];
    let maxLiability = 0;
    const totalCollected = parseFloat(cachedHash['TOTAL_COLLECTED'] || '0');

    for (let i = 0; i < 100; i++) {
      const numStr = i.toString().padStart(2, '0');
      const amount = parseFloat(cachedHash[numStr] || '0');
      const liability = amount * 90;
      if (liability > maxLiability) maxLiability = liability;

      grid.push({
        number: numStr,
        totalAmount: amount,
        liability,
        isMaxRisk: false,
      });
    }

    if (maxLiability > 0) {
      for (const cell of grid) {
        if (cell.liability === maxLiability) {
          cell.isMaxRisk = true;
        }
      }
    }

    const haruf: HarufCell[] = [];
    for (let d = 0; d < 10; d++) {
      const dStr = d.toString();
      const andarAmt = parseFloat(cachedHash[`A_${dStr}`] || '0');
      const baharAmt = parseFloat(cachedHash[`B_${dStr}`] || '0');
      haruf.push({
        digit: dStr,
        andarAmount: andarAmt,
        baharAmount: baharAmt,
      });
    }

    return {
      shiftId: shift.id,
      shiftName: shift.name,
      shiftDate: targetDate,
      totalCollected,
      totalRisk: maxLiability,
      grid,
      haruf,
    };
  }

  // Same-shape Jantri grid as getJantriView, but scoped to only the parties linked under one
  // Distributor ledger (ledgers.distributorId) — a fresh SQL computation kept independent of
  // the Redis-cached current-cycle path above so it can't disturb that already-verified cache.
  static async getDistributorJantriView(shiftId: number, distributorId: number, date?: string): Promise<JantriViewDto> {
    const [shift] = await db.select().from(shifts).where(eq(shifts.id, shiftId));
    if (!shift) throw new NotFoundError('Shift not found');
    const targetDate = date || shift.openDate;

    const downstreamParties = await db.select({ id: ledgers.id }).from(ledgers).where(eq(ledgers.distributorId, distributorId));
    const partyIds = downstreamParties.map(p => p.id);

    const hash: Record<string, string> = {};
    let totalCollected = 0;

    if (partyIds.length > 0) {
      const slips = await db.select().from(transactions).where(
        and(
          eq(transactions.shiftId, shiftId),
          eq(transactions.status, 'ACTIVE'),
          inArray(transactions.partyId, partyIds),
          dsql`${transactions.createdAt}::date = ${targetDate}::date`
        )
      );

      const slipIds = slips.map(s => s.id);
      if (slipIds.length > 0) {
        const entries = await db.select().from(transactionEntries).where(inArray(transactionEntries.transactionId, slipIds));
        for (const e of entries) {
          const amt = parseFloat(e.amount);
          totalCollected += amt;
          const key = e.entryType === 'HARUF_ANDAR'
            ? `A_${e.numberValue}`
            : e.entryType === 'HARUF_BAHAR'
            ? `B_${e.numberValue}`
            : e.numberValue;
          const cur = parseFloat(hash[key] || '0');
          hash[key] = (cur + amt).toString();
        }
      }
    }

    const grid: JantriCell[] = [];
    let maxLiability = 0;
    for (let i = 0; i < 100; i++) {
      const numStr = i.toString().padStart(2, '0');
      const amount = parseFloat(hash[numStr] || '0');
      const liability = amount * 90;
      if (liability > maxLiability) maxLiability = liability;
      grid.push({ number: numStr, totalAmount: amount, liability, isMaxRisk: false });
    }
    if (maxLiability > 0) {
      for (const cell of grid) {
        if (cell.liability === maxLiability) cell.isMaxRisk = true;
      }
    }

    const haruf: HarufCell[] = [];
    for (let d = 0; d < 10; d++) {
      const dStr = d.toString();
      haruf.push({
        digit: dStr,
        andarAmount: parseFloat(hash[`A_${dStr}`] || '0'),
        baharAmount: parseFloat(hash[`B_${dStr}`] || '0'),
      });
    }

    return {
      shiftId: shift.id,
      shiftName: shift.name,
      shiftDate: targetDate,
      totalCollected,
      totalRisk: maxLiability,
      grid,
      haruf,
    };
  }

  // Same grid/haruf shape as getJantriView, but every entry's amount is deducted by that
  // entry's own party's real Commission x own-Hissa x HP-linked-Hissa first — the exact
  // per-party formula already confirmed against live data for the Dashboard/Declare
  // "Commission/Hissa/Kat" figure, and now confirmed again here: GHAZIABAD's live Jantri
  // Grand Total (28,800) exactly equals the Dashboard's Commission/Hissa/Kat figure for that
  // same shift (also 28,800) rather than its raw collected total (46,000) — so the Jantri
  // page shows NET amounts, not raw ones. Kept fully independent of getJantriView's Redis
  // cache (which other pages like Company Calculation rely on for RAW values) — always
  // computed fresh from SQL, same as the Distributor Jantri view above.
  static async getNetJantriView(shiftId: number, date?: string): Promise<JantriViewDto> {
    const [shift] = await db.select().from(shifts).where(eq(shifts.id, shiftId));
    if (!shift) throw new NotFoundError('Shift not found');
    const targetDate = date || shift.openDate;

    const activeSlips = await db.select().from(transactions).where(
      and(
        eq(transactions.shiftId, shiftId),
        eq(transactions.status, 'ACTIVE'),
        dsql`${transactions.createdAt}::date = ${targetDate}::date`
      )
    );

    const hash: Record<string, number> = {};
    let totalCollected = 0;

    if (activeSlips.length > 0) {
      const partyIds = Array.from(new Set(activeSlips.map(s => s.partyId)));
      const partyRows = await db.select({
        id: ledgers.id,
        commissionRate: ledgers.commissionRate,
        hissaPercentage: ledgers.hissaPercentage,
      }).from(ledgers).where(inArray(ledgers.id, partyIds));
      const partyById = new Map(partyRows.map(p => [p.id, p]));

      const hissaLinkRows = await db.select({
        ledgerId: ledgerThirdPartyLinks.ledgerId,
        percent: ledgerThirdPartyLinks.percent,
      }).from(ledgerThirdPartyLinks).where(and(
        eq(ledgerThirdPartyLinks.linkType, 'HISSA'),
        inArray(ledgerThirdPartyLinks.ledgerId, partyIds),
      ));
      const hissaLinkFactorByParty = new Map<number, number>();
      for (const link of hissaLinkRows) {
        const pct = parseFloat(link.percent) || 0;
        const prev = hissaLinkFactorByParty.get(link.ledgerId) ?? 1;
        hissaLinkFactorByParty.set(link.ledgerId, prev * (1 - pct / 100));
      }

      const partyByTx = new Map(activeSlips.map(s => [s.id, s.partyId]));
      const slipIds = activeSlips.map(s => s.id);
      const entries = await db.select().from(transactionEntries).where(inArray(transactionEntries.transactionId, slipIds));

      for (const e of entries) {
        const partyId = partyByTx.get(e.transactionId);
        const party = partyId !== undefined ? partyById.get(partyId) : undefined;
        const commPct = party ? parseFloat(party.commissionRate) || 0 : 0;
        const hissaPct = party ? parseFloat(party.hissaPercentage) || 0 : 0;
        const linkFactor = partyId !== undefined ? (hissaLinkFactorByParty.get(partyId) ?? 1) : 1;

        const amt = parseFloat(e.amount) * (1 - commPct / 100) * (1 - hissaPct / 100) * linkFactor;
        totalCollected += amt;
        const key = e.entryType === 'HARUF_ANDAR'
          ? `A_${e.numberValue}`
          : e.entryType === 'HARUF_BAHAR'
          ? `B_${e.numberValue}`
          : e.numberValue;
        hash[key] = (hash[key] || 0) + amt;
      }
    }

    const grid: JantriCell[] = [];
    let maxLiability = 0;
    for (let i = 0; i < 100; i++) {
      const numStr = i.toString().padStart(2, '0');
      const amount = hash[numStr] || 0;
      const liability = amount * 90;
      if (liability > maxLiability) maxLiability = liability;
      grid.push({ number: numStr, totalAmount: amount, liability, isMaxRisk: false });
    }
    if (maxLiability > 0) {
      for (const cell of grid) {
        if (cell.liability === maxLiability) cell.isMaxRisk = true;
      }
    }

    const haruf: HarufCell[] = [];
    for (let d = 0; d < 10; d++) {
      const dStr = d.toString();
      haruf.push({
        digit: dStr,
        andarAmount: hash[`A_${dStr}`] || 0,
        baharAmount: hash[`B_${dStr}`] || 0,
      });
    }

    return {
      shiftId: shift.id,
      shiftName: shift.name,
      shiftDate: targetDate,
      totalCollected,
      totalRisk: maxLiability,
      grid,
      haruf,
    };
  }

  private static async rebuildJantriFromSql(shiftId: number, openDate: string): Promise<Record<string, string>> {
    const hash: Record<string, string> = {};
    let totalCollected = 0;

    // Scoped to the current cycle (openDate) — shift rows are reused day-to-day by the
    // rollover worker, so an unscoped query here would pull in every past cycle's slips too.
    const activeSlips = await db.select().from(transactions).where(
      and(
        eq(transactions.shiftId, shiftId),
        eq(transactions.status, 'ACTIVE'),
        dsql`${transactions.createdAt}::date = ${openDate}::date`
      )
    );

    const slipIds = activeSlips.map(s => s.id);
    if (slipIds.length > 0) {
      const entries = await db.select().from(transactionEntries).where(
        inArray(transactionEntries.transactionId, slipIds)
      );

      for (const e of entries) {
        const amt = parseFloat(e.amount);
        totalCollected += amt;
        const key = e.entryType === 'HARUF_ANDAR'
          ? `A_${e.numberValue}`
          : e.entryType === 'HARUF_BAHAR'
          ? `B_${e.numberValue}`
          : e.numberValue;

        const cur = parseFloat(hash[key] || '0');
        hash[key] = (cur + amt).toString();
      }
    }

    hash['TOTAL_COLLECTED'] = totalCollected.toString();

    try {
      const jantriKey = `jantri:${shiftId}:${openDate}`;
      if (Object.keys(hash).length > 0) {
        await redis.hset(jantriKey, hash);
      }
    } catch {}

    return hash;
  }


  // Powers Live/Declare Prediction.
  //
  // Scoped to ONE cycle (targetDate) like every other per-shift aggregate in this service —
  // shift rows are reused day-to-day by the rollover worker, so the previously unscoped query
  // here piled every past cycle's slips onto the preview (a freshly added shift such as
  // "NEW SHIFT" is the clearest case: its very first cycle must start from an empty book).
  //
  // "Amt" (per-number) and "P & L" (per-party) are NET figures, using the same per-party
  // Commission x own-Hissa x HP-linked-Hissa factor already confirmed exactly against live
  // data for the Dashboard's "Commission/Hissa/Kat" column and reused by getNetJantriView /
  // DeclarationService's netCollection. Confirmed again against the live Prediction page
  // (PUNJAB DAY 22-09-2026, single party OM HYDRABAD, gross sale 300 @ 90/10-9/10, stakes
  // 35->200, 25->50, 70->50):
  //   * any number with no stake ..... 300 * (1-0.10 comm) * 0.40 share            = 108
  //   * number 25 / 70 (50 staked) ... (270 - 50*90)  * 0.40 share                 = -1692
  //   * number 35 (200 staked) ....... (270 - 200*90) * 0.40 share                 = -7092
  // i.e. commission discounts the SALE only, while the hissa/HP share factor applies to the
  // whole book (sale net of commission, minus payout). The winner's payout itself is never
  // reduced by commission — it is owed at the agreed stake x rate, the same rule already
  // applied in DeclarationService.declareResult.
  static async getPredictionData(shiftId: number, focusNumber?: string, date?: string) {
    const [shift] = await db.select().from(shifts).where(eq(shifts.id, shiftId));
    if (!shift) throw new NotFoundError('Shift not found');

    const targetDate = date || shift.openDate;

    const activeSlips = await db.select().from(transactions).where(
      and(
        eq(transactions.shiftId, shiftId),
        eq(transactions.status, 'ACTIVE'),
        dsql`${transactions.createdAt}::date = ${targetDate}::date`
      )
    );
    const slipIds = activeSlips.map(s => s.id);
    const partyByTx = new Map(activeSlips.map(s => [s.id, s.partyId]));

    const entries = slipIds.length > 0
      ? await db.select().from(transactionEntries).where(inArray(transactionEntries.transactionId, slipIds))
      : [];

    // --- Per-party ledger config: commission (sale-side only) and the share factor ---------
    const partyIds = Array.from(new Set(activeSlips.map(s => s.partyId)));
    const partyRows = partyIds.length > 0
      ? await db.select({
          id: ledgers.id,
          partyName: ledgers.partyName,
          agentId: ledgers.agentId,
          commissionRate: ledgers.commissionRate,
          hissaPercentage: ledgers.hissaPercentage,
        }).from(ledgers).where(inArray(ledgers.id, partyIds))
      : [];
    const partyById = new Map(partyRows.map(p => [p.id, p]));

    const hissaLinkRows = partyIds.length > 0
      ? await db.select({
          ledgerId: ledgerThirdPartyLinks.ledgerId,
          percent: ledgerThirdPartyLinks.percent,
        }).from(ledgerThirdPartyLinks).where(and(
          eq(ledgerThirdPartyLinks.linkType, 'HISSA'),
          inArray(ledgerThirdPartyLinks.ledgerId, partyIds),
        ))
      : [];
    const hissaLinkFactorByParty = new Map<number, number>();
    for (const link of hissaLinkRows) {
      const pct = parseFloat(link.percent) || 0;
      const prev = hissaLinkFactorByParty.get(link.ledgerId) ?? 1;
      hissaLinkFactorByParty.set(link.ledgerId, prev * (1 - pct / 100));
    }

    const commFactorOf = (partyId: number) => {
      const p = partyById.get(partyId);
      return 1 - ((p ? parseFloat(p.commissionRate) : 0) || 0) / 100;
    };
    const shareFactorOf = (partyId: number) => {
      const p = partyById.get(partyId);
      const hissaPct = (p ? parseFloat(p.hissaPercentage) : 0) || 0;
      return (1 - hissaPct / 100) * (hissaLinkFactorByParty.get(partyId) ?? 1);
    };

    // --- Sale side -------------------------------------------------------------------------
    const grossSaleByParty = new Map<number, number>();
    for (const slip of activeSlips) {
      grossSaleByParty.set(slip.partyId, (grossSaleByParty.get(slip.partyId) || 0) + parseFloat(slip.totalAmount));
    }

    let totalCollected = 0;   // raw gross — matches the Dashboard card's big number
    let netSaleWeighted = 0;  // sum of netSale x shareFactor — the "Amt" of any unbet number
    for (const [partyId, gross] of grossSaleByParty) {
      totalCollected += gross;
      netSaleWeighted += gross * commFactorOf(partyId) * shareFactorOf(partyId);
    }

    // --- Payout side, per candidate number 00-99 -------------------------------------------
    // saleByNumber/payoutByNumber are RAW (what the "Sale" column shows); payoutWeighted is
    // the same payout with each party's own share factor applied, which is what "Amt" needs.
    // A HARUF_ANDAR stake on digit d wins on all ten numbers d0..d9 and a HARUF_BAHAR stake
    // wins on 0d..9d, so both fan out here — the live sample had DARA stakes only, but this
    // keeps the "Sale"/"Amt" pair on a row consistent with the payout that actually drives it
    // and with the winner-matching rule in DeclarationService.declareResult.
    const saleByNumber = new Array<number>(100).fill(0);
    const payoutByNumber = new Array<number>(100).fill(0);
    const payoutWeighted = new Array<number>(100).fill(0);
    const entriesByParty = new Map<number, typeof entries>();

    for (const e of entries) {
      const partyId = partyByTx.get(e.transactionId);
      if (partyId === undefined) continue;
      if (!entriesByParty.has(partyId)) entriesByParty.set(partyId, []);
      entriesByParty.get(partyId)!.push(e);

      const amt = parseFloat(e.amount) || 0;
      const payout = amt * (parseFloat(e.rate) || 0);
      const weighted = payout * shareFactorOf(partyId);

      const apply = (idx: number) => {
        saleByNumber[idx] += amt;
        payoutByNumber[idx] += payout;
        payoutWeighted[idx] += weighted;
      };

      if (e.entryType === 'DARA') {
        const idx = parseInt(e.numberValue, 10);
        if (Number.isInteger(idx) && idx >= 0 && idx < 100) apply(idx);
      } else if (e.entryType === 'HARUF_ANDAR') {
        const d = parseInt(e.numberValue, 10);
        if (Number.isInteger(d) && d >= 0 && d < 10) for (let u = 0; u < 10; u++) apply(d * 10 + u);
      } else if (e.entryType === 'HARUF_BAHAR') {
        const d = parseInt(e.numberValue, 10);
        if (Number.isInteger(d) && d >= 0 && d < 10) for (let t = 0; t < 10; t++) apply(t * 10 + d);
      }
    }

    const numberPreview = Array.from({ length: 100 }, (_, i) => ({
      number: i.toString().padStart(2, '0'),
      sale: saleByNumber[i],
      liability: payoutByNumber[i],
      profitLoss: netSaleWeighted - payoutWeighted[i],
    }));

    // --- Party-wise Sale / P&L for the focused number --------------------------------------
    const focusPadded = focusNumber ? focusNumber.padStart(2, '0') : undefined;
    const focusTens = focusPadded ? focusPadded[0] : undefined;
    const focusUnits = focusPadded ? focusPadded[1] : undefined;

    const lastWinByParty = await this.getLastWinCounts(shiftId, partyIds);

    const partyRowsOut = Array.from(grossSaleByParty.entries()).map(([partyId, sale]) => {
      const party = partyById.get(partyId);

      let payout = 0;
      if (focusPadded) {
        for (const e of entriesByParty.get(partyId) || []) {
          const isWinner =
            (e.entryType === 'DARA' && e.numberValue === focusPadded) ||
            (e.entryType === 'HARUF_ANDAR' && e.numberValue === focusTens) ||
            (e.entryType === 'HARUF_BAHAR' && e.numberValue === focusUnits);
          if (isWinner) payout += (parseFloat(e.amount) || 0) * (parseFloat(e.rate) || 0);
        }
      }

      return {
        partyId,
        partyName: party?.partyName || 'UNKNOWN',
        agentId: party?.agentId ?? null,
        sale,
        pnl: (sale * commFactorOf(partyId) - payout) * shareFactorOf(partyId),
        lastWin: lastWinByParty.get(partyId) || 0,
      };
    }).sort((a, b) => b.sale - a.sale);

    // --- Agent Groups rollup of the same party rows ----------------------------------------
    const agentIds = Array.from(new Set(partyRowsOut.map(p => p.agentId).filter((id): id is number => id != null)));
    const agentRows = agentIds.length > 0
      ? await db.select({ id: agents.id, agentName: agents.agentName }).from(agents).where(inArray(agents.id, agentIds))
      : [];
    const agentNameById = new Map(agentRows.map(a => [a.id, a.agentName]));

    // Each group also carries the party ids it rolls up, so clicking it can pull that whole
    // group's collection grid straight from the shared endpoint.
    const agentGroupMap = new Map<string, { sale: number; partyIds: number[] }>();
    for (const p of partyRowsOut) {
      const name = p.agentId ? (agentNameById.get(p.agentId) || 'UNKNOWN') : 'UNASSIGNED';
      const bucket = agentGroupMap.get(name) || { sale: 0, partyIds: [] };
      bucket.sale += p.sale;
      bucket.partyIds.push(p.partyId);
      agentGroupMap.set(name, bucket);
    }
    const agentGroups = Array.from(agentGroupMap.entries())
      .map(([agentName, b]) => ({ agentName, sale: b.sale, partyIds: b.partyIds }))
      .sort((a, b) => b.sale - a.sale);

    return {
      shiftId: shift.id,
      shiftName: shift.name,
      shiftDate: targetDate,
      totalCollected,
      netCollected: netSaleWeighted,
      focusNumber: focusPadded || null,
      numberPreview,
      parties: partyRowsOut,
      agentGroups,
      isCycleDeclared: await this.isCycleDeclared(shift, targetDate),
    };
  }

  // Declared state of one shift + date cycle: the live cycle (the shift's own open_date) reads
  // the shift row, earlier dates read the shift's cycle history.
  private static async isCycleDeclared(
    shift: { id: number; openDate: string; status: string; declaredNumber: string | null },
    date: string
  ): Promise<boolean> {
    if (date === shift.openDate) {
      return !!shift.declaredNumber || shift.status === 'DECLARED' || shift.status === 'AUDITED';
    }
    const [cycle] = await db.select().from(shiftCycles).where(
      and(eq(shiftCycles.shiftId, shift.id), eq(shiftCycles.cycleDate, date))
    );
    return !!cycle && (cycle.status === 'DECLARED' || cycle.status === 'AUDITED');
  }

  // "Last-Win" badge on the Prediction party list: how many of this shift's 30 most recent
  // (non-reversed) declarations this party actually held a winning entry on — the same
  // 30-declaration window the "Result 30 Days" column on the left already uses. No live
  // reference formula exists for this badge, so it is best-effort — flagged here with the
  // same honest convention already used for TPC/HP-Amt/RBT and the Dashboard's "Last Day %".
  // Winner matching is identical to DeclarationService.declareResult (DARA on the full
  // number, HARUF_ANDAR on the tens digit, HARUF_BAHAR on the units digit), and each past
  // cycle's slips are matched by that declaration's own date because shift rows are reused
  // day-to-day — by the cycle date each declaration belongs to (see the query below).
  private static async getLastWinCounts(shiftId: number, partyIds: number[]): Promise<Map<number, number>> {
    const out = new Map<number, number>();
    if (partyIds.length === 0) return out;

    try {
      const rows = await pgSql<Array<{ party_id: number; wins: number }>>`
        -- Each declaration is matched to the CYCLE it declared, not the day it was declared
        -- on: a result declared after midnight (HYDRABAD NIGHT 23-09 declared 02 on 24-09)
        -- used to be compared with the next day's slips, so its winners never counted. The
        -- cycle date comes from the shift's cycle history (latest declared cycle with that
        -- number, on or before the declaration day), falling back to the declaration day.
        WITH recent AS (
          SELECT d.id, lpad(d.winning_number, 2, '0') AS num,
            COALESCE((
              SELECT c.cycle_date FROM shift_cycles c
              WHERE c.shift_id = d.shift_id AND c.status IN ('DECLARED', 'AUDITED')
                AND lpad(c.declared_number, 2, '0') = lpad(d.winning_number, 2, '0')
                AND c.cycle_date <= to_char(d.declared_at, 'YYYY-MM-DD')
              ORDER BY c.cycle_date DESC
              LIMIT 1
            ), to_char(d.declared_at, 'YYYY-MM-DD')) AS cycle_date
          FROM declarations d
          WHERE d.shift_id = ${shiftId} AND d.is_reversed = false
          ORDER BY d.declared_at DESC
          LIMIT 30
        )
        SELECT t.party_id AS party_id, COUNT(DISTINCT r.id)::int AS wins
        FROM recent r
        JOIN transactions t
          ON t.shift_id = ${shiftId}
         AND t.status = 'ACTIVE'
         -- A slip's cycle date is the shift open_date stamped into its slip number
         -- (SLIP-YYYYMMDD-...), falling back to the day it was created.
         AND (CASE WHEN t.slip_number ~ '^SLIP-[0-9]{8}-'
                   THEN to_char(to_date(substr(t.slip_number, 6, 8), 'YYYYMMDD'), 'YYYY-MM-DD')
                   ELSE to_char(t.created_at, 'YYYY-MM-DD') END) = r.cycle_date
        JOIN transaction_entries te ON te.transaction_id = t.id
        WHERE t.party_id = ANY(${partyIds})
          AND (
            (te.entry_type = 'DARA' AND te.number_value = r.num)
            OR (te.entry_type = 'HARUF_ANDAR' AND te.number_value = substr(r.num, 1, 1))
            OR (te.entry_type = 'HARUF_BAHAR' AND te.number_value = substr(r.num, 2, 1))
          )
        GROUP BY t.party_id
      `;
      for (const r of rows) out.set(r.party_id, r.wins);
    } catch (err) {
      // Never let one optional badge take the whole panel down — the rest of the prediction
      // payload is what the page is actually for.
      console.warn('[Prediction] Last-Win lookup failed:', err);
    }

    return out;
  }
}
