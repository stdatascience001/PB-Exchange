import { db, shifts, transactions, transactionEntries, declarations, vouchers, voucherEntries, auditLogs, shiftCycles, ledgers, ledgerThirdPartyLinks } from '@pb/database';
import { eq, and, inArray, desc, sql } from 'drizzle-orm';
import { AppError, NotFoundError, ForbiddenError } from '../../common/errors.js';
import { publishDashboardUpdate } from '../dashboard/dashboard.events.js';
import { publishShiftsUpdate } from '../shifts/shift.events.js';
import { ShiftService } from '../shifts/shift.service.js';
import { DeclarationSnapshotService } from './declaration-snapshot.service.js';
import { UserSession } from '@pb/types';
import crypto from 'crypto';

export class DeclarationService {
  static async declareResult(shiftId: number, winningNumber: string, user: UserSession) {
    if (user.roleName !== 'DEVELOPER' && user.roleName !== 'SUPER ADMIN' && user.roleName !== 'ADMIN') {
      throw new ForbiddenError('Only Super Admin or Admin can declare results');
    }

    const [shift] = await db.select().from(shifts).where(eq(shifts.id, shiftId));
    if (!shift) throw new NotFoundError('Shift not found');

    if (shift.status === 'DECLARED') {
      throw new AppError(`Shift ${shift.name} has already been declared`, 400);
    }

    const paddedWinning = winningNumber.padStart(2, '0');

    const result = await db.transaction(async (tx) => {
      const activeSlips = await tx.select().from(transactions).where(
        and(eq(transactions.shiftId, shift.id), eq(transactions.status, 'ACTIVE'))
      );

      let totalCollected = 0;
      for (const slip of activeSlips) {
        totalCollected += parseFloat(slip.totalAmount);
      }

      const slipIds = activeSlips.map(s => s.id);
      let totalPayout = 0;
      const winningEntries: any[] = [];

      if (slipIds.length > 0) {
        const allEntries = await tx.select().from(transactionEntries).where(
          inArray(transactionEntries.transactionId, slipIds)
        );

        const tensDigit = paddedWinning[0];
        const unitsDigit = paddedWinning[1];

        for (const entry of allEntries) {
          let isWinner = false;
          if (entry.entryType === 'DARA' && entry.numberValue === paddedWinning) {
            isWinner = true;
          } else if (entry.entryType === 'HARUF_ANDAR' && entry.numberValue === tensDigit) {
            isWinner = true;
          } else if (entry.entryType === 'HARUF_BAHAR' && entry.numberValue === unitsDigit) {
            isWinner = true;
          }

          if (isWinner) {
            const payout = parseFloat(entry.amount) * parseFloat(entry.rate);
            totalPayout += payout;
            winningEntries.push({ ...entry, payout });
          }
        }
      }

      const netProfitLoss = totalCollected - totalPayout;

      // Net Collection (after Commission/Hissa/Kat) — a display-only figure alongside the real
      // settlement numbers above. Uses the same per-party Commission x own-Hissa x HP-linked-
      // Hissa formula already confirmed exactly against two live data points (Dashboard's
      // "Commission/Hissa/Kat": party "MADAN DELHI 50%", 16000 -> 7200 == 16000*(1-0.10)*(1-0.50);
      // party "MM SHIVAAY UP", 490 -> 225 == 490*(1-0.10)*(1-0.40 own hissa)*(1-0.15 HP-linked
      // hissa)). It does NOT feed into totalPayout, netProfitLoss, the voucher amount, or
      // anything persisted below — those stay exactly as they were, since a winner's payout is
      // owed at their agreed stake x rate regardless of the agent's own commission/hissa cut.
      let netCollection = 0;
      if (activeSlips.length > 0) {
        const partyIds = Array.from(new Set(activeSlips.map(s => s.partyId)));
        const partyRows = await tx.select({
          id: ledgers.id,
          commissionRate: ledgers.commissionRate,
          hissaPercentage: ledgers.hissaPercentage,
        }).from(ledgers).where(inArray(ledgers.id, partyIds));
        const partyById = new Map(partyRows.map(p => [p.id, p]));

        const hissaLinkRows = await tx.select({
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

        for (const slip of activeSlips) {
          const party = partyById.get(slip.partyId);
          const commPct = party ? parseFloat(party.commissionRate) || 0 : 0;
          const hissaPct = party ? parseFloat(party.hissaPercentage) || 0 : 0;
          const linkFactor = hissaLinkFactorByParty.get(slip.partyId) ?? 1;
          netCollection += parseFloat(slip.totalAmount) * (1 - commPct / 100) * (1 - hissaPct / 100) * linkFactor;
        }
      }

      const [decl] = await tx.insert(declarations).values({
        shiftId: shift.id,
        winningNumber: paddedWinning,
        totalCollected: totalCollected.toFixed(2),
        totalPayout: totalPayout.toFixed(2),
        netProfitLoss: netProfitLoss.toFixed(2),
        declaredBy: user.userId,
      }).returning();

      await tx.update(shifts)
        .set({ status: 'DECLARED', declaredNumber: paddedWinning })
        .where(eq(shifts.id, shift.id));

      // Keep the per-day history in sync so this cycle stops showing as "Declare Needed"
      // even after the daily rollover worker later moves the live shift row to a new date.
      const [existingCycle] = await tx.select().from(shiftCycles).where(
        and(eq(shiftCycles.shiftId, shift.id), eq(shiftCycles.cycleDate, shift.openDate))
      );
      if (existingCycle) {
        await tx.update(shiftCycles).set({
          status: 'DECLARED',
          declaredNumber: paddedWinning,
          totalCollected: totalCollected.toFixed(2),
          totalPayout: totalPayout.toFixed(2),
          updatedAt: new Date(),
        }).where(eq(shiftCycles.id, existingCycle.id));
      } else {
        await tx.insert(shiftCycles).values({
          shiftId: shift.id,
          cycleDate: shift.openDate,
          status: 'DECLARED',
          declaredNumber: paddedWinning,
          totalCollected: totalCollected.toFixed(2),
          totalPayout: totalPayout.toFixed(2),
        });
      }

      const voucherNum = `VOUCH-DEC-${shift.id}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const [voucher] = await tx.insert(vouchers).values({
        voucherNumber: voucherNum,
        voucherType: 'WINNING_PAYOUT',
        shiftId: shift.id,
        totalAmount: totalPayout.toFixed(2),
        narration: `Payout settlement for shift ${shift.name} winning number ${paddedWinning}`,
        createdBy: user.userId,
      }).returning();

      await tx.insert(auditLogs).values({
        actorId: user.userId,
        action: 'DECLARE',
        entityType: 'SHIFT',
        entityId: shift.id.toString(),
        afterData: {
          winningNumber: paddedWinning,
          totalCollected,
          totalPayout,
          netProfitLoss,
          winningCount: winningEntries.length,
        },
      });

      return {
        declarationId: decl.id,
        shiftId: shift.id,
        shiftName: shift.name,
        winningNumber: paddedWinning,
        totalCollected,
        totalPayout,
        netProfitLoss,
        netCollection,
        winningEntriesCount: winningEntries.length,
        voucherNumber: voucher.voucherNumber,
      };
    });

    // Per-party Sale / P&L this declare was made on — the Dashboard's ReDeclare popup compares
    // against it. Never throws (see captureOnDeclare).
    await DeclarationSnapshotService.captureOnDeclare(result.declarationId, shift.id, shift.openDate, paddedWinning);

    publishDashboardUpdate(shift.id);
    publishShiftsUpdate();
    ShiftService.invalidateListCache();

    return result;
  }

  // declarationId lets a caller (e.g. Live/Declare Prediction's UnDeclare button on a
  // historical row) target a specific past declaration instead of always "whichever is
  // currently active for this shift" — the original single-arg behavior is unchanged
  // when it's omitted.
  static async reverseDeclaration(shiftId: number, user: UserSession, declarationId?: number) {
    if (user.roleName !== 'DEVELOPER' && user.roleName !== 'SUPER ADMIN') {
      throw new ForbiddenError('Only Super Admin can reverse a declaration');
    }

    const [decl] = declarationId
      ? await db.select().from(declarations).where(
          and(eq(declarations.id, declarationId), eq(declarations.shiftId, shiftId), eq(declarations.isReversed, false))
        )
      : await db.select().from(declarations).where(
          and(eq(declarations.shiftId, shiftId), eq(declarations.isReversed, false))
        );
    if (!decl) throw new NotFoundError('Active declaration not found for this shift');

    const [shift] = await db.select().from(shifts).where(eq(shifts.id, shiftId));
    if (!shift) throw new NotFoundError('Shift not found');

    const declDateStr = decl.declaredAt.toISOString().slice(0, 10);
    // Only reset the LIVE shift row when reversing the declaration for its CURRENT cycle —
    // reversing an older, already-rolled-over cycle must not disturb today's live state.
    const isLiveCycle = declDateStr === shift.openDate;

    const result = await db.transaction(async (tx) => {
      await tx.update(declarations)
        .set({ isReversed: true, reversedBy: user.userId, reversedAt: new Date() })
        .where(eq(declarations.id, decl.id));

      if (isLiveCycle) {
        await tx.update(shifts)
          .set({ status: 'OPEN', declaredNumber: null })
          .where(eq(shifts.id, shiftId));
      }

      // Revert the matching cycle-history row too, so it doesn't stay stuck as DECLARED
      await tx.update(shiftCycles)
        .set({ status: 'OPEN', declaredNumber: null, updatedAt: new Date() })
        .where(and(eq(shiftCycles.shiftId, shiftId), eq(shiftCycles.cycleDate, declDateStr)));

      await tx.insert(auditLogs).values({
        actorId: user.userId,
        action: 'REVERSE_DECLARE',
        entityType: 'SHIFT',
        entityId: shiftId.toString(),
        beforeData: decl,
      });

      return { message: 'Declaration successfully reversed' };
    });

    publishDashboardUpdate(shiftId);
    publishShiftsUpdate();
    ShiftService.invalidateListCache();

    return result;
  }

  static async listDeclarationsSummary(filters: { fromDate?: string; toDate?: string; shiftId?: number; includeReversed?: boolean }) {
    const conditions = filters.includeReversed ? [] : [eq(declarations.isReversed, false)];
    if (filters.shiftId) conditions.push(eq(declarations.shiftId, filters.shiftId));
    if (filters.fromDate) conditions.push(sql`${declarations.declaredAt}::date >= ${filters.fromDate}::date`);
    if (filters.toDate) conditions.push(sql`${declarations.declaredAt}::date <= ${filters.toDate}::date`);

    const rows = await db.select({
      id: declarations.id,
      shiftId: declarations.shiftId,
      shiftName: shifts.name,
      winningNumber: declarations.winningNumber,
      totalCollected: declarations.totalCollected,
      totalPayout: declarations.totalPayout,
      netProfitLoss: declarations.netProfitLoss,
      declaredAt: declarations.declaredAt,
    })
      .from(declarations)
      .innerJoin(shifts, eq(declarations.shiftId, shifts.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(declarations.declaredAt));

    return rows.map(r => ({
      ...r,
      totalCollected: parseFloat(r.totalCollected),
      totalPayout: parseFloat(r.totalPayout),
      netProfitLoss: parseFloat(r.netProfitLoss),
      declaredAt: r.declaredAt.toISOString(),
    }));
  }

  // Read-only re-run of declareResult's winner-matching logic, for display — does not
  // mutate anything (unlike declareResult itself).
  static async getSettlementDetail(shiftId: number) {
    const [shift] = await db.select().from(shifts).where(eq(shifts.id, shiftId));
    if (!shift) throw new NotFoundError('Shift not found');
    if (!shift.declaredNumber) throw new AppError('Shift has not been declared yet', 400);

    const paddedWinning = shift.declaredNumber.padStart(2, '0');
    const activeSlips = await db.select().from(transactions).where(
      and(eq(transactions.shiftId, shift.id), eq(transactions.status, 'ACTIVE'))
    );
    const slipIds = activeSlips.map(s => s.id);

    const settlements: Array<{
      partyId: number;
      partyName: string;
      numberValue: string;
      amount: number;
      rate: number;
      payout: number;
    }> = [];

    if (slipIds.length > 0) {
      const allEntries = await db.select({
        entryType: transactionEntries.entryType,
        numberValue: transactionEntries.numberValue,
        amount: transactionEntries.amount,
        rate: transactionEntries.rate,
        partyId: transactions.partyId,
        partyName: ledgers.partyName,
      })
        .from(transactionEntries)
        .innerJoin(transactions, eq(transactionEntries.transactionId, transactions.id))
        .innerJoin(ledgers, eq(transactions.partyId, ledgers.id))
        .where(inArray(transactionEntries.transactionId, slipIds));

      const tensDigit = paddedWinning[0];
      const unitsDigit = paddedWinning[1];

      for (const entry of allEntries) {
        let isWinner = false;
        if (entry.entryType === 'DARA' && entry.numberValue === paddedWinning) isWinner = true;
        else if (entry.entryType === 'HARUF_ANDAR' && entry.numberValue === tensDigit) isWinner = true;
        else if (entry.entryType === 'HARUF_BAHAR' && entry.numberValue === unitsDigit) isWinner = true;

        if (isWinner) {
          const amount = parseFloat(entry.amount);
          const rate = parseFloat(entry.rate);
          settlements.push({
            partyId: entry.partyId,
            partyName: entry.partyName,
            numberValue: entry.numberValue,
            amount,
            rate,
            payout: amount * rate,
          });
        }
      }
    }

    return {
      shiftId: shift.id,
      shiftName: shift.name,
      winningNumber: paddedWinning,
      settlements,
      totalPayout: settlements.reduce((sum, s) => sum + s.payout, 0),
    };
  }

  static async verifyShift(shiftId: number, user: UserSession) {
    if (user.roleName !== 'DEVELOPER' && user.roleName !== 'SUPER ADMIN' && user.roleName !== 'ADMIN') {
      throw new ForbiddenError('Only Super Admin or Admin can verify shifts');
    }

    const [shift] = await db.select().from(shifts).where(eq(shifts.id, shiftId));
    if (!shift) throw new NotFoundError('Shift not found');

    return await db.transaction(async (tx) => {
      await tx.update(shifts)
        .set({ status: 'AUDITED', updatedAt: new Date() })
        .where(eq(shifts.id, shiftId));

      await tx.update(shiftCycles)
        .set({ status: 'AUDITED', updatedAt: new Date() })
        .where(and(eq(shiftCycles.shiftId, shiftId), eq(shiftCycles.cycleDate, shift.openDate)));

      await tx.insert(auditLogs).values({
        actorId: user.userId,
        action: 'AUDIT_VERIFY',
        entityType: 'SHIFT',
        entityId: shiftId.toString(),
        afterData: { status: 'AUDITED', shiftName: shift.name, declaredNumber: shift.declaredNumber },
      });

      return { shiftId, status: 'AUDITED', message: `Shift ${shift.name} successfully verified` };
    });
  }
}
