import { db, auditLogs, transactions } from '@pb/database';
import { eq, and, desc } from 'drizzle-orm';
import { UserSession } from '@pb/types';

export class AuditService {
  static async listLogs(filters: { entityType?: string; entityId?: string; actorId?: number }) {
    const conditions = [];
    if (filters.entityType) conditions.push(eq(auditLogs.entityType, filters.entityType));
    if (filters.entityId) conditions.push(eq(auditLogs.entityId, filters.entityId));
    if (filters.actorId) conditions.push(eq(auditLogs.actorId, filters.actorId));

    return await db.select()
      .from(auditLogs)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(auditLogs.createdAt))
      .limit(100);
  }

  static async verifyTransaction(transactionId: number, user: UserSession) {
    const [updated] = await db.update(transactions)
      .set({ isAudited: true })
      .where(eq(transactions.id, transactionId))
      .returning();

    await db.insert(auditLogs).values({
      actorId: user.userId,
      action: 'AUDIT_VERIFY',
      entityType: 'TRANSACTION',
      entityId: transactionId.toString(),
      afterData: { isAudited: true },
    });

    return updated;
  }
}
