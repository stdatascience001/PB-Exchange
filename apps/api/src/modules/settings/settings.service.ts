import { sql as pgSql } from '@pb/database';

// System-wide settings (key → JSON), kept in app_settings; created on first use (same DDL as
// migrate.ts) so an un-migrated database still works.
let ready: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (!ready) {
    ready = pgSql.unsafe(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key VARCHAR(100) PRIMARY KEY,
        value JSONB NOT NULL,
        updated_by VARCHAR(100),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `).then(() => undefined).catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

// Pages that can show the declared result highlighted (the number and its Andar / Bahar haruf in
// green) — each switched on / off by the Super Admin from the profile menu. All ON by default,
// which is how every one of them behaves today.
export const DECLARE_HIGHLIGHT_PAGES = [
  'declare-transactions',
  'declare-trans-audit',
  'declare-prediction',
  'declare-jantri',
  'declare-collection',
  'company-calculation',
  'daily-report',
] as const;
export type DeclareHighlightPage = typeof DECLARE_HIGHLIGHT_PAGES[number];

const DECLARE_HIGHLIGHT_KEY = 'declare_highlight_pages';

// Per role, per page (the popup's role columns): a page ticked above shows the highlight to a
// role only while that role is ticked for it too. Every role is ON by default — how all pages
// behaved before the role columns.
export const DECLARE_HIGHLIGHT_ROLES = [
  'SUPER ADMIN',
  'DEVELOPER',
  'ADMIN',
  'MANAGER',
  'MARKETER',
  'AUDITOR',
  'DATA ENTRY OPERATOR',
  'TALLY OPERATOR',
] as const;
export type DeclareHighlightRole = typeof DECLARE_HIGHLIGHT_ROLES[number];
type RoleMap = Record<DeclareHighlightPage, Record<DeclareHighlightRole, boolean>>;
const DECLARE_HIGHLIGHT_ROLES_KEY = 'declare_highlight_roles';

export class SettingsService {
  static async getDeclareHighlight(): Promise<Record<DeclareHighlightPage, boolean>> {
    await ensureTable();
    const [row] = await pgSql<Array<{ value: Record<string, unknown> }>>`
      SELECT value FROM app_settings WHERE key = ${DECLARE_HIGHLIGHT_KEY}
    `;
    const saved = (row?.value || {}) as Record<string, unknown>;
    const out = {} as Record<DeclareHighlightPage, boolean>;
    for (const p of DECLARE_HIGHLIGHT_PAGES) out[p] = saved[p] === undefined ? true : saved[p] === true;
    return out;
  }

  static async getDeclareHighlightRoles(): Promise<RoleMap> {
    await ensureTable();
    const [row] = await pgSql<Array<{ value: Record<string, Record<string, unknown>> }>>`
      SELECT value FROM app_settings WHERE key = ${DECLARE_HIGHLIGHT_ROLES_KEY}
    `;
    const saved = (row?.value || {}) as Record<string, Record<string, unknown>>;
    const out = {} as RoleMap;
    for (const p of DECLARE_HIGHLIGHT_PAGES) {
      out[p] = {} as Record<DeclareHighlightRole, boolean>;
      for (const r of DECLARE_HIGHLIGHT_ROLES) {
        const v = saved[p]?.[r];
        out[p][r] = v === undefined ? true : v === true;
      }
    }
    return out;
  }

  static async setDeclareHighlightRoles(roles: Record<string, unknown>, updatedBy: string) {
    await ensureTable();
    const next = await this.getDeclareHighlightRoles();
    for (const p of DECLARE_HIGHLIGHT_PAGES) {
      const given = roles?.[p];
      if (!given || typeof given !== 'object') continue;
      for (const r of DECLARE_HIGHLIGHT_ROLES) {
        const v = (given as Record<string, unknown>)[r];
        if (typeof v === 'boolean') next[p][r] = v;
      }
    }
    await pgSql`
      INSERT INTO app_settings (key, value, updated_by, updated_at)
      VALUES (${DECLARE_HIGHLIGHT_ROLES_KEY}, ${JSON.stringify(next)}::jsonb, ${updatedBy}, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()
    `;
    return next;
  }

  static async setDeclareHighlight(pages: Record<string, unknown>, updatedBy: string) {
    await ensureTable();
    const current = await this.getDeclareHighlight();
    const next = { ...current };
    for (const p of DECLARE_HIGHLIGHT_PAGES) {
      if (pages && typeof pages[p] === 'boolean') next[p] = pages[p] as boolean;
    }
    // JSON goes as text and is cast in SQL — this client won't take a plain object here
    await pgSql`
      INSERT INTO app_settings (key, value, updated_by, updated_at)
      VALUES (${DECLARE_HIGHLIGHT_KEY}, ${JSON.stringify(next)}::jsonb, ${updatedBy}, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()
    `;
    return next;
  }
}
