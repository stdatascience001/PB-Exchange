import { db, sql as pgSql, ledgers, agents, ledgerThirdPartyLinks, voucherEntries } from '@pb/database';
import { eq, ilike, or, and, isNull, isNotNull, asc, inArray, sql } from 'drizzle-orm';
import { AppError, NotFoundError } from '../../common/errors.js';

// Live ledger "AddedBy": who created the party (UpdatedBy only says who touched it last).
// Rows created before this column existed have no creator on record and come back null.
//
// Account tab "Login Status" (Active / Deactive) — the party's own login switch, separate from
// Locked (which blocks its transactions) — and "Account Status" (Active / Deactive): a Deactive
// account is left out of Transaction Add's party search and can't take new slips.
// Both are kept out of the drizzle `ledgers` table on purpose:
// every `select().from(ledgers)` elsewhere stays exactly as it was, and the column is added on
// first use here (same DDL as migrate.ts) so a database that hasn't re-run migrations still works.
let loginColumnReady: Promise<void> | null = null;
function ensureLoginColumn(): Promise<void> {
  if (!loginColumnReady) {
    loginColumnReady = pgSql
      .unsafe(`
        ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS login_active BOOLEAN NOT NULL DEFAULT TRUE;
        ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS account_active BOOLEAN NOT NULL DEFAULT TRUE;
        ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS added_by VARCHAR(100);
      `)
      .then(() => undefined)
      .catch((err) => {
        loginColumnReady = null;
        throw err;
      });
  }
  return loginColumnReady;
}

async function statusFlagsOf(id: number): Promise<{ loginActive: boolean; accountActive: boolean }> {
  await ensureLoginColumn();
  const rows = await pgSql<Array<{ login_active: boolean; account_active: boolean }>>`
    SELECT login_active, account_active FROM ledgers WHERE id = ${id}`;
  return { loginActive: rows[0]?.login_active ?? true, accountActive: rows[0]?.account_active ?? true };
}

async function addedByOf(id: number): Promise<string | null> {
  await ensureLoginColumn();
  const rows = await pgSql<Array<{ added_by: string | null }>>`
    SELECT added_by FROM ledgers WHERE id = ${id}`;
  return rows[0]?.added_by ?? null;
}

export class LedgerService {
  // Account Status: false once the account is switched to Deactive
  static async isAccountActive(id: number): Promise<boolean> {
    return (await statusFlagsOf(id)).accountActive;
  }

  // Full detail for the Ledger Update popup's Info tab, with self-referencing
  // distributor/retailer/ref-ledger/HP-ledger ids resolved to their party names.
  static async getLedgerById(id: number) {
    const [ledger] = await db.select().from(ledgers).where(eq(ledgers.id, id));
    if (!ledger) throw new NotFoundError('Ledger not found');

    const refIds = [ledger.distributorId, ledger.retailerId, ledger.refLedgerId, ledger.hpLedgerId]
      .filter((v): v is number => v != null);
    const uniqueRefIds = Array.from(new Set(refIds));
    const refRows = uniqueRefIds.length > 0
      ? await db.select({ id: ledgers.id, partyName: ledgers.partyName }).from(ledgers).where(inArray(ledgers.id, uniqueRefIds))
      : [];
    const nameById = new Map(refRows.map(r => [r.id, r.partyName]));

    let agentName: string | null = null;
    if (ledger.agentId) {
      const [agent] = await db.select({ agentName: agents.agentName }).from(agents).where(eq(agents.id, ledger.agentId));
      agentName = agent?.agentName || null;
    }

    // The party's password never leaves the server — the Ledger Update popup's Password tab
    // only ever shows a masked placeholder and can set a new one.
    const { password: _password, ...ledgerWithoutPassword } = ledger;

    const { loginActive, accountActive } = await statusFlagsOf(ledger.id);
    const addedBy = await addedByOf(ledger.id);

    return {
      ...ledgerWithoutPassword,
      loginActive,
      accountActive,
      addedBy,
      daraRate: parseFloat(ledger.daraRate),
      akharRate: parseFloat(ledger.akharRate),
      commissionRate: parseFloat(ledger.commissionRate),
      hissaPercentage: parseFloat(ledger.hissaPercentage),
      betLimit: parseFloat(ledger.betLimit),
      capping: parseFloat(ledger.capping),
      rebate: parseFloat(ledger.rebate),
      dAmt: parseFloat(ledger.dAmt),
      agentName,
      distributorName: ledger.distributorId ? nameById.get(ledger.distributorId) || null : null,
      retailerName: ledger.retailerId ? nameById.get(ledger.retailerId) || null : null,
      refLedgerName: ledger.refLedgerId ? nameById.get(ledger.refLedgerId) || null : null,
      hpLedgerName: ledger.hpLedgerId ? nameById.get(ledger.hpLedgerId) || null : null,
      updatedAt: ledger.updatedAt ? ledger.updatedAt.toISOString() : ledger.createdAt.toISOString(),
      createdAt: ledger.createdAt.toISOString(),
    };
  }

  static async searchParties(query: string) {
    const list = await db.select({
      id: ledgers.id,
      partyName: ledgers.partyName,
      realName: ledgers.realName,
      userName: ledgers.userName,
      groupName: ledgers.groupName,
      agentId: ledgers.agentId,
      agentName: agents.agentName,
      daraRate: ledgers.daraRate,
      akharRate: ledgers.akharRate,
      commissionRate: ledgers.commissionRate,
      hissaPercentage: ledgers.hissaPercentage,
      betLimit: ledgers.betLimit,
      capping: ledgers.capping,
      hasLimit: ledgers.hasLimit,
      vapsiTpr: ledgers.vapsiTpr,
      isLocked: ledgers.isLocked,
      isRisky: ledgers.isRisky,
    })
    .from(ledgers)
    .leftJoin(agents, eq(ledgers.agentId, agents.id))
    .where(
      and(
        isNull(ledgers.deletedAt),
        or(
          ilike(ledgers.partyName, `%${query}%`),
          ilike(ledgers.realName, `%${query}%`),
          ilike(ledgers.userName, `%${query}%`),
          ilike(ledgers.telegram, `%${query}%`)
        )
      )
    )
    .limit(20);

    return list.map(l => ({
      ...l,
      daraRate: parseFloat(l.daraRate),
      akharRate: parseFloat(l.akharRate),
      commissionRate: parseFloat(l.commissionRate),
      hissaPercentage: parseFloat(l.hissaPercentage),
      betLimit: parseFloat(l.betLimit),
      capping: parseFloat(l.capping),
    }));
  }

  // `group` is optional and additive: callers that omit it get exactly the list they always
  // got. It exists so a consumer that only needs one group's parties (e.g. the Agents page's
  // "Main Agent Name" picker, which offers Cash Agent ledgers) can ask for just those instead
  // of pulling every ledger down and filtering in the browser.
  static async listLedgers(status?: string, group?: string) {
    // The system "HP A/C" account (Hawa Patti) is not listed as a party, as on the live Ledger page.
    let whereClause = and(isNull(ledgers.deletedAt), sql`UPPER(${ledgers.partyName}) <> 'HP A/C'`) as any;
    if (status === 'Deleted') {
      whereClause = isNotNull(ledgers.deletedAt);
    } else if (status === 'ALL') {
      whereClause = undefined as any;
    }

    if (group && group.trim()) {
      // Case-insensitive so 'Cash Agent' / 'CASH AGENT' both work; rows saved before
      // group_name existed are null and default to 'Fanter' on read, so they never match.
      const groupClause = sql`LOWER(${ledgers.groupName}) = LOWER(${group.trim()})`;
      whereClause = whereClause ? (and(whereClause, groupClause) as any) : (groupClause as any);
    }

    const query = db.select({
      id: ledgers.id,
      partyName: ledgers.partyName,
      realName: ledgers.realName,
      userName: ledgers.userName,
      groupName: ledgers.groupName,
      agentId: ledgers.agentId,
      agentName: agents.agentName,
      telegram: ledgers.telegram,
      mobile: ledgers.mobile,
      daraRate: ledgers.daraRate,
      akharRate: ledgers.akharRate,
      commissionRate: ledgers.commissionRate,
      hissaPercentage: ledgers.hissaPercentage,
      betLimit: ledgers.betLimit,
      capping: ledgers.capping,
      hasLimit: ledgers.hasLimit,
      vapsiTpr: ledgers.vapsiTpr,
      rebate: ledgers.rebate,
      isLocked: ledgers.isLocked,
      isRisky: ledgers.isRisky,
      isHidden: ledgers.isHidden,
      deletedAt: ledgers.deletedAt,
      updatedBy: ledgers.updatedBy,
      updatedAt: ledgers.updatedAt,
      createdAt: ledgers.createdAt,
      // Live ledger list fields (RefLedgerId, HPLedgerId, Grantor, DealingType, Address,
      // IsDibba/DibbaAmount, IsApplyLedgerConfigOnTransaction, IsTransactionAllow)
      refLedgerId: ledgers.refLedgerId,
      hpLedgerId: ledgers.hpLedgerId,
      address: ledgers.address,
      grantor: ledgers.grantor,
      dealing: ledgers.dealing,
      dibba: ledgers.dibba,
      dAmt: ledgers.dAmt,
      masterLedgerConfig: ledgers.masterLedgerConfig,
      isTransactionAllow: ledgers.isTransactionAllow,
    })
    .from(ledgers)
    .leftJoin(agents, eq(ledgers.agentId, agents.id));

    const list = whereClause 
      ? await query.where(whereClause).orderBy(asc(ledgers.id))
      : await query.orderBy(asc(ledgers.id));

    // Ledgers list "Vapsi | TPR" column: TPR = YES when the party has a 3rd Party Rebate
    // (Info tab's TPV link), e.g. "15 | YES" for rebate 15 + a TPV link.
    const tpvRows = await db.selectDistinct({ ledgerId: ledgerThirdPartyLinks.ledgerId })
      .from(ledgerThirdPartyLinks)
      .where(eq(ledgerThirdPartyLinks.linkType, 'TPV'));
    const hasTpvLink = new Set(tpvRows.map(r => r.ledgerId));

    // Login Status: the (few) parties whose login is switched off
    await ensureLoginColumn();
    const loginOffRows = await pgSql<Array<{ id: number }>>`SELECT id FROM ledgers WHERE login_active = FALSE`;
    const loginOff = new Set(loginOffRows.map(r => r.id));
    const accountOffRows = await pgSql<Array<{ id: number }>>`SELECT id FROM ledgers WHERE account_active = FALSE`;
    const accountOff = new Set(accountOffRows.map(r => r.id));
    const addedByRows = await pgSql<Array<{ id: number; added_by: string }>>`
      SELECT id, added_by FROM ledgers WHERE added_by IS NOT NULL`;
    const addedById = new Map(addedByRows.map(r => [r.id, r.added_by]));

    // Live "HPLedgerName": resolved separately because the HP A/C itself is left out of the list
    const hpIds = Array.from(new Set(list.map(l => l.hpLedgerId).filter((v): v is number => v != null)));
    const hpRows = hpIds.length > 0
      ? await db.select({ id: ledgers.id, partyName: ledgers.partyName }).from(ledgers).where(inArray(ledgers.id, hpIds))
      : [];
    const hpNameById = new Map(hpRows.map(r => [r.id, r.partyName]));

    return list.map(l => ({
      ...l,
      addedBy: addedById.get(l.id) ?? null,
      hpLedgerName: l.hpLedgerId ? hpNameById.get(l.hpLedgerId) || null : null,
      dAmt: parseFloat(l.dAmt),
      rebate: parseFloat(l.rebate),
      hasTpr: hasTpvLink.has(l.id),
      loginActive: !loginOff.has(l.id),
      accountActive: !accountOff.has(l.id),
      deletedAt: l.deletedAt ? l.deletedAt.toISOString() : null,
      agentName: l.agentName || '-NA-',
      userName: l.userName || l.partyName.slice(0, 8),
      groupName: l.groupName || 'Fanter',
      vapsiTpr: l.vapsiTpr || '10 | NO',
      updatedBy: l.updatedBy || 'A100',
      daraRate: parseFloat(l.daraRate),
      akharRate: parseFloat(l.akharRate),
      commissionRate: parseFloat(l.commissionRate),
      hissaPercentage: parseFloat(l.hissaPercentage),
      betLimit: parseFloat(l.betLimit),
      capping: parseFloat(l.capping),
      updatedAt: l.updatedAt ? l.updatedAt.toISOString() : l.createdAt.toISOString(),
      createdAt: l.createdAt.toISOString(),
    }));
  }

  static async createLedger(data: any) {
    const [existing] = await db.select().from(ledgers).where(
      and(eq(ledgers.partyName, data.partyName), isNull(ledgers.deletedAt))
    );

    if (existing) {
      throw new AppError('Party name already exists', 400);
    }

    let agentId = data.agentId ? parseInt(data.agentId, 10) : null;
    if (!agentId && data.agentName && data.agentName.trim()) {
      const cleanName = data.agentName.trim().toUpperCase();
      const [matchedAgent] = await db.select().from(agents).where(eq(agents.agentName, cleanName)).limit(1);
      if (matchedAgent) {
        agentId = matchedAgent.id;
      }
    }

    const [created] = await db.insert(ledgers).values({
      partyName: data.partyName.trim().toUpperCase(),
      realName: data.realName,
      userName: data.userName || Math.floor(10000000 + Math.random() * 90000000).toString(),
      groupName: data.groupName || 'Fanter',
      agentId,
      distributorId: data.distributorId ? parseInt(data.distributorId, 10) : null,
      telegram: data.telegram,
      mobile: data.mobile,
      daraRate: (data.daraRate ?? 90).toString(),
      akharRate: (data.akharRate ?? 9).toString(),
      commissionRate: (data.commissionRate ?? 0).toString(),
      hissaPercentage: (data.hissaPercentage ?? 0).toString(),
      betLimit: (data.betLimit ?? 0).toString(),
      capping: (data.capping ?? 0).toString(),
      hasLimit: data.hasLimit ?? false,
      dibba: data.dibba ?? false,
      dAmt: (data.dAmt ?? 0).toString(),
      vapsiTpr: data.vapsiTpr || '10 | NO',
      isLocked: data.isLocked ?? false,
      isRisky: data.isRisky ?? false,
      updatedBy: data.updatedBy || 'A100',
    }).returning();

    const addedBy = data.addedBy || data.updatedBy || 'A100';
    await ensureLoginColumn();
    await pgSql`UPDATE ledgers SET added_by = ${addedBy} WHERE id = ${created.id}`;

    return { ...created, addedBy };
  }

  static async updateLedger(id: number, data: any) {
    const updatePayload: any = {
      updatedAt: new Date(),
    };

    if (data.partyName) updatePayload.partyName = data.partyName.trim().toUpperCase();
    if (data.realName !== undefined) updatePayload.realName = data.realName;
    if (data.userName !== undefined) updatePayload.userName = data.userName;
    if (data.groupName !== undefined) updatePayload.groupName = data.groupName;
    if (data.agentId !== undefined) updatePayload.agentId = data.agentId ? parseInt(data.agentId, 10) : null;
    if (data.distributorId !== undefined) updatePayload.distributorId = data.distributorId ? parseInt(data.distributorId, 10) : null;
    if (data.retailerId !== undefined) updatePayload.retailerId = data.retailerId ? parseInt(data.retailerId, 10) : null;
    if (data.refLedgerId !== undefined) updatePayload.refLedgerId = data.refLedgerId ? parseInt(data.refLedgerId, 10) : null;
    if (data.hpLedgerId !== undefined) updatePayload.hpLedgerId = data.hpLedgerId ? parseInt(data.hpLedgerId, 10) : null;
    if (data.telegram !== undefined) updatePayload.telegram = data.telegram;
    if (data.mobile !== undefined) updatePayload.mobile = data.mobile;
    if (data.address !== undefined) updatePayload.address = data.address;
    if (data.grantor !== undefined) updatePayload.grantor = data.grantor;
    if (data.dealing !== undefined) updatePayload.dealing = data.dealing;
    if (data.daraRate !== undefined) updatePayload.daraRate = data.daraRate.toString();
    if (data.akharRate !== undefined) updatePayload.akharRate = data.akharRate.toString();
    if (data.commissionRate !== undefined) updatePayload.commissionRate = data.commissionRate.toString();
    if (data.hissaPercentage !== undefined) updatePayload.hissaPercentage = data.hissaPercentage.toString();
    if (data.betLimit !== undefined) updatePayload.betLimit = data.betLimit.toString();
    if (data.rebate !== undefined) updatePayload.rebate = data.rebate.toString();
    if (data.dAmt !== undefined) updatePayload.dAmt = data.dAmt.toString();
    if (data.dibba !== undefined) updatePayload.dibba = data.dibba;
    if (data.hasLimit !== undefined) updatePayload.hasLimit = data.hasLimit;
    if (data.vapsiTpr !== undefined) updatePayload.vapsiTpr = data.vapsiTpr;
    if (data.capping !== undefined) updatePayload.capping = data.capping.toString();
    if (data.isLocked !== undefined) updatePayload.isLocked = data.isLocked;
    if (data.isRisky !== undefined) updatePayload.isRisky = data.isRisky;
    if (data.password !== undefined && data.password.trim() !== '') updatePayload.password = data.password.trim();
    if (data.isHidden !== undefined) updatePayload.isHidden = data.isHidden;
    if (data.masterLedgerConfig !== undefined) updatePayload.masterLedgerConfig = data.masterLedgerConfig;
    if (data.isTransactionAllow !== undefined) updatePayload.isTransactionAllow = data.isTransactionAllow;
    if (data.updatedBy !== undefined) updatePayload.updatedBy = data.updatedBy;

    const [updated] = await db.update(ledgers)
      .set(updatePayload)
      .where(eq(ledgers.id, id))
      .returning();

    if (!updated) throw new AppError('Ledger not found', 404);

    if (typeof data.loginActive === 'boolean') {
      await ensureLoginColumn();
      await pgSql`UPDATE ledgers SET login_active = ${data.loginActive} WHERE id = ${id}`;
    }
    if (typeof data.accountActive === 'boolean') {
      await ensureLoginColumn();
      await pgSql`UPDATE ledgers SET account_active = ${data.accountActive} WHERE id = ${id}`;
    }
    return updated;
  }

  static async softDelete(id: number) {
    const [updated] = await db.update(ledgers)
      .set({ deletedAt: new Date() })
      .where(eq(ledgers.id, id))
      .returning();
    return updated;
  }

  // Account tab's "Delete / Restore" — undoes softDelete above (matches its own live warning:
  // 3rd Party Comm/Rebate and Hissa should be re-checked after restoring).
  static async restoreLedger(id: number) {
    const [updated] = await db.update(ledgers)
      .set({ deletedAt: null })
      .where(eq(ledgers.id, id))
      .returning();
    if (!updated) throw new NotFoundError('Ledger not found');
    return updated;
  }

  // Re-Config tab's 3 multi-row lists (Hissa Party, 3rd Party Comm, 3rd Party Rebate) — unified
  // by linkType rather than 3 near-identical tables/endpoints.
  static async listThirdPartyLinks(ledgerId: number, linkType?: string) {
    const conditions = [eq(ledgerThirdPartyLinks.ledgerId, ledgerId)];
    if (linkType) conditions.push(eq(ledgerThirdPartyLinks.linkType, linkType));
    return db.select().from(ledgerThirdPartyLinks)
      .where(and(...conditions))
      .orderBy(asc(ledgerThirdPartyLinks.id));
  }

  static async addThirdPartyLink(ledgerId: number, data: {
    linkType: 'HISSA' | 'TPC' | 'TPV';
    partyName: string;
    percent?: number;
    dComm?: number;
    aComm?: number;
  }) {
    if (!data.partyName || !data.partyName.trim()) {
      throw new AppError('Party name is required', 400);
    }
    // Choosing the system "HP A/C" as a Hissa Party makes sure that account exists (it's the
    // opposite ledger Auto Hawa Patti posts to) — created only if missing.
    if (data.linkType === 'HISSA' && data.partyName.trim().toUpperCase() === 'HP A/C') {
      const [hp] = await db.select({ id: ledgers.id }).from(ledgers).where(sql`UPPER(TRIM(${ledgers.partyName})) = 'HP A/C'`);
      if (!hp) await db.insert(ledgers).values({ partyName: 'HP A/C', groupName: 'SYSTEM' }).onConflictDoNothing();
    }
    const [created] = await db.insert(ledgerThirdPartyLinks).values({
      ledgerId,
      linkType: data.linkType,
      partyName: data.partyName.trim().toUpperCase(),
      percent: (data.percent ?? 0).toString(),
      dComm: (data.dComm ?? 0).toString(),
      aComm: (data.aComm ?? 0).toString(),
    }).returning();
    return created;
  }

  static async deleteThirdPartyLink(id: number) {
    const [deleted] = await db.delete(ledgerThirdPartyLinks)
      .where(eq(ledgerThirdPartyLinks.id, id))
      .returning();
    if (!deleted) throw new NotFoundError('Link not found');
    return deleted;
  }

  // Linked tab — dynamic aggregate stats (never hardcoded) plus the list of parties this
  // ledger is connected to via Hissa/3rd-Party links or as another ledger's HP Ledger.
  static async getLinkedStats(ledgerId: number) {
    const [voucherRow] = await db.select({
      count: sql<number>`COUNT(DISTINCT ${voucherEntries.voucherId})::int`,
      totalDr: sql<string>`COALESCE(SUM(CASE WHEN ${voucherEntries.entrySide} = 'DR' THEN ${voucherEntries.amount} ELSE 0 END), 0)`,
      totalCr: sql<string>`COALESCE(SUM(CASE WHEN ${voucherEntries.entrySide} = 'CR' THEN ${voucherEntries.amount} ELSE 0 END), 0)`,
    }).from(voucherEntries).where(eq(voucherEntries.ledgerId, ledgerId));

    const linkCounts: Record<string, number> = { HISSA: 0, TPC: 0, TPV: 0 };
    const linkRows = await db.select({
      linkType: ledgerThirdPartyLinks.linkType,
      count: sql<number>`COUNT(*)::int`,
    }).from(ledgerThirdPartyLinks)
      .where(eq(ledgerThirdPartyLinks.ledgerId, ledgerId))
      .groupBy(ledgerThirdPartyLinks.linkType);
    for (const row of linkRows) linkCounts[row.linkType] = row.count;

    const [hpRow] = await db.select({
      count: sql<number>`COUNT(*)::int`,
    }).from(ledgers).where(eq(ledgers.hpLedgerId, ledgerId));

    const linkedParties = await db.select({ partyName: ledgers.partyName })
      .from(ledgers).where(eq(ledgers.hpLedgerId, ledgerId));
    const thirdPartyNames = await db.select({ partyName: ledgerThirdPartyLinks.partyName })
      .from(ledgerThirdPartyLinks).where(eq(ledgerThirdPartyLinks.ledgerId, ledgerId));

    const allLinkedParties = Array.from(new Set([
      ...linkedParties.map(p => p.partyName),
      ...thirdPartyNames.map(p => p.partyName),
    ]));

    return {
      inVoucher: voucherRow?.count || 0,
      totalDr: parseFloat(voucherRow?.totalDr || '0'),
      totalCr: parseFloat(voucherRow?.totalCr || '0'),
      inHissa: linkCounts.HISSA,
      inTpc: linkCounts.TPC,
      inTpv: linkCounts.TPV,
      inHpLedger: hpRow?.count || 0,
      linkedParties: allLinkedParties,
    };
  }
}
