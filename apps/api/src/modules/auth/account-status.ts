import { sql as pgSql } from '@pb/database';
import { SystemRole } from '@pb/types';

// The account behind a token as it is NOW in the database: whether it is still active and its
// current role. A token carries the role it was issued with, so without this a staff member
// made inactive (or moved to a smaller role) kept their old access until the token expired.
// Cached briefly so most requests don't hit the database; a change made through this process
// (Staffs page) takes effect at once via forgetAccountStatus().
const TTL_MS = 15000;

export type AccountStatus = { exists: boolean; isActive: boolean; roleId: number | null; roleName: SystemRole | null };

const cache = new Map<number, { status: AccountStatus; at: number }>();

// Unknown / database trouble returns null, and the caller keeps the token's own data, so a
// database hiccup never signs everyone out (same rule as session-store.ts).
export async function getAccountStatus(userId: number): Promise<AccountStatus | null> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.status;
  try {
    const rows = await pgSql<Array<{ is_active: boolean; role_id: number; role_name: string | null }>>`
      SELECT u.is_active, u.role_id, r.name AS role_name
      FROM users u LEFT JOIN roles r ON r.id = u.role_id
      WHERE u.id = ${userId}`;
    const row = rows[0];
    const status: AccountStatus = row
      ? { exists: true, isActive: row.is_active, roleId: row.role_id, roleName: (row.role_name as SystemRole) || null }
      : { exists: false, isActive: false, roleId: null, roleName: null };
    cache.set(userId, { status, at: Date.now() });
    if (cache.size > 20000) cache.clear();
    return status;
  } catch (err: any) {
    console.warn('[AccountStatus] check warning:', err?.message || err);
    return null;
  }
}

export function forgetAccountStatus(userId?: number | null) {
  if (userId) cache.delete(userId);
  else cache.clear();
}
