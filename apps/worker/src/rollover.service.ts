import { db, shifts, shiftCycles } from '@pb/database';
import { eq, and } from 'drizzle-orm';

function todayDateStr(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function ensureCycleExists(
  shiftId: number,
  cycleDate: string,
  status: string,
  declaredNumber: string | null
) {
  const [existing] = await db.select().from(shiftCycles).where(
    and(eq(shiftCycles.shiftId, shiftId), eq(shiftCycles.cycleDate, cycleDate))
  );
  if (existing) return existing;

  const [created] = await db.insert(shiftCycles).values({
    shiftId,
    cycleDate,
    status,
    declaredNumber,
  }).returning();
  return created;
}

function currentTimeStr(): string {
  return new Date().toTimeString().slice(0, 8);
}

// Next Day shifts (e.g. DESHAWER: opens ~21:00, closes ~05:00 the following morning) are still
// genuinely mid-cycle right after midnight — rolling their open_date forward at the same 00:05
// mark as normal shifts would cut them off before they actually close. They get a separate,
// later rollover pass instead (see index.ts), gated here by `nextDayThreshold` so an off-schedule
// call (e.g. the resilience run on worker startup) can't roll one over too early either.
export async function runDailyRollover(includeNextDay: boolean, nextDayThreshold?: string): Promise<void> {
  const today = todayDateStr();
  const activeShifts = await db.select().from(shifts).where(
    and(eq(shifts.isActive, true), eq(shifts.isNextDay, includeNextDay))
  );

  if (includeNextDay && nextDayThreshold && currentTimeStr() < nextDayThreshold) {
    return; // too early — these shifts may still be in their live overnight cycle
  }

  for (const shift of activeShifts) {
    if (shift.openDate === today) {
      continue; // already rolled for today
    }

    // A shift whose result hasn't been declared yet stays on its current open_date (and status)
    // — its cycle isn't over, so rolling it forward would strand the undeclared cycle and move
    // new entries onto a fresh date. It rolls on the first pass after its result is declared.
    if (shift.status !== 'DECLARED' && shift.status !== 'AUDITED') {
      continue;
    }

    // Finalize the outgoing cycle so its declare-status isn't lost (retrofit-safe: inserts only if missing)
    await ensureCycleExists(shift.id, shift.openDate, shift.status, shift.declaredNumber);

    // Roll the live shift row forward to a fresh cycle for today
    await db.update(shifts).set({
      openDate: today,
      status: 'OPEN',
      declaredNumber: null,
      updatedAt: new Date(),
    }).where(eq(shifts.id, shift.id));

    // Open today's cycle row
    await ensureCycleExists(shift.id, today, 'OPEN', null);

    console.log(`[Worker] Rolled shift "${shift.name}" (id=${shift.id}) from ${shift.openDate} to ${today}`);
  }
}
