import { sql as pgSql } from '@pb/database';

// Automatic Party Account Lock (Ledgers page → Locked).
//
// Every day at 5:00 AM (business time, Asia/Kolkata unless AUTO_LOCK_TZ says otherwise) every
// party (ledger, not deleted, not already locked) with no shift entry in the last 14 days is
// locked — the same lock as the Locked button (new entries refused; nothing else changes).
//   - "Entry" = a slip (transaction) of any shift for the party, not deleted.
//   - A party created less than 14 days ago is left alone until it has had 14 days.
//   - Unlocked by hand (Locked button → NO): the party gets 15 days from the unlock; with still no
//     entry by then, it is locked again.
// The check runs once a day across all API processes (a claim row in app_settings), and catches
// up when the server was down at 5:00 AM (the first tick after 5:00 that day runs it).

export const AUTO_LOCK_INACTIVE_DAYS = 14;
export const AUTO_LOCK_AFTER_UNLOCK_DAYS = 15;
const RUN_AT_HOUR = 5;
const LAST_RUN_KEY = 'ledger_auto_lock_last_run';
const AUTO_LOCK_BY = 'AUTO LOCK';

let columnsReady: Promise<void> | null = null;
// unlocked_at / auto_locked_at on ledgers, and app_settings — created on first use (same DDL as
// migrate.ts) so an un-migrated database still works
export function ensureAutoLockColumns(): Promise<void> {
  if (!columnsReady) {
    columnsReady = pgSql
      .unsafe(`
        ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS unlocked_at TIMESTAMP;
        ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS auto_locked_at TIMESTAMP;
        CREATE TABLE IF NOT EXISTS app_settings (
          key VARCHAR(100) PRIMARY KEY,
          value JSONB NOT NULL,
          updated_by VARCHAR(100),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        );
      `)
      .then(() => undefined)
      .catch((err) => {
        columnsReady = null;
        throw err;
      });
  }
  return columnsReady;
}

// Locked button: an unlock starts the 15-day grace; a lock by hand is not an auto lock
export async function recordLockChange(ledgerId: number, isLocked: boolean) {
  await ensureAutoLockColumns();
  if (isLocked) {
    await pgSql`UPDATE ledgers SET auto_locked_at = NULL WHERE id = ${ledgerId}`;
  } else {
    await pgSql`UPDATE ledgers SET unlocked_at = NOW(), auto_locked_at = NULL WHERE id = ${ledgerId}`;
  }
}

// Locks every party due today; returns the ones locked
export async function runAutoLock(): Promise<Array<{ id: number; party_name: string }>> {
  await ensureAutoLockColumns();
  const locked = await pgSql<Array<{ id: number; party_name: string }>>`
    UPDATE ledgers l
    -- Updated (updated_by / updated_at) is left as it was: the column keeps showing who last
    -- changed the party; the auto lock is recorded in auto_locked_at only
    SET is_locked = TRUE, auto_locked_at = NOW()
    WHERE l.deleted_at IS NULL
      AND l.is_locked = FALSE
      AND UPPER(l.party_name) <> 'HP A/C'
      AND l.created_at < NOW() - make_interval(days => ${AUTO_LOCK_INACTIVE_DAYS})
      AND (l.unlocked_at IS NULL OR l.unlocked_at < NOW() - make_interval(days => ${AUTO_LOCK_AFTER_UNLOCK_DAYS}))
      AND NOT EXISTS (
        SELECT 1 FROM transactions t
        WHERE t.party_id = l.id
          AND t.status <> 'VOIDED'
          AND t.created_at >= NOW() - make_interval(days => ${AUTO_LOCK_INACTIVE_DAYS})
      )
    RETURNING l.id, l.party_name`;
  return locked;
}

// Business date / hour now (the 5:00 AM is India time even on a UTC server)
function businessNow(): { date: string; hour: number } {
  const tz = process.env.AUTO_LOCK_TZ || 'Asia/Kolkata';
  const p: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
  }).formatToParts(new Date())) p[part.type] = part.value;
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

// Claims today's run (only one process / tick gets true)
async function claimToday(date: string): Promise<boolean> {
  await ensureAutoLockColumns();
  const rows = await pgSql`
    INSERT INTO app_settings (key, value, updated_by, updated_at)
    VALUES (${LAST_RUN_KEY}, ${JSON.stringify({ date })}::jsonb, ${AUTO_LOCK_BY}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
      WHERE app_settings.value->>'date' IS DISTINCT FROM ${date}
    RETURNING key`;
  return rows.length > 0;
}

async function tick() {
  let claimed = false;
  try {
    const { date, hour } = businessNow();
    if (hour < RUN_AT_HOUR) return;
    if (!(await claimToday(date))) return;
    claimed = true;
    const locked = await runAutoLock();
    await pgSql`
      UPDATE app_settings SET value = ${JSON.stringify({ date, locked: locked.length, at: new Date().toISOString() })}::jsonb
      WHERE key = ${LAST_RUN_KEY}`;
    console.log(`[AutoLock] ${date}: ${locked.length} party account(s) locked (no entry in ${AUTO_LOCK_INACTIVE_DAYS} days)`
      + (locked.length ? `: ${locked.slice(0, 20).map(l => l.party_name).join(', ')}${locked.length > 20 ? ' …' : ''}` : ''));
  } catch (err: any) {
    console.warn('[AutoLock] daily check failed:', err?.message || err);
    // give today's run back, so the next tick tries again
    if (claimed) {
      await pgSql`UPDATE app_settings SET value = ${JSON.stringify({ date: null })}::jsonb WHERE key = ${LAST_RUN_KEY}`
        .catch(() => undefined);
    }
  }
}

let timer: NodeJS.Timeout | null = null;
// Started once with the server: checks every minute whether today's 5:00 AM run is due
export function startLedgerAutoLock() {
  if (timer || process.env.AUTO_LOCK_DISABLED === 'true') return;
  void tick();
  timer = setInterval(() => void tick(), 60 * 1000);
  timer.unref?.();
}
