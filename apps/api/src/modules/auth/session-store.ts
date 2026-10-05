import crypto from 'crypto';
import { sql as pgSql } from '@pb/database';

// One logged-in account per IP address: any new login from an IP (the same account again, or
// a different one) revokes every other open session on that IP, so those browsers are signed
// out on their next request (code SESSION_REPLACED) and only the new login stays active.
// Sessions on other IPs are left alone (an account can still be open at home and at work).
//
// Each login gets a session id (`sid`) carried in its token. Tokens issued before this existed
// carry no sid; they keep working until they expire, unless another account has since logged
// in on their IP (see isIpTakenByOtherUser).
//
// The table is created on first use (same DDL as migrate.ts) so a database that hasn't re-run
// migrations still works.
let tableReady: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (!tableReady) {
    tableReady = pgSql
      .unsafe(`
        CREATE TABLE IF NOT EXISTS user_sessions (
          id SERIAL PRIMARY KEY,
          sid VARCHAR(64) NOT NULL UNIQUE,
          user_id INTEGER NOT NULL,
          ip_address VARCHAR(45) NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          revoked_at TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS user_sessions_user_ip_idx ON user_sessions(user_id, ip_address);
      `)
      .then(() => undefined)
      .catch((err) => {
        tableReady = null;
        throw err;
      });
  }
  return tableReady;
}

// sid -> active?, so most requests don't hit the database. A revoked sid stays revoked; an
// active one is re-checked after ACTIVE_TTL_MS (how long another API process may take to see
// a revoke made elsewhere). Revokes made in this process take effect at once.
const ACTIVE_TTL_MS = 5000;
const cache = new Map<string, { active: boolean; at: number }>();

export async function createSession(userId: number, ip: string): Promise<string> {
  await ensureTable();
  const revoked = await pgSql<Array<{ sid: string }>>`
    UPDATE user_sessions SET revoked_at = NOW()
    WHERE ip_address = ${ip} AND revoked_at IS NULL
    RETURNING sid`;
  for (const r of revoked) cache.set(r.sid, { active: false, at: Date.now() });
  ipOwner.set(ip, { userId, at: Date.now() });

  const sid = crypto.randomUUID();
  await pgSql`INSERT INTO user_sessions (sid, user_id, ip_address) VALUES (${sid}, ${userId}, ${ip})`;
  cache.set(sid, { active: true, at: Date.now() });
  return sid;
}

// Unknown sid / database trouble counts as active, so a hiccup here never signs everyone out.
export async function isSessionActive(sid: string): Promise<boolean> {
  const hit = cache.get(sid);
  if (hit && (!hit.active || Date.now() - hit.at < ACTIVE_TTL_MS)) return hit.active;
  try {
    await ensureTable();
    const rows = await pgSql<Array<{ revoked_at: Date | null }>>`
      SELECT revoked_at FROM user_sessions WHERE sid = ${sid}`;
    const active = rows.length === 0 || rows[0].revoked_at === null;
    cache.set(sid, { active, at: Date.now() });
    if (cache.size > 20000) cache.clear();
    return active;
  } catch (err: any) {
    console.warn('[Sessions] check warning:', err?.message || err);
    return true;
  }
}

// Token from before sessions existed (no sid): it is signed out once a different account has
// an open session on its IP — the same one-account-per-IP rule. Cached like the sid check.
const ipOwner = new Map<string, { userId: number | null; at: number }>();
export async function isIpTakenByOtherUser(ip: string, userId: number): Promise<boolean> {
  let hit = ipOwner.get(ip);
  if (!hit || Date.now() - hit.at >= ACTIVE_TTL_MS) {
    try {
      await ensureTable();
      const rows = await pgSql<Array<{ user_id: number }>>`
        SELECT user_id FROM user_sessions
        WHERE ip_address = ${ip} AND revoked_at IS NULL
        ORDER BY created_at DESC LIMIT 1`;
      hit = { userId: rows[0]?.user_id ?? null, at: Date.now() };
      ipOwner.set(ip, hit);
      if (ipOwner.size > 20000) ipOwner.clear();
    } catch (err: any) {
      console.warn('[Sessions] IP check warning:', err?.message || err);
      return false;
    }
  }
  return hit.userId !== null && hit.userId !== userId;
}

export const SESSION_REPLACED_MESSAGE =
  'Another login was made from this IP address (only one account can be logged in per IP), so this session has been logged out.';
