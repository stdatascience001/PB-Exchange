import { sql as pgSql } from '@pb/database';

// Inactive-staff redirect: once a staff member whose Staffs-page Active is NO signs in with the
// right password, that browser's IP is remembered here and every later visit from it is sent
// to Google (the app gets code IP_REDIRECT) — the live behaviour. An entry lifts when the staff
// member is made Active again, or after REDIRECT_HOURS.
const REDIRECT_HOURS = 24;

let tableReady: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (!tableReady) {
    tableReady = pgSql
      .unsafe(`
        CREATE TABLE IF NOT EXISTS inactive_login_ips (
          id SERIAL PRIMARY KEY,
          ip_address VARCHAR(45) NOT NULL,
          username VARCHAR(60) NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          expires_at TIMESTAMP NOT NULL
        );
        CREATE INDEX IF NOT EXISTS inactive_login_ips_ip_idx ON inactive_login_ips(ip_address);
      `)
      .then(() => undefined)
      .catch((err) => {
        tableReady = null;
        throw err;
      });
  }
  return tableReady;
}

const redirectCache = new Set<string>();
let lastRefresh = 0;

async function refreshCache() {
  if (Date.now() - lastRefresh < 60000) return;
  try {
    await ensureTable();
    const rows = await pgSql<Array<{ ip_address: string }>>`
      SELECT DISTINCT ip_address FROM inactive_login_ips WHERE expires_at > NOW()`;
    redirectCache.clear();
    for (const r of rows) redirectCache.add(r.ip_address);
    lastRefresh = Date.now();
  } catch (err: any) {
    console.warn('[InactiveRedirect] cache refresh warning:', err?.message || err);
  }
}

export async function isRedirectIp(ip: string): Promise<boolean> {
  await refreshCache();
  return redirectCache.has(ip);
}

export async function addRedirectIp(ip: string, username: string) {
  try {
    await ensureTable();
    await pgSql`
      INSERT INTO inactive_login_ips (ip_address, username, expires_at)
      VALUES (${ip}, ${username}, NOW() + (${REDIRECT_HOURS}::int * INTERVAL '1 hour'))`;
    redirectCache.add(ip);
  } catch (err: any) {
    console.warn('[InactiveRedirect] add warning:', err?.message || err);
  }
}

// Staff made Active again: its IPs stop redirecting (on the next request)
export async function clearRedirectForUsernames(usernames: string[]) {
  const names = usernames.filter(Boolean).map((u) => u.toLowerCase());
  if (names.length === 0) return;
  try {
    await ensureTable();
    await pgSql`DELETE FROM inactive_login_ips WHERE LOWER(username) IN ${pgSql(names)}`;
    lastRefresh = 0;
  } catch (err: any) {
    console.warn('[InactiveRedirect] clear warning:', err?.message || err);
  }
}
