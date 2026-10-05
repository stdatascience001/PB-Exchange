// One-off import of the live panel's data (Ledgers, their Agents, Staff) from the JSON the
// live API returns, so the local book holds the same parties with the same Group, Agent,
// rates and flags.
//
//   cd packages/database
//   npx tsx src/import-live.ts              # dry run
//   npx tsx src/import-live.ts --apply      # write
//   (--dir <folder> reads the JSON from another folder instead)
//
// Reads ledgers.json (live "Ledger list") and staffs.json (live "Staff list") from
// packages/database/live-data/ by default — that folder is git-ignored (real party / staff data).
// Everything runs in ONE transaction; a dry run does all the work and then rolls it back, so
// its counts are exactly what --apply will do and nothing is written.
//
// Overwrite rules:
//  - A ledger whose Party Name already exists locally (case-insensitive) is overwritten with
//    the live values; a new name is created. Local ledgers not in the live list are left alone.
//    Its id is kept, so its transactions / vouchers stay attached.
//  - Fields the live list doesn't carry are left as they are on an existing ledger (password,
//    Telegram, Distributor / Retailer, Self Hissa %, Bet Limit, Hissa / 3rd-party rows).
//  - Agents are matched by name; a missing one is created. An existing agent is not changed.
//  - A staff login that already exists keeps its password; its role / active flag / details
//    are overwritten. A DEVELOPER login is never changed. New logins get password 123456.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { eq, sql } from 'drizzle-orm';
import { db, sql as pgSql } from './client.js';
import { ledgers, agents } from './schema/ledgers.js';
import { users, roles } from './schema/auth.js';
import { staff } from './schema/staff.js';

interface LiveLedger {
  LedgerId: number;
  LedgerName: string;
  RealName?: string | null;
  GroupName?: string | null;
  AgentLedgerId?: number | null;
  AgentName?: string | null;
  LimitType?: string;
  DaraRate?: number;
  DaraCommission?: number;
  AkharRate?: number;
  AkharCommission?: number;
  Vapsi?: number;
  TPVapsi?: string;
  IsDibba?: string;
  DibbaAmount?: number;
  RefLedgerId?: number | null;
  HPLedgerId?: number | null;
  Grantor?: string | null;
  DealingType?: string | null;
  AccountStatus?: string | null;
  IsHide?: string | null;
  TransactionCappingAmount?: number;
  IsApplyLedgerConfigOnTransaction?: number;
  IsRisky?: number;
  TransactionLock?: number;
  IsTransactionAllow?: number;
  RecordStatus?: string;
  AddedBy?: string | null;
  AddedDate?: string | null;
  UpdatedBy?: string | null;
  UpdatedDate?: string | null;
  UserName?: string | null;
  Mobile?: string | null;
  Address?: string | null;
  LoginStatus?: string | null;
}

interface LiveStaff {
  LoginName: string;
  UserName: string;
  Mobile?: string | null;
  Address?: string | null;
  StaffWorkMode?: number | null;
  AccountStatus?: string | null;
  UpdatedBy?: string | null;
  UpdatedDate?: string | null;
  RoleName?: string | null;
  AgentLedgerName?: string | null;
}

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const dirIdx = args.indexOf('--dir');
// Shown as "Updated By" on the agents this import creates (Agents page); --by <name> to change
const byIdx = args.indexOf('--by');
const importedBy = (byIdx >= 0 ? args[byIdx + 1] : 'KARAN999').trim().toUpperCase();
// Default: packages/database/live-data (git-ignored), next to this package's src folder
const dir = dirIdx >= 0 ? args[dirIdx + 1] : path.resolve(__dirname, '..', 'live-data');

const readList = <T>(file: string): T[] => {
  const full = path.join(dir, file);
  if (!fs.existsSync(full)) {
    console.log(`(skipped: ${full} not found)`);
    return [];
  }
  const json = JSON.parse(fs.readFileSync(full, 'utf8'));
  const list = Array.isArray(json) ? json : json.data;
  if (!Array.isArray(list)) throw new Error(`${full}: expected a "data" array`);
  return list as T[];
};

const norm = (v?: string | null) => (v || '').trim().toUpperCase();
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const money = (v: unknown) => num(v).toFixed(2);

// Live dates come as "04-07-2025 04:59 PM" (list) or "2022-04-28 02:28:08" (detail).
const parseLiveDate = (v?: string | null): Date | null => {
  if (!v) return null;
  let m = /^(\d{2})-(\d{2})-(\d{4}) (\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(v.trim());
  if (m) {
    let h = parseInt(m[4], 10) % 12;
    if (m[6].toUpperCase() === 'PM') h += 12;
    return new Date(+m[3], +m[2] - 1, +m[1], h, +m[5]);
  }
  m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(v.trim());
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  return null;
};

// Same format as the API's hashPassword (apps/api auth.service) so new logins work.
const hashPassword = (password: string) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
};

class DryRunRollback extends Error {}

async function main() {
  const liveLedgers = readList<LiveLedger>('ledgers.json');
  const liveStaff = readList<LiveStaff>('staffs.json');
  console.log(`${apply ? 'APPLY' : 'DRY RUN'} — ${liveLedgers.length} ledgers, ${liveStaff.length} staff from ${dir}`);

  // Columns some code adds on first use (kept out of the drizzle table) — make sure they exist.
  await pgSql.unsafe(`
    ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS login_active BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS account_active BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS added_by VARCHAR(100);
  `);

  const report = {
    agentsCreated: 0,
    agentsMatched: 0,
    ledgersCreated: 0,
    ledgersOverwritten: 0,
    hpLinked: 0,
    hpTargetMissing: 0,
    refLinked: 0,
    refTargetMissing: 0,
    staffCreated: 0,
    staffOverwritten: 0,
    usersCreated: 0,
    usersOverwritten: 0,
    developerSkipped: 0,
    unknownRoles: new Set<string>(),
  };

  try {
    await db.transaction(async (tx) => {
      // ---- Agents (by name) ----
      const [firstUser] = await tx.select({ id: users.id }).from(users).orderBy(users.id).limit(1);
      if (!firstUser) throw new Error('No user in the users table to own new agents');
      const agentIdByName = new Map<string, number>();
      for (const a of await tx.select({ id: agents.id, agentName: agents.agentName }).from(agents).orderBy(agents.id)) {
        if (!agentIdByName.has(norm(a.agentName))) agentIdByName.set(norm(a.agentName), a.id);
      }
      const liveAgentNames = new Set<string>();
      for (const l of liveLedgers) {
        if (num(l.AgentLedgerId) > 0 && norm(l.AgentName)) liveAgentNames.add(norm(l.AgentName));
      }
      // Agents an earlier run of this import stamped "LIVE IMPORT" now show the importing user
      await tx.update(agents).set({ updatedBy: importedBy }).where(eq(agents.updatedBy, 'LIVE IMPORT'));
      for (const name of liveAgentNames) {
        if (agentIdByName.has(name)) {
          report.agentsMatched++;
          continue;
        }
        const [created] = await tx.insert(agents).values({
          userId: firstUser.id,
          agentName: name,
          updatedBy: importedBy,
        }).returning({ id: agents.id });
        agentIdByName.set(name, created.id);
        report.agentsCreated++;
      }

      // ---- Ledgers, pass 1: create / overwrite (no ledger-to-ledger links yet) ----
      const existingByName = new Map<string, number>();
      for (const l of await tx.select({ id: ledgers.id, partyName: ledgers.partyName }).from(ledgers)) {
        existingByName.set(norm(l.partyName), l.id);
      }
      const localIdByLiveId = new Map<number, number>();

      for (const l of liveLedgers) {
        const partyName = norm(l.LedgerName);
        if (!partyName) continue;
        const agentId = num(l.AgentLedgerId) > 0 && norm(l.AgentName) ? agentIdByName.get(norm(l.AgentName)) ?? null : null;
        const addedAt = parseLiveDate(l.AddedDate);
        const updatedAt = parseLiveDate(l.UpdatedDate) || addedAt || new Date();

        const values = {
          partyName,
          realName: l.RealName?.trim() || null,
          groupName: l.GroupName?.trim() || 'Fanter',
          agentId,
          mobile: l.Mobile?.trim() || null,
          address: l.Address?.trim() || '',
          grantor: l.Grantor?.trim() || '',
          dealing: l.DealingType?.trim() || 'DAILY',
          rebate: money(l.Vapsi),
          dibba: norm(l.IsDibba) === 'YES',
          dAmt: money(l.DibbaAmount),
          daraRate: money(l.DaraRate),
          akharRate: money(l.AkharRate),
          // Local keeps one commission figure; the live Dara commission goes in it.
          commissionRate: money(l.DaraCommission),
          capping: money(l.TransactionCappingAmount),
          userName: l.UserName?.trim() || null,
          vapsiTpr: `${num(l.Vapsi)} | ${norm(l.TPVapsi) === 'YES' ? 'YES' : 'NO'}`,
          hasLimit: norm(l.LimitType) === 'YES',
          isLocked: num(l.TransactionLock) === 1,
          isRisky: num(l.IsRisky) === 1,
          isHidden: String(l.IsHide ?? '0') === '1',
          isTransactionAllow: num(l.IsTransactionAllow) === 1,
          masterLedgerConfig: num(l.IsApplyLedgerConfigOnTransaction) === 1,
          updatedBy: l.UpdatedBy?.trim() || 'A100',
          updatedAt,
          deletedAt: (l.RecordStatus || 'A') === 'A' ? null : updatedAt,
        };

        let localId = existingByName.get(partyName);
        if (localId) {
          await tx.update(ledgers).set(values).where(eq(ledgers.id, localId));
          report.ledgersOverwritten++;
        } else {
          const [created] = await tx.insert(ledgers).values({
            ...values,
            ...(addedAt ? { createdAt: addedAt } : {}),
          }).returning({ id: ledgers.id });
          localId = created.id;
          existingByName.set(partyName, localId);
          report.ledgersCreated++;
        }
        localIdByLiveId.set(l.LedgerId, localId);

        // Login / Account Status and Added By live outside the drizzle table
        const loginActive = l.LoginStatus == null ? true : String(l.LoginStatus) === '1';
        const accountActive = String(l.AccountStatus ?? '1') === '1';
        await tx.execute(sql`
          UPDATE ledgers SET login_active = ${loginActive}, account_active = ${accountActive},
            added_by = ${l.AddedBy?.trim() || null}
          WHERE id = ${localId}`);
      }

      // ---- Ledgers, pass 2: HP Ledger / Ref-Ledger, now every live id has a local id ----
      for (const l of liveLedgers) {
        const localId = localIdByLiveId.get(l.LedgerId);
        if (!localId) continue;
        const hpLive = num(l.HPLedgerId);
        const refLive = num(l.RefLedgerId);
        const hpLedgerId = hpLive > 0 ? localIdByLiveId.get(hpLive) ?? null : null;
        const refLedgerId = refLive > 0 ? localIdByLiveId.get(refLive) ?? null : null;
        if (hpLive > 0) hpLedgerId ? report.hpLinked++ : report.hpTargetMissing++;
        if (refLive > 0) refLedgerId ? report.refLinked++ : report.refTargetMissing++;
        await tx.update(ledgers).set({ hpLedgerId, refLedgerId }).where(eq(ledgers.id, localId));
      }

      // ---- Staff ----
      const roleIdByName = new Map<string, number>();
      for (const r of await tx.select({ id: roles.id, name: roles.name }).from(roles)) roleIdByName.set(norm(r.name), r.id);
      const developerRoleId = roleIdByName.get('DEVELOPER');
      const fallbackRoleId = roleIdByName.get('ADMIN');

      for (const s of liveStaff) {
        const fullName = (s.LoginName || s.UserName || '').trim();
        if (!fullName) continue;
        // Login name without spaces, as the Staff page's own create does
        const username = (s.UserName || fullName).replace(/\s+/g, '');
        const roleName = norm(s.RoleName) || 'ADMIN';
        let roleId = roleIdByName.get(roleName);
        if (!roleId) {
          report.unknownRoles.add(roleName);
          roleId = fallbackRoleId;
        }
        if (!roleId) throw new Error(`No role "${roleName}" and no ADMIN role to fall back on`);
        const isActive = String(s.AccountStatus ?? '1') === '1';

        const [existingUser] = await tx.select().from(users).where(sql`LOWER(${users.username}) = LOWER(${username})`);
        if (existingUser && developerRoleId && existingUser.roleId === developerRoleId) {
          report.developerSkipped++;
          continue;
        }
        let userId: number;
        if (existingUser) {
          await tx.update(users).set({ roleId, isActive }).where(eq(users.id, existingUser.id));
          userId = existingUser.id;
          report.usersOverwritten++;
        } else {
          const [created] = await tx.insert(users).values({
            username,
            passwordHash: hashPassword('123456'),
            roleId,
            isActive,
          }).returning({ id: users.id });
          userId = created.id;
          report.usersCreated++;
        }

        const staffValues = {
          fullName,
          role: roleName,
          designation: roleName,
          username,
          mobile: s.Mobile?.trim() || '',
          address: s.Address?.trim() || '',
          agent: s.AgentLedgerName?.trim() || '',
          isActive,
          updatedBy: (s.UpdatedBy?.trim() || 'A100').slice(0, 50),
          updatedAt: parseLiveDate(s.UpdatedDate) || new Date(),
        };
        const [existingStaff] = await tx.select({ id: staff.id }).from(staff)
          .where(sql`${staff.userId} = ${userId} OR LOWER(${staff.username}) = LOWER(${username})`)
          .limit(1);
        if (existingStaff) {
          await tx.update(staff).set({ ...staffValues, userId }).where(eq(staff.id, existingStaff.id));
          report.staffOverwritten++;
        } else {
          await tx.insert(staff).values({
            ...staffValues,
            userId,
            password: '123456',
            wMode: 'NONE',
            assignedStation: fullName,
            isWorkingLive: true,
          });
          report.staffCreated++;
        }
      }

      if (!apply) throw new DryRunRollback();
    });
  } catch (err) {
    if (!(err instanceof DryRunRollback)) throw err;
  }

  console.log({ ...report, unknownRoles: [...report.unknownRoles] });
  console.log(apply ? 'Done — written to the database.' : 'Dry run only — rolled back, nothing written. Re-run with --apply.');
}

main()
  .then(() => pgSql.end())
  .catch(async (err) => {
    console.error('Import failed (nothing written):', err);
    await pgSql.end();
    process.exit(1);
  });
