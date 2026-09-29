import { db, vouchers, voucherEntries, ledgers, kistPlans, kistSchedule } from '@pb/database';
import { eq, and, asc, lte, isNull, inArray } from 'drizzle-orm';
import { AppError, NotFoundError } from '../../common/errors.js';
import { UserSession } from '@pb/types';
import crypto from 'crypto';

export type KistType = 'DAILY' | 'WEEKLY' | 'MONTHLY';
const KIST_TYPES: KistType[] = ['DAILY', 'WEEKLY', 'MONTHLY'];

// The balancing ledger every posted kist is booked against (live list's "Opposite" column).
const KIST_LEDGER_NAME = 'KIST A/C';

// Guard against a typo (e.g. One Kist Amount 1 on a 1,00,000 credit) producing a runaway
// schedule of tens of thousands of rows.
const MAX_KISTS = 1000;

const pad = (n: number) => String(n).padStart(2, '0');

const localDateStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Due date of installment `index` (0-based) — plain calendar math on the YYYY-MM-DD string so
// the server's timezone can't shift a date. MONTHLY keeps the start day, clamped to the month's
// last day (31 Jan → 28/29 Feb → 31 Mar).
export function kistDueDate(startDate: string, kistType: KistType, index: number): string {
  const [y, m, d] = startDate.split('-').map(Number);
  if (kistType === 'MONTHLY') {
    const monthIndex = (m - 1) + index;
    const year = y + Math.floor(monthIndex / 12);
    const month = monthIndex % 12;
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return `${year}-${pad(month + 1)}-${pad(Math.min(d, lastDay))}`;
  }
  const step = kistType === 'WEEKLY' ? 7 : 1;
  const dt = new Date(Date.UTC(y, m - 1, d + index * step));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

// Credit split into One-Kist-sized installments; the last one carries the remainder
// (20,000 @ 5,000 → 4 × 5,000; 12,000 @ 5,000 → 5,000 + 5,000 + 2,000).
export function splitKists(creditAmount: number, oneKistAmount: number): number[] {
  const creditPaise = Math.round(creditAmount * 100);
  const kistPaise = Math.round(oneKistAmount * 100);
  const count = Math.ceil(creditPaise / kistPaise);
  const amounts: number[] = [];
  for (let i = 0; i < count; i++) {
    const remaining = creditPaise - kistPaise * i;
    amounts.push(Math.min(kistPaise, remaining) / 100);
  }
  return amounts;
}

export class KistService {
  static async createPlan(data: {
    partyLedgerId: number;
    creditAmount: number;
    oneKistAmount: number;
    kistType: string;
    startDate: string;
    remark?: string;
  }, user: UserSession) {
    const partyLedgerId = Number(data.partyLedgerId);
    const creditAmount = Number(data.creditAmount);
    const oneKistAmount = Number(data.oneKistAmount);
    const kistType = String(data.kistType || '').toUpperCase() as KistType;
    const startDate = String(data.startDate || '');

    if (!partyLedgerId) throw new AppError('Please select Party Name from the list!');
    if (!(creditAmount > 0)) throw new AppError('Please enter Credit Amount!');
    if (!(oneKistAmount > 0)) throw new AppError('Please enter One Kist Amount!');
    if (oneKistAmount > creditAmount) throw new AppError('One Kist Amount cannot be more than Credit Amount!');
    if (!KIST_TYPES.includes(kistType)) throw new AppError('Please select a valid Kist Type!');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new AppError('Please enter Kist Start Date!');

    const [party] = await db.select({ id: ledgers.id }).from(ledgers)
      .where(and(eq(ledgers.id, partyLedgerId), isNull(ledgers.deletedAt)));
    if (!party) throw new NotFoundError('Party not found');

    const amounts = splitKists(creditAmount, oneKistAmount);
    if (amounts.length > MAX_KISTS) {
      throw new AppError(`This makes ${amounts.length} kists — the limit is ${MAX_KISTS}. Please increase One Kist Amount.`);
    }

    return await db.transaction(async (tx) => {
      const [plan] = await tx.insert(kistPlans).values({
        partyLedgerId,
        creditAmount: creditAmount.toFixed(2),
        oneKistAmount: oneKistAmount.toFixed(2),
        kistType,
        startDate,
        remark: data.remark?.trim() || null,
        createdBy: user.userId,
        updatedBy: user.username || 'SYSTEM',
      }).returning();

      await tx.insert(kistSchedule).values(amounts.map((amt, i) => ({
        planId: plan.id,
        partyLedgerId,
        kistNo: i + 1,
        kistDate: kistDueDate(startDate, kistType, i),
        amount: amt.toFixed(2),
      })));

      return { ...plan, kistCount: amounts.length };
    });
  }

  // Right-hand "Party" panel: every installment of every plan this party has, oldest first.
  static async listSchedule(partyLedgerId: number) {
    const rows = await db.select({
      id: kistSchedule.id,
      planId: kistSchedule.planId,
      kistNo: kistSchedule.kistNo,
      kistDate: kistSchedule.kistDate,
      amount: kistSchedule.amount,
      status: kistSchedule.status,
      voucherId: kistSchedule.voucherId,
      kistType: kistPlans.kistType,
    })
      .from(kistSchedule)
      .innerJoin(kistPlans, eq(kistSchedule.planId, kistPlans.id))
      .where(eq(kistSchedule.partyLedgerId, partyLedgerId))
      .orderBy(asc(kistSchedule.kistDate), asc(kistSchedule.planId), asc(kistSchedule.kistNo));

    return rows.map(r => ({ ...r, amount: parseFloat(r.amount) }));
  }

  private static async getOrCreateKistLedger(): Promise<number> {
    const [existing] = await db.select({ id: ledgers.id }).from(ledgers).where(eq(ledgers.partyName, KIST_LEDGER_NAME));
    if (existing) return existing.id;
    await db.insert(ledgers).values({ partyName: KIST_LEDGER_NAME }).onConflictDoNothing();
    const [created] = await db.select({ id: ledgers.id }).from(ledgers).where(eq(ledgers.partyName, KIST_LEDGER_NAME));
    return created.id;
  }

  // Auto Kist Voucher popup's Search: the PENDING installments falling due on that date.
  static async listDue(date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AppError('Please select a valid Date!');
    const rows = await db.select({
      id: kistSchedule.id,
      partyLedgerId: kistSchedule.partyLedgerId,
      partyName: ledgers.partyName,
      kistNo: kistSchedule.kistNo,
      kistDate: kistSchedule.kistDate,
      amount: kistSchedule.amount,
      kistType: kistPlans.kistType,
    })
      .from(kistSchedule)
      .innerJoin(kistPlans, eq(kistSchedule.planId, kistPlans.id))
      .innerJoin(ledgers, eq(kistSchedule.partyLedgerId, ledgers.id))
      .where(and(eq(kistSchedule.status, 'PENDING'), eq(kistSchedule.kistDate, date)))
      .orderBy(asc(ledgers.partyName), asc(kistSchedule.id));
    return rows.map(r => ({ ...r, amount: parseFloat(r.amount) }));
  }

  // Posts PENDING installments as KIST vouchers (Party Dr / KIST A/C Cr, dated on the kist's
  // due date) and marks them DONE.
  //   - scheduleIds given (Auto Kist Voucher popup's Process Voucher): exactly the ticked
  //     kists, whatever their date — each must still be PENDING.
  //   - none given: every PENDING kist due today or earlier.
  // Each installment is claimed (PENDING → DONE) in the same DB transaction that writes its
  // voucher, so a double click or two users processing together never posts a kist twice.
  static async runAutoKist(user: UserSession, scheduleIds?: number[]) {
    const ids = Array.isArray(scheduleIds)
      ? scheduleIds.map(Number).filter(n => Number.isInteger(n) && n > 0)
      : undefined;
    if (ids && ids.length === 0) throw new AppError('Please tick at least one kist!');
    const today = localDateStr();
    const due = await db.select({
      id: kistSchedule.id,
      partyLedgerId: kistSchedule.partyLedgerId,
      kistNo: kistSchedule.kistNo,
      kistDate: kistSchedule.kistDate,
      amount: kistSchedule.amount,
      remark: kistPlans.remark,
      kistType: kistPlans.kistType,
    })
      .from(kistSchedule)
      .innerJoin(kistPlans, eq(kistSchedule.planId, kistPlans.id))
      .where(and(
        eq(kistSchedule.status, 'PENDING'),
        ids ? inArray(kistSchedule.id, ids) : lte(kistSchedule.kistDate, today)
      ))
      .orderBy(asc(kistSchedule.kistDate), asc(kistSchedule.id));

    if (due.length === 0) return { posted: 0, totalAmount: 0 };

    const kistLedgerId = await this.getOrCreateKistLedger();
    let posted = 0;
    let totalAmount = 0;

    for (const k of due) {
      const didPost = await db.transaction(async (tx) => {
        const [claimed] = await tx.update(kistSchedule)
          .set({ status: 'DONE', updatedAt: new Date() })
          .where(and(eq(kistSchedule.id, k.id), eq(kistSchedule.status, 'PENDING')))
          .returning({ id: kistSchedule.id });
        if (!claimed) return false;

        const [voucher] = await tx.insert(vouchers).values({
          voucherNumber: `VOUCH-KIST-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
          voucherType: 'KIST',
          totalAmount: k.amount,
          narration: k.remark || `${k.kistType} KIST ${k.kistNo}`,
          createdBy: user.userId,
          updatedBy: user.username || 'SYSTEM',
          // Anchored at noon, same as manual vouchers, so the date never slips a day.
          createdAt: new Date(`${k.kistDate}T12:00:00`),
        }).returning();

        await tx.insert(voucherEntries).values([
          { voucherId: voucher.id, ledgerId: k.partyLedgerId, entrySide: 'DR', amount: k.amount },
          { voucherId: voucher.id, ledgerId: kistLedgerId, entrySide: 'CR', amount: k.amount },
        ]);

        await tx.update(kistSchedule).set({ voucherId: voucher.id }).where(eq(kistSchedule.id, k.id));
        return true;
      });

      if (didPost) {
        posted++;
        totalAmount += parseFloat(k.amount);
      }
    }

    return { posted, totalAmount };
  }
}
