import { db, roles, roleMessages } from '@pb/database';
import { eq } from 'drizzle-orm';
import { AppError } from '../../common/errors.js';

export class MessageService {
  static async listRoles() {
    const list = await db.select().from(roles).orderBy(roles.id);
    return list;
  }

  // One row per role, left-joined so a role with no message yet still shows up with blanks.
  static async listRoleMessages() {
    const rows = await db.select({
      roleId: roles.id,
      roleName: roles.name,
      message: roleMessages.message,
      flashMessage: roleMessages.flashMessage,
      updatedBy: roleMessages.updatedBy,
      updatedAt: roleMessages.updatedAt,
    })
      .from(roles)
      .leftJoin(roleMessages, eq(roleMessages.roleId, roles.id))
      .orderBy(roles.id);

    return rows.map(r => ({
      roleId: r.roleId,
      roleName: r.roleName,
      message: r.message || '',
      flashMessage: r.flashMessage || '',
      updatedBy: r.updatedBy || null,
      updatedAt: r.updatedAt ? r.updatedAt.toISOString() : null,
    }));
  }

  // Scoped to the logged-in user's own role — powers the dashboard notice banner
  // (message) and the one-time login pop-up (flashMessage).
  static async getMyMessage(roleId: number) {
    const [row] = await db.select({
      message: roleMessages.message,
      flashMessage: roleMessages.flashMessage,
      updatedAt: roleMessages.updatedAt,
    }).from(roleMessages).where(eq(roleMessages.roleId, roleId));

    return {
      message: row?.message || '',
      flashMessage: row?.flashMessage || '',
      updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
    };
  }

  static async updateRoleMessage(roleId: number, field: 'message' | 'flashMessage', value: string, updatedBy: string) {
    const [role] = await db.select().from(roles).where(eq(roles.id, roleId));
    if (!role) throw new AppError('Role not found', 404);

    const [existing] = await db.select().from(roleMessages).where(eq(roleMessages.roleId, roleId));

    if (existing) {
      const [updated] = await db.update(roleMessages).set({
        [field]: value,
        updatedBy,
        updatedAt: new Date(),
      }).where(eq(roleMessages.roleId, roleId)).returning();
      return updated;
    }

    const [created] = await db.insert(roleMessages).values({
      roleId,
      message: field === 'message' ? value : '',
      flashMessage: field === 'flashMessage' ? value : '',
      updatedBy,
    }).returning();
    return created;
  }
}
