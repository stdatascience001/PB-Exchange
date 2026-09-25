import { db, blockedIps } from '@pb/database';
import { eq, desc } from 'drizzle-orm';
import { AppError } from '../../common/errors.js';

export class AccessControlService {
  static async listBlockedIps() {
    return await db.select()
      .from(blockedIps)
      .where(eq(blockedIps.isActive, true))
      .orderBy(desc(blockedIps.createdAt));
  }

  static async blockIp(ipAddress: string, reason: string | undefined, blockedBy: number) {
    const [existing] = await db.select().from(blockedIps).where(eq(blockedIps.ipAddress, ipAddress));

    if (existing) {
      if (existing.isActive) {
        throw new AppError('IP address is already blocked', 400);
      }
      const [updated] = await db.update(blockedIps)
        .set({ isActive: true, reason, blockedBy, unblockedAt: null })
        .where(eq(blockedIps.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await db.insert(blockedIps)
      .values({ ipAddress, reason, blockedBy, isActive: true })
      .returning();
    return created;
  }

  static async unblockIp(id: number) {
    const [updated] = await db.update(blockedIps)
      .set({ isActive: false, unblockedAt: new Date() })
      .where(eq(blockedIps.id, id))
      .returning();
    return updated;
  }
}
