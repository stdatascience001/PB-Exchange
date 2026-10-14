import { db, blockedIps } from '@pb/database';
import { eq, desc } from 'drizzle-orm';
import { AppError } from '../../common/errors.js';
import { invalidateBlockedCache, markIpBlocked } from '../../middleware/ip-block.middleware.js';
import { clearLoginFailures } from '../auth/login-guard.js';

export class AccessControlService {
  static async listBlockedIps() {
    return await db.select()
      .from(blockedIps)
      .where(eq(blockedIps.isActive, true))
      .orderBy(desc(blockedIps.createdAt));
  }

  static async blockIp(ipAddress: string, reason: string | undefined, blockedBy: number, byName = 'SYSTEM') {
    const [existing] = await db.select().from(blockedIps).where(eq(blockedIps.ipAddress, ipAddress));

    if (existing) {
      if (existing.isActive) {
        throw new AppError('IP address is already blocked', 400);
      }
      const [updated] = await db.update(blockedIps)
        .set({ isActive: true, reason, blockedBy, unblockedAt: null, updatedBy: byName, updatedAt: new Date(), expiresAt: null })
        .where(eq(blockedIps.id, existing.id))
        .returning();
      markIpBlocked(ipAddress);
      return updated;
    }

    const [created] = await db.insert(blockedIps)
      .values({ ipAddress, reason, blockedBy, isActive: true, addedBy: byName, updatedBy: byName })
      .returning();
    markIpBlocked(ipAddress);
    return created;
  }

  static async unblockIp(id: number, byName?: string) {
    const [updated] = await db.update(blockedIps)
      .set({ isActive: false, unblockedAt: new Date(), updatedAt: new Date(), ...(byName ? { updatedBy: byName } : {}) })
      .where(eq(blockedIps.id, id))
      .returning();
    if (!updated) throw new AppError('Blocked IP not found', 404);
    // Let the unblocked IP in straight away rather than after the gate's 60s cache, and start
    // its wrong-login count afresh (a single typo must not re-block it at once).
    invalidateBlockedCache();
    clearLoginFailures(updated.ipAddress);
    return updated;
  }
}
