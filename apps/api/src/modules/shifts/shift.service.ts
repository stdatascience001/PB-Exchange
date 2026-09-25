import { db, shifts, shiftRoleConfig, shiftCycles, roles, users, staff, operatorShiftPermissions, transactions, declarations, vouchers, auditLogs } from '@pb/database';
import { eq, and, desc, asc, inArray } from 'drizzle-orm';
import { AppError, CutoffError } from '../../common/errors.js';
import { publishShiftsUpdate } from './shift.events.js';
import { publishDashboardUpdate } from '../dashboard/dashboard.events.js';
import { redis } from '../../config/redis.js';
import { ShiftDto, ShiftRoleConfigDto, SystemRole } from '@pb/types';

export class ShiftService {
  // The moment a role's cut-off falls for the shift's CURRENT cycle — anchored to the shift's own
  // open_date rather than today. An undeclared shift is held on its open_date by the rollover
  // worker, so once the calendar moves past that date its cut-off has already gone by and the
  // countdown reads 00:00:00, instead of restarting against today's clock. For a Next Day shift
  // whose close time is earlier than its open time (e.g. 21:00 → 05:00) the close falls on the
  // following morning.
  static getCycleCloseAt(openDate: string, openTime: string, closeTime: string, isNextDay: boolean): Date {
    const [y, mo, d] = openDate.split('-').map(Number);
    const [h, m, sec] = closeTime.split(':').map(Number);
    const closeAt = new Date(y, (mo || 1) - 1, d || 1, h || 0, m || 0, sec || 0, 0);
    if (isNextDay && closeTime < openTime) {
      closeAt.setDate(closeAt.getDate() + 1);
    }
    return closeAt;
  }

  static getListCacheKey(userRoleName?: SystemRole, userRoleId?: number, userId?: number) {
    return `shifts:list:${userRoleName || 'NONE'}:${userRoleId || 0}:${userId || 0}`;
  }

  // Same short-TTL Redis cache pattern as Dashboard's getDashboardMetrics — every tab's 30s
  // poll for the same role/user within this window is served straight from Redis instead of
  // re-running the per-shift role-config + cutoff-override queries below. Cutoff countdown
  // (timeRemainingSeconds) naturally drifts by a few seconds between polls anyway, so this
  // TTL doesn't add any noticeable staleness beyond that.
  static async listShifts(userRoleName?: SystemRole, userRoleId?: number, userId?: number) {
    const cacheKey = this.getListCacheKey(userRoleName, userRoleId, userId);
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as ShiftDto[];
    } catch (err) {
      console.warn('[Shifts] Redis cache read warning:', err);
    }

    const shiftList = await db.select()
      .from(shifts)
      // Drag & drop order first (sort_order 1..N). Shifts never ordered keep sort_order 0,
      // so until an order is saved this is exactly the original newest-first listing.
      .orderBy(asc(shifts.sortOrder), desc(shifts.createdAt));

    const now = new Date();
    const currentTimeStr = now.toTimeString().slice(0, 8); // "HH:mm:ss"
    const isExemptRole = userRoleName === 'DEVELOPER' || userRoleName === 'SUPER ADMIN';

    const results: ShiftDto[] = [];
    for (const s of shiftList) {
      const roleConfigs = await db.select()
        .from(shiftRoleConfig)
        .where(eq(shiftRoleConfig.shiftId, s.id));

      let isEntryAllowed = s.status === 'OPEN';
      let remainingSec = 0;
      // Left undefined when the caller's role has no timing configured for this shift (no
      // cut-off applies, so there's nothing to be "over").
      let isTransactionTimeOver: boolean | undefined;
      let hasTimeOverride = false;

      // Mirrors ShiftService.assertShiftOpenForRole exactly — this field is what the frontend's
      // Add Transaction page now gates on, so it must agree with what actually gets enforced
      // there: DEVELOPER/SUPER ADMIN bypass the per-role cutoff entirely, and a valid per-user
      // operator override (Declare Trans Permission) re-opens entry after the normal cutoff.
      if (userRoleId) {
        const userConfig = roleConfigs.find(rc => rc.roleId === userRoleId);
        if (userConfig) {
          // Entry gating is still exempt-role aware, exactly as before — DEVELOPER and
          // SUPER ADMIN never have entry closed on them by the per-role cutoff.
          const cycleCloseAt = this.getCycleCloseAt(s.openDate, userConfig.openTime, userConfig.closeTime, s.isNextDay);
          if (!isExemptRole) {
            // Also closed once this cycle's own cut-off (on its open_date) has passed — an
            // undeclared shift still sitting on an earlier date must not reopen just because
            // today's clock is back inside the window.
            if (currentTimeStr > userConfig.closeTime || currentTimeStr < userConfig.openTime || now > cycleCloseAt) {
              isEntryAllowed = false;

              if (userId) {
                const [override] = await db.select().from(operatorShiftPermissions).where(
                  and(
                    eq(operatorShiftPermissions.userId, userId),
                    eq(operatorShiftPermissions.shiftId, s.id),
                    eq(operatorShiftPermissions.shiftDate, s.openDate)
                  )
                );
                if (override && override.canAllow && override.canAdd && (!override.expiresAt || override.expiresAt > now)) {
                  isEntryAllowed = true;
                }
              }
            }
          }

          // The countdown itself is computed for EVERY role, exempt or not. It only reports
          // how long is left until this role's configured cut-off — Add Transaction's
          // "Time Left" badge shows it, and the live page keeps it ticking for every user.
          // Leaving it inside the exempt guard meant DEVELOPER / SUPER ADMIN were always
          // handed 0, so their badge would have read 00:00:00.
          remainingSec = Math.max(0, Math.floor((cycleCloseAt.getTime() - now.getTime()) / 1000));

          // "Transaction time has been over!" — once this cycle's cut-off has passed, Save on
          // Add Transaction is stopped for every role (the live panel shows this even to SUPER
          // ADMIN), unless the user holds a valid Declare Trans Permission override for it.
          if (userId) {
            const [override] = await db.select().from(operatorShiftPermissions).where(
              and(
                eq(operatorShiftPermissions.userId, userId),
                eq(operatorShiftPermissions.shiftId, s.id),
                eq(operatorShiftPermissions.shiftDate, s.openDate)
              )
            );
            hasTimeOverride = !!(override && override.canAllow && override.canAdd && (!override.expiresAt || override.expiresAt > now));
          }
          isTransactionTimeOver = now > cycleCloseAt && !hasTimeOverride;
        }
      }

      results.push({
        id: s.id,
        name: s.name,
        openDate: s.openDate,
        isNextDay: s.isNextDay,
        status: s.status as any,
        declaredNumber: s.declaredNumber,
        shiftFor: s.shiftFor || 'BOTH',
        isActive: s.isActive ?? true,
        updatedBy: s.updatedBy || 'A100',
        updatedAt: s.updatedAt ? s.updatedAt.toISOString() : s.createdAt.toISOString(),
        createdAt: s.createdAt.toISOString(),
        fanterPanelTime: s.fanterPanelTime,
        mainJantriTime: s.mainJantriTime,
        applyShiftConfig: s.applyShiftConfig,
        dRate: parseFloat(s.dRate),
        dCommission: parseFloat(s.dCommission),
        aRate: parseFloat(s.aRate),
        aCommission: parseFloat(s.aCommission),
        tax: parseFloat(s.tax),
        transactionCapping: s.transactionCapping,
        collectionRoundOff: parseFloat(s.collectionRoundOff),
        checkLagaiBeforeDeclare: s.checkLagaiBeforeDeclare,
        createVapsi: s.createVapsi,
        resultWebShiftId: s.resultWebShiftId,
        autoCompanyTransactionActive: s.autoCompanyTransactionActive,
        companyUrl: s.companyUrl,
        companyShiftId: s.companyShiftId,
        companyUsername: s.companyUsername,
        companyPassword: s.companyPassword,
        companyDRate: parseFloat(s.companyDRate),
        companyDComm: parseFloat(s.companyDComm),
        companyARate: parseFloat(s.companyARate),
        companyAComm: parseFloat(s.companyAComm),
        companyTax: parseFloat(s.companyTax),
        companyRemark: s.companyRemark,
        roleConfigs: roleConfigs.map(rc => ({
          id: rc.id,
          shiftId: rc.shiftId,
          roleId: rc.roleId,
          openTime: rc.openTime,
          closeTime: rc.closeTime,
          isActive: rc.isActive,
        })),
        isEntryAllowedForRole: isEntryAllowed,
        timeRemainingSeconds: remainingSec,
        sortOrder: s.sortOrder,
        isTransactionTimeOver,
        hasTimeOverride,
      });
    }

    try {
      await redis.set(cacheKey, JSON.stringify(results), 'EX', 5);
    } catch (err) {
      console.warn('[Shifts] Redis cache write warning:', err);
    }

    return results;
  }

  // Called alongside publishShiftsUpdate() by any write that changes the shift list (create/
  // update/toggle/declare) so the next poll reflects it immediately instead of waiting out the
  // 5s TTL. Cache keys are per role/user, with no cheap way to enumerate every combination
  // that might have a cached entry, so this clears the whole shifts:list:* namespace — safe to
  // skip on any Redis error, same as the cache read/write above.
  static async invalidateListCache() {
    try {
      const keys = await redis.keys('shifts:list:*');
      if (keys.length > 0) await redis.del(...keys);
    } catch (err) {
      console.warn('[Shifts] Redis cache invalidate warning:', err);
    }
  }

  // Shifts page drag & drop — saves the full sequence shown in the table (first = 1). Every
  // listed shift's Updated By / Updated Date is stamped, same as the live panel, and both the
  // shift list and dashboard caches are cleared so the new sequence shows everywhere at once.
  static async reorderShifts(shiftIds: number[], updatedBy = 'A100') {
    const ids = [...new Set(shiftIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    if (ids.length === 0) throw new AppError('No shifts to reorder', 400);

    const found = await db.select({ id: shifts.id }).from(shifts).where(inArray(shifts.id, ids));
    if (found.length !== ids.length) throw new AppError('One or more shifts not found', 404);

    const now = new Date();
    await db.transaction(async (tx) => {
      for (let i = 0; i < ids.length; i++) {
        await tx.update(shifts)
          .set({ sortOrder: i + 1, updatedBy, updatedAt: now })
          .where(eq(shifts.id, ids[i]));
      }
    });

    publishShiftsUpdate();
    this.invalidateListCache();
    publishDashboardUpdate();

    return { count: ids.length };
  }

  // SUPER ADMIN-only hard delete from the Shifts page. A shift that already carries money —
  // any transaction, declaration or voucher — is refused rather than deleted, so no report,
  // ledger or P&L figure can lose its history; Deactivate remains the way to retire those.
  // A shift without any of that only has its own set-up rows (role timings, cycle history,
  // operator permissions), which are removed together with it in one transaction.
  static async deleteShift(id: number, actorUserId?: number) {
    const [existing] = await db.select().from(shifts).where(eq(shifts.id, id));
    if (!existing) throw new AppError('Shift not found', 404);

    const [tx] = await db.select({ id: transactions.id }).from(transactions).where(eq(transactions.shiftId, id)).limit(1);
    const [decl] = await db.select({ id: declarations.id }).from(declarations).where(eq(declarations.shiftId, id)).limit(1);
    const [vch] = await db.select({ id: vouchers.id }).from(vouchers).where(eq(vouchers.shiftId, id)).limit(1);
    if (tx || decl || vch) {
      const used = [tx && 'transactions', decl && 'declarations', vch && 'vouchers'].filter(Boolean).join(', ');
      throw new AppError(`Shift ${existing.name} cannot be deleted because it has ${used}. Deactivate it instead.`, 409);
    }

    await db.transaction(async (trx) => {
      await trx.delete(operatorShiftPermissions).where(eq(operatorShiftPermissions.shiftId, id));
      await trx.delete(shiftCycles).where(eq(shiftCycles.shiftId, id));
      await trx.delete(shiftRoleConfig).where(eq(shiftRoleConfig.shiftId, id));
      await trx.delete(shifts).where(eq(shifts.id, id));
      if (actorUserId) {
        await trx.insert(auditLogs).values({
          actorId: actorUserId,
          action: 'DELETE',
          entityType: 'SHIFT',
          entityId: id.toString(),
          beforeData: { name: existing.name, openDate: existing.openDate, status: existing.status, isActive: existing.isActive },
        });
      }
    });

    publishShiftsUpdate();
    this.invalidateListCache();
    publishDashboardUpdate();

    return { id, name: existing.name };
  }

  static async toggleActive(id: number) {
    const [existing] = await db.select().from(shifts).where(eq(shifts.id, id));
    if (!existing) throw new AppError('Shift not found', 404);

    const [updated] = await db.update(shifts)
      .set({ isActive: !existing.isActive, updatedAt: new Date() })
      .where(eq(shifts.id, id))
      .returning();

    publishShiftsUpdate();
    this.invalidateListCache();

    return updated;
  }

  static async assertShiftOpenForRole(shiftId: number, roleId: number, roleName: SystemRole, userId?: number) {
    if (roleName === 'DEVELOPER' || roleName === 'SUPER ADMIN') {
      return;
    }

    const [shift] = await db.select().from(shifts).where(eq(shifts.id, shiftId));

    if (!shift) {
      throw new AppError('Shift not found', 404);
    }

    if (shift.status !== 'OPEN') {
      throw new CutoffError(`Shift ${shift.name} is currently ${shift.status}`);
    }

    const [config] = await db.select().from(shiftRoleConfig).where(
      and(eq(shiftRoleConfig.shiftId, shiftId), eq(shiftRoleConfig.roleId, roleId))
    );

    if (!config || !config.isActive) {
      throw new CutoffError('No active shift timing configured for your role');
    }

    const currentTimeStr = new Date().toTimeString().slice(0, 8);
    const cycleCloseAt = this.getCycleCloseAt(shift.openDate, config.openTime, config.closeTime, shift.isNextDay);
    if (currentTimeStr < config.openTime || currentTimeStr > config.closeTime || new Date() > cycleCloseAt) {
      // Past the role's normal cutoff — the only way through is an explicit per-operator
      // override (Declare Trans Permission), which previously existed only as an admin UI +
      // DB table with nothing actually reading it back at entry time. A matching, still-valid
      // (canAllow + canAdd, not expired) row for this exact user/shift/date now lets them in.
      if (userId) {
        const now = new Date();
        const [override] = await db.select().from(operatorShiftPermissions).where(
          and(
            eq(operatorShiftPermissions.userId, userId),
            eq(operatorShiftPermissions.shiftId, shiftId),
            eq(operatorShiftPermissions.shiftDate, shift.openDate)
          )
        );
        if (override && override.canAllow && override.canAdd && (!override.expiresAt || override.expiresAt > now)) {
          return;
        }
      }
      throw new CutoffError(
        `Entry window closed for ${roleName}. Allowed: ${config.openTime} - ${config.closeTime}, Current Server Time: ${currentTimeStr}`
      );
    }
  }

  static async createShift(name: string, openDate: string, isNextDay = false, roleConfigs?: any[]) {
    const [created] = await db.insert(shifts).values({
      name: name.toUpperCase(),
      openDate,
      isNextDay,
      status: 'OPEN',
    }).returning();

    if (roleConfigs && roleConfigs.length > 0) {
      for (const rc of roleConfigs) {
        await db.insert(shiftRoleConfig).values({
          shiftId: created.id,
          roleId: rc.roleId,
          openTime: rc.openTime,
          closeTime: rc.closeTime,
          isActive: rc.isActive ?? true,
        });
      }
    } else {
      const allRoles = await db.select().from(roles);
      for (const r of allRoles) {
        await db.insert(shiftRoleConfig).values({
          shiftId: created.id,
          roleId: r.id,
          openTime: '09:00:00',
          closeTime: '20:00:00',
          isActive: true,
        });
      }
    }

    publishShiftsUpdate();
    this.invalidateListCache();

    return created;
  }

  static async updateShift(
    id: number,
    data: {
      name?: string;
      openDate?: string;
      isNextDay?: boolean;
      shiftFor?: string;
      roleConfigs?: any[];
      isActive?: boolean;
      fanterPanelTime?: string;
      mainJantriTime?: string;
      applyShiftConfig?: boolean;
      dRate?: number;
      dCommission?: number;
      aRate?: number;
      aCommission?: number;
      tax?: number;
      transactionCapping?: boolean;
      collectionRoundOff?: number;
      checkLagaiBeforeDeclare?: boolean;
      createVapsi?: boolean;
      resultWebShiftId?: number;
      autoCompanyTransactionActive?: boolean;
      companyUrl?: string;
      companyShiftId?: number;
      companyUsername?: string;
      companyPassword?: string;
      companyDRate?: number;
      companyDComm?: number;
      companyARate?: number;
      companyAComm?: number;
      companyTax?: number;
      companyRemark?: string;
    },
    updatedBy = 'A100'
  ) {
    const [existing] = await db.select().from(shifts).where(eq(shifts.id, id));
    if (!existing) throw new AppError('Shift not found', 404);

    const updatePayload: any = {
      updatedAt: new Date(),
      updatedBy,
    };

    if (data.name !== undefined && data.name.trim() !== '') {
      updatePayload.name = data.name.trim().toUpperCase();
    }
    if (data.openDate !== undefined && data.openDate.trim() !== '') {
      let formattedDate = data.openDate.trim();
      if (formattedDate.includes('-')) {
        const parts = formattedDate.split('-');
        if (parts.length === 3 && parts[0].length === 2) {
          formattedDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
        }
      }
      updatePayload.openDate = formattedDate;

      // Manually moving a shift to a different open_date is the same kind of transition the
      // nightly rollover worker performs automatically — the outgoing date's declared result
      // must be archived (not silently carried over) and the new date should start fresh,
      // otherwise the dashboard/shift card would show a stale declaredNumber attached to a
      // date it never actually belonged to.
      if (formattedDate !== existing.openDate) {
        const [existingCycle] = await db.select().from(shiftCycles).where(
          and(eq(shiftCycles.shiftId, id), eq(shiftCycles.cycleDate, existing.openDate))
        );
        if (!existingCycle) {
          await db.insert(shiftCycles).values({
            shiftId: id,
            cycleDate: existing.openDate,
            status: existing.status,
            declaredNumber: existing.declaredNumber,
          });
        }

        const [newCycle] = await db.select().from(shiftCycles).where(
          and(eq(shiftCycles.shiftId, id), eq(shiftCycles.cycleDate, formattedDate))
        );
        if (!newCycle) {
          await db.insert(shiftCycles).values({
            shiftId: id,
            cycleDate: formattedDate,
            status: 'OPEN',
            declaredNumber: null,
          });
        }

        updatePayload.status = newCycle ? newCycle.status : 'OPEN';
        updatePayload.declaredNumber = newCycle ? newCycle.declaredNumber : null;
      }
    }
    if (data.isNextDay !== undefined) {
      updatePayload.isNextDay = data.isNextDay;
    }
    if (data.shiftFor !== undefined && data.shiftFor.trim() !== '') {
      updatePayload.shiftFor = data.shiftFor.trim().toUpperCase();
    }
    if (data.isActive !== undefined) updatePayload.isActive = data.isActive;

    // Time tab (beyond the 12 per-role cut-offs, handled separately below via roleConfigs)
    if (data.fanterPanelTime !== undefined) updatePayload.fanterPanelTime = data.fanterPanelTime;
    if (data.mainJantriTime !== undefined) updatePayload.mainJantriTime = data.mainJantriTime;

    // Config tab
    if (data.applyShiftConfig !== undefined) updatePayload.applyShiftConfig = data.applyShiftConfig;
    if (data.dRate !== undefined) updatePayload.dRate = data.dRate.toFixed(2);
    if (data.dCommission !== undefined) updatePayload.dCommission = data.dCommission.toFixed(2);
    if (data.aRate !== undefined) updatePayload.aRate = data.aRate.toFixed(2);
    if (data.aCommission !== undefined) updatePayload.aCommission = data.aCommission.toFixed(2);
    if (data.tax !== undefined) updatePayload.tax = data.tax.toFixed(2);
    if (data.transactionCapping !== undefined) updatePayload.transactionCapping = data.transactionCapping;
    if (data.collectionRoundOff !== undefined) updatePayload.collectionRoundOff = data.collectionRoundOff.toFixed(2);
    if (data.checkLagaiBeforeDeclare !== undefined) updatePayload.checkLagaiBeforeDeclare = data.checkLagaiBeforeDeclare;
    if (data.createVapsi !== undefined) updatePayload.createVapsi = data.createVapsi;
    if (data.resultWebShiftId !== undefined) updatePayload.resultWebShiftId = data.resultWebShiftId;

    // Company Config tab
    if (data.autoCompanyTransactionActive !== undefined) updatePayload.autoCompanyTransactionActive = data.autoCompanyTransactionActive;
    if (data.companyUrl !== undefined) updatePayload.companyUrl = data.companyUrl;
    if (data.companyShiftId !== undefined) updatePayload.companyShiftId = data.companyShiftId;
    if (data.companyUsername !== undefined) updatePayload.companyUsername = data.companyUsername;
    if (data.companyPassword !== undefined) updatePayload.companyPassword = data.companyPassword;
    if (data.companyDRate !== undefined) updatePayload.companyDRate = data.companyDRate.toFixed(2);
    if (data.companyDComm !== undefined) updatePayload.companyDComm = data.companyDComm.toFixed(2);
    if (data.companyARate !== undefined) updatePayload.companyARate = data.companyARate.toFixed(2);
    if (data.companyAComm !== undefined) updatePayload.companyAComm = data.companyAComm.toFixed(2);
    if (data.companyTax !== undefined) updatePayload.companyTax = data.companyTax.toFixed(2);
    if (data.companyRemark !== undefined) updatePayload.companyRemark = data.companyRemark;

    const [updated] = await db
      .update(shifts)
      .set(updatePayload)
      .where(eq(shifts.id, id))
      .returning();

    if (data.roleConfigs && data.roleConfigs.length > 0) {
      for (const rc of data.roleConfigs) {
        const [existingRc] = await db
          .select()
          .from(shiftRoleConfig)
          .where(and(eq(shiftRoleConfig.shiftId, id), eq(shiftRoleConfig.roleId, rc.roleId)));

        if (existingRc) {
          await db
            .update(shiftRoleConfig)
            .set({
              closeTime: rc.closeTime,
              openTime: rc.openTime || existingRc.openTime,
              isActive: rc.isActive !== undefined ? rc.isActive : existingRc.isActive,
            })
            .where(eq(shiftRoleConfig.id, existingRc.id));
        } else {
          await db.insert(shiftRoleConfig).values({
            shiftId: id,
            roleId: rc.roleId,
            openTime: rc.openTime || '09:00:00',
            closeTime: rc.closeTime || '20:44:00',
            isActive: rc.isActive ?? true,
          });
        }
      }
    }

    publishShiftsUpdate();
    this.invalidateListCache();

    return updated;
  }

  static async listOperators() {
    return await db.select({
      userId: users.id,
      username: users.username,
      fullName: staff.fullName,
      designation: staff.designation,
      roleName: roles.name,
    })
    .from(users)
    .leftJoin(staff, eq(users.id, staff.userId))
    .leftJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.isActive, true))
    .orderBy(users.username);
  }

  static async getOperatorPermissions(userId: number) {
    return await db.select()
      .from(operatorShiftPermissions)
      .where(eq(operatorShiftPermissions.userId, userId));
  }

  static async saveOperatorPermissions(userId: number, permissions: Array<{
    shiftId: number;
    shiftDate: string;
    canAllow: boolean;
    canAdd: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canExport: boolean;
    dataScope: string;
    expiresAt?: string | null;
  }>) {
    for (const p of permissions) {
      const [existing] = await db.select()
        .from(operatorShiftPermissions)
        .where(and(eq(operatorShiftPermissions.userId, userId), eq(operatorShiftPermissions.shiftId, p.shiftId)));

      const expDate = p.expiresAt ? new Date(p.expiresAt) : null;

      if (existing) {
        await db.update(operatorShiftPermissions).set({
          shiftDate: p.shiftDate,
          canAllow: p.canAllow,
          canAdd: p.canAdd,
          canEdit: p.canEdit,
          canDelete: p.canDelete,
          canExport: p.canExport,
          dataScope: p.dataScope || 'SELF',
          expiresAt: expDate,
        }).where(eq(operatorShiftPermissions.id, existing.id));
      } else {
        await db.insert(operatorShiftPermissions).values({
          userId,
          shiftId: p.shiftId,
          shiftDate: p.shiftDate,
          canAllow: p.canAllow,
          canAdd: p.canAdd,
          canEdit: p.canEdit,
          canDelete: p.canDelete,
          canExport: p.canExport,
          dataScope: p.dataScope || 'SELF',
          expiresAt: expDate,
        });
      }
    }
    return { message: 'Operator permissions saved successfully' };
  }
}

