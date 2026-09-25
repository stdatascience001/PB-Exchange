import { db, staff, staffAssets, users, roles } from '@pb/database';
import { eq, asc, desc, sql } from 'drizzle-orm';
import { AppError } from '../../common/errors.js';
import { hashPassword } from '../auth/auth.service.js';

export class StaffService {
  private static async getOrCreateRoleId(roleName: string): Promise<number> {
    const cleanRole = (roleName || 'ADMIN').trim().toUpperCase();
    const [role] = await db.select().from(roles).where(
      sql`UPPER(${roles.name}) = UPPER(${cleanRole})`
    );
    if (role) return role.id;

    // Fallback: try ADMIN
    const [adminRole] = await db.select().from(roles).where(
      sql`UPPER(${roles.name}) = 'ADMIN'`
    );
    if (adminRole) return adminRole.id;

    // Fallback: first role
    const [first] = await db.select().from(roles).limit(1);
    return first?.id || 1;
  }

  static async listStaff() {
    const [staffList, allAssets] = await Promise.all([
      db.select().from(staff).orderBy(asc(staff.id)),
      db.select().from(staffAssets).orderBy(desc(staffAssets.id)),
    ]);

    const assetsByStaff = new Map<number, typeof allAssets>();
    for (const a of allAssets) {
      if (!assetsByStaff.has(a.staffId)) {
        assetsByStaff.set(a.staffId, []);
      }
      assetsByStaff.get(a.staffId)!.push(a);
    }

    return staffList.map(s => {
      const sAssets = assetsByStaff.get(s.id) || [];
      const hasActiveAssets = sAssets.some(a => a.type === 'Issue' && !a.returnDate);
      const salaryNum = parseFloat(s.monthlySalary || '0');

      return {
        id: s.id,
        userId: s.userId,
        fullName: s.fullName,
        partyName: s.fullName,
        role: s.role || s.designation,
        designation: s.role || s.designation,
        username: s.username || 'NONE',
        wMode: s.wMode || 'NONE',
        mobile: s.mobile || '',
        address: s.address || '',
        agent: s.agent || '',
        isActive: s.isActive ?? true,
        updatedBy: s.updatedBy || 'A100',
        updatedAt: s.updatedAt ? s.updatedAt.toISOString() : s.createdAt.toISOString(),
        monthlySalary: salaryNum,
        salaryStructure: s.salaryStructure || { earnings: [], deductions: [] },
        hasSalary: salaryNum > 0,
        hasAssets: hasActiveAssets,
        isWorkingLive: s.isWorkingLive,
        assignedStation: s.assignedStation,
        createdAt: s.createdAt.toISOString(),
        assets: sAssets.map(a => ({
          ...a,
          amount: parseFloat(a.amount || '0'),
          assignedDate: a.assignedDate.toISOString(),
          returnDate: a.returnDate ? a.returnDate.toISOString() : null,
          createdAt: a.createdAt.toISOString(),
        })),
      };
    });
  }



  static async createStaff(data: {
    fullName: string;
    role?: string;
    designation?: string;
    username?: string;
    password?: string;
    wMode?: string;
    mobile?: string;
    address?: string;
    agent?: string;
    isActive?: boolean;
    updatedBy?: string;
    monthlySalary?: number;
    assignedStation?: string;
  }) {
    const roleStr = data.role || data.designation || 'ADMIN';
    const roleId = await this.getOrCreateRoleId(roleStr);

    // Determine target username for login
    const targetUsername = data.username && data.username.trim() && data.username.trim().toUpperCase() !== 'NONE'
      ? data.username.trim()
      : data.fullName.trim();

    const plainPassword = data.password && data.password.trim() ? data.password.trim() : '123456';
    const pHash = hashPassword(plainPassword);
    const active = data.isActive !== undefined ? data.isActive : true;

    // Check if user already exists in `users` table
    let userId: number;
    const [existingUser] = await db.select().from(users).where(
      sql`LOWER(${users.username}) = LOWER(${targetUsername})`
    );

    if (existingUser) {
      await db.update(users).set({
        passwordHash: pHash,
        roleId,
        isActive: active,
      }).where(eq(users.id, existingUser.id));
      userId = existingUser.id;
    } else {
      const [newUser] = await db.insert(users).values({
        username: targetUsername,
        passwordHash: pHash,
        roleId,
        isActive: active,
      }).returning();
      userId = newUser.id;
    }

    const [created] = await db.insert(staff).values({
      userId,
      fullName: data.fullName.trim(),
      role: roleStr.trim().toUpperCase(),
      designation: roleStr.trim().toUpperCase(),
      username: targetUsername,
      password: plainPassword,
      wMode: data.wMode ? data.wMode.trim().toUpperCase() : 'NONE',
      mobile: data.mobile ? data.mobile.trim() : '',
      address: data.address ? data.address.trim() : '',
      agent: data.agent ? data.agent.trim() : '',
      isActive: active,
      updatedBy: data.updatedBy || 'SUPER ADMIN',
      updatedAt: new Date(),
      monthlySalary: (data.monthlySalary ?? 0).toString(),
      assignedStation: data.assignedStation || data.fullName.trim(),
      isWorkingLive: true,
    }).returning();

    return created;
  }

  static async updateStaff(id: number, data: {
    fullName?: string;
    role?: string;
    designation?: string;
    username?: string;
    password?: string;
    wMode?: string;
    mobile?: string;
    address?: string;
    agent?: string;
    isActive?: boolean;
    updatedBy?: string;
  }) {
    const [existingStaff] = await db.select().from(staff).where(eq(staff.id, id));
    if (!existingStaff) {
      throw new AppError('Staff member not found', 404);
    }

    const roleStr = data.role || data.designation || existingStaff.role || 'ADMIN';
    const roleId = await this.getOrCreateRoleId(roleStr);

    const targetUsername: string = data.username && data.username.trim() && data.username.trim().toUpperCase() !== 'NONE'
      ? data.username.trim()
      : (data.fullName ? data.fullName.trim() : (existingStaff.username || existingStaff.fullName || 'STAFF_USER'));

    const plainPassword = data.password && data.password.trim() ? data.password.trim() : (existingStaff.password || '123456');
    const pHash = hashPassword(plainPassword);
    const active = data.isActive !== undefined ? data.isActive : existingStaff.isActive;

    // Sync or create user in `users` table
    let userId = existingStaff.userId;
    const [userRecord] = await db.select().from(users).where(
      sql`id = ${userId} OR LOWER(${users.username}) = LOWER(${targetUsername})`
    );

    if (userRecord) {
      await db.update(users).set({
        username: targetUsername,
        passwordHash: pHash,
        roleId,
        isActive: active,
      }).where(eq(users.id, userRecord.id));
      userId = userRecord.id;
    } else {
      const [newUser] = await db.insert(users).values({
        username: targetUsername,
        passwordHash: pHash,
        roleId,
        isActive: active,
      }).returning();
      userId = newUser.id;
    }

    const toUpdate: Record<string, any> = {
      userId,
      role: roleStr.trim().toUpperCase(),
      designation: roleStr.trim().toUpperCase(),
      username: targetUsername,
      password: plainPassword,
      updatedAt: new Date(),
    };
    if (data.fullName !== undefined) {
      toUpdate.fullName = data.fullName.trim();
    }
    if (data.wMode !== undefined) {
      toUpdate.wMode = data.wMode.trim().toUpperCase();
    }
    if (data.mobile !== undefined) {
      toUpdate.mobile = data.mobile.trim();
    }
    if (data.address !== undefined) {
      toUpdate.address = data.address.trim();
    }
    if (data.agent !== undefined) {
      toUpdate.agent = data.agent.trim();
    }
    if (data.isActive !== undefined) {
      toUpdate.isActive = data.isActive;
    }
    if (data.updatedBy !== undefined) {
      toUpdate.updatedBy = data.updatedBy;
    }

    const [updated] = await db.update(staff)
      .set(toUpdate)
      .where(eq(staff.id, id))
      .returning();

    return updated;
  }

  static async toggleActive(id: number, updatedBy?: string) {
    const [existing] = await db.select().from(staff).where(eq(staff.id, id));
    if (!existing) {
      throw new AppError('Staff member not found', 404);
    }
    const newActive = !existing.isActive;
    const [updated] = await db.update(staff)
      .set({
        isActive: newActive,
        updatedBy: updatedBy || 'SUPER ADMIN',
        updatedAt: new Date(),
      })
      .where(eq(staff.id, id))
      .returning();

    // Also toggle active in users table
    if (existing.userId) {
      await db.update(users)
        .set({ isActive: newActive })
        .where(eq(users.id, existing.userId))
        .catch(() => {});
    }
    if (existing.username && existing.username !== 'NONE') {
      await db.update(users)
        .set({ isActive: newActive })
        .where(sql`LOWER(${users.username}) = LOWER(${existing.username})`)
        .catch(() => {});
    }

    return updated;
  }

  static async deleteStaff(id: number) {
    const [existing] = await db.select().from(staff).where(eq(staff.id, id));
    if (existing) {
      if (existing.userId && existing.userId !== 1) {
        await db.delete(users).where(eq(users.id, existing.userId)).catch(() => {});
      }
      await db.delete(staff).where(eq(staff.id, id));
    }
    return { success: true };
  }

  static async updateWorkingStatus(staffId: number, isWorkingLive: boolean) {
    const [updated] = await db.update(staff)
      .set({ isWorkingLive, updatedAt: new Date() })
      .where(eq(staff.id, staffId))
      .returning();
    return updated;
  }

  static async heartbeat(userId: number, username: string, roleName?: string) {
    const cleanUsername = (username || '').trim();
    const [existing] = await db.select().from(staff).where(
      sql`user_id = ${userId} OR LOWER(username) = LOWER(${cleanUsername})`
    );

    if (existing) {
      const [updated] = await db.update(staff).set({
        isWorkingLive: true,
        updatedAt: new Date(),
      }).where(eq(staff.id, existing.id)).returning();
      return updated;
    } else {
      const roleStr = roleName || 'SUPER ADMIN';
      const [created] = await db.insert(staff).values({
        userId,
        fullName: cleanUsername.toUpperCase() || 'SUPER ADMIN',
        role: roleStr.toUpperCase(),
        designation: roleStr.toUpperCase(),
        username: cleanUsername.toUpperCase(),
        wMode: 'COMMAN',
        isActive: true,
        isWorkingLive: true,
        updatedBy: cleanUsername.toUpperCase(),
        assignedStation: cleanUsername.toUpperCase(),
        updatedAt: new Date(),
      }).returning().catch(() => [null]);
      return created;
    }
  }

  static async listAssets() {
    const list = await db.select({
      id: staffAssets.id,
      staffId: staffAssets.staffId,
      staffName: staff.fullName,
      partyName: staff.fullName,
      assetName: staffAssets.assetName,
      amount: staffAssets.amount,
      type: staffAssets.type,
      brand: staffAssets.brand,
      serialNumber: staffAssets.serialNumber,
      remark: staffAssets.remark,
      assignedDate: staffAssets.assignedDate,
      returnDate: staffAssets.returnDate,
      notes: staffAssets.notes,
      updatedBy: staffAssets.updatedBy,
      createdAt: staffAssets.createdAt,
      monthlySalary: staff.monthlySalary,
      designation: staff.designation,
    })
    .from(staffAssets)
    .leftJoin(staff, eq(staffAssets.staffId, staff.id))
    .orderBy(desc(staffAssets.id));

    return list.map(a => ({
      ...a,
      amount: parseFloat(a.amount || '0'),
      monthlySalary: parseFloat(a.monthlySalary || '0'),
      assignedDate: a.assignedDate.toISOString(),
      returnDate: a.returnDate ? a.returnDate.toISOString() : null,
      createdAt: a.createdAt.toISOString(),
    }));
  }

  static async createAsset(data: {
    staffId: number;
    assetName: string;
    amount?: number;
    type?: string;
    brand?: string;
    serialNumber?: string;
    remark?: string;
    notes?: string;
    updatedBy?: string;
  }) {
    const isReturn = (data.type || '').toUpperCase() === 'RETURN';
    const [created] = await db.insert(staffAssets).values({
      staffId: data.staffId,
      assetName: (data.assetName || 'LAPTOP').trim().toUpperCase(),
      amount: (data.amount ?? 0).toString(),
      type: isReturn ? 'Return' : 'Issue',
      brand: (data.brand || '').trim().toUpperCase(),
      serialNumber: (data.serialNumber || '').trim().toUpperCase(),
      remark: (data.remark || data.notes || '').trim(),
      notes: (data.remark || data.notes || '').trim(),
      returnDate: isReturn ? new Date() : null,
      updatedBy: data.updatedBy || 'A100',
    }).returning();
    return created;
  }

  static async deleteAsset(id: number) {
    const [deleted] = await db.delete(staffAssets).where(eq(staffAssets.id, id)).returning();
    if (!deleted) throw new AppError('Asset record not found', 404);
    return deleted;
  }

  static async updateSalary(staffId: number, monthlySalary: number, updatedBy?: string) {
    const [updated] = await db.update(staff)
      .set({
        monthlySalary: monthlySalary.toString(),
        updatedBy: updatedBy || 'A100',
        updatedAt: new Date(),
      })
      .where(eq(staff.id, staffId))
      .returning();
    if (!updated) throw new AppError('Staff member not found', 404);
    return updated;
  }

  static async updateSalaryStructure(staffId: number, data: {
    earnings?: Array<{ item: string; amount: number; type: string }>;
    deductions?: Array<{ item: string; amount: number; type: string }>;
  }, updatedBy?: string) {
    const earnings = Array.isArray(data.earnings) ? data.earnings : [];
    const deductions = Array.isArray(data.deductions) ? data.deductions : [];

    // Base salary is the sum of earnings of type AMOUNT (or explicitly BASE SALARY)
    let totalBaseSalary = 0;
    for (const e of earnings) {
      if (e.type === 'AMOUNT' || e.item === 'BASE SALARY') {
        totalBaseSalary += Number(e.amount) || 0;
      }
    }

    const [updated] = await db.update(staff)
      .set({
        monthlySalary: totalBaseSalary.toString(),
        salaryStructure: { earnings, deductions },
        updatedBy: updatedBy || 'A100',
        updatedAt: new Date(),
      })
      .where(eq(staff.id, staffId))
      .returning();

    if (!updated) throw new AppError('Staff member not found', 404);
    return updated;
  }
}


