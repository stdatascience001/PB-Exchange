import dotenv from 'dotenv';
dotenv.config();

import { scheduleDaily, msUntilNextRun } from './scheduler.js';
import { runDailyRollover } from './rollover.service.js';

const [hourStr, minuteStr] = (process.env.ROLLOVER_TIME || '00:05').split(':');
const hour = parseInt(hourStr, 10);
const minute = parseInt(minuteStr, 10);

// Next Day (overnight) shifts — e.g. DESHAWER, open ~21:00 to ~05:00 the next morning — must
// NOT roll over at the same 00:05 mark as normal shifts, since they're still genuinely live
// right after midnight. They get their own later rollover time instead.
const [nextDayHourStr, nextDayMinuteStr] = (process.env.NEXT_DAY_ROLLOVER_TIME || '06:00').split(':');
const nextDayHour = parseInt(nextDayHourStr, 10);
const nextDayMinute = parseInt(nextDayMinuteStr, 10);
const nextDayThreshold = `${String(nextDayHour).padStart(2, '0')}:${String(nextDayMinute).padStart(2, '0')}:00`;

console.log('===============================================');
console.log(' PB EXCHANGE SHIFT ROLLOVER WORKER STARTED       ');
console.log(` Normal shifts scheduled daily at:   ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} (server local time) `);
console.log(` Next-Day shifts scheduled daily at: ${String(nextDayHour).padStart(2, '0')}:${String(nextDayMinute).padStart(2, '0')} (server local time) `);
console.log(` Next normal run in: ${Math.round(msUntilNextRun(hour, minute) / 60000)} minutes `);
console.log(` Next Next-Day run in: ${Math.round(msUntilNextRun(nextDayHour, nextDayMinute) / 60000)} minutes `);
console.log('===============================================');

// Also run once immediately on startup (not just at the scheduled time) — if the worker
// was down (or never started) when the scheduled time passed, any shift whose open_date
// fell behind today would otherwise stay stuck until the next scheduled run, which is
// exactly what caused shift cards to show stale dates/zero amounts on the dashboard.
// The Next-Day pass still respects nextDayThreshold, so a startup mid-cycle (e.g. 2 AM)
// can't roll one of those shifts over early just because the worker happened to restart.
runDailyRollover(false).catch((err) => console.error('[Worker] Startup rollover check (normal) failed:', err));
runDailyRollover(true, nextDayThreshold).catch((err) => console.error('[Worker] Startup rollover check (next-day) failed:', err));

scheduleDaily(hour, minute, () => runDailyRollover(false));
scheduleDaily(nextDayHour, nextDayMinute, () => runDailyRollover(true, nextDayThreshold));

// Undeclared shifts are skipped by the rollover (they keep their open_date until their result
// is declared), so a shift declared AFTER its scheduled rollover time — e.g. HYDRABAD NIGHT
// declared at 00:30 — would otherwise wait a whole extra day and skip that date's cycle.
// This periodic catch-up rolls it on the next check instead. Normal shifts are only checked
// once the day's ROLLOVER_TIME has passed, and the Next-Day pass keeps its own threshold, so
// neither can roll earlier than its scheduled time.
const normalThreshold = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
const catchUpIntervalMs = (parseInt(process.env.ROLLOVER_CHECK_INTERVAL_SECONDS || '60', 10) || 60) * 1000;
let catchUpRunning = false;
setInterval(async () => {
  if (catchUpRunning) return;
  catchUpRunning = true;
  try {
    if (new Date().toTimeString().slice(0, 8) >= normalThreshold) {
      await runDailyRollover(false);
    }
    await runDailyRollover(true, nextDayThreshold);
  } catch (err) {
    console.error('[Worker] Catch-up rollover check failed:', err);
  } finally {
    catchUpRunning = false;
  }
}, catchUpIntervalMs);

process.on('SIGTERM', () => {
  console.log('[Worker] SIGTERM received, shutting down');
  process.exit(0);
});
