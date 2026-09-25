import { Request, Response, NextFunction } from 'express';
import { db, blockedIps } from '@pb/database';
import { eq } from 'drizzle-orm';
import { ForbiddenError } from '../common/errors.js';

const blockedIpCache = new Set<string>();
let lastCacheRefresh = 0;

async function refreshBlockedCache() {
  const now = Date.now();
  if (now - lastCacheRefresh < 60000) return;

  try {
    const list = await db.select().from(blockedIps).where(eq(blockedIps.isActive, true));
    blockedIpCache.clear();
    for (const item of list) {
      blockedIpCache.add(item.ipAddress);
    }
    lastCacheRefresh = now;
  } catch (err) {
    console.warn('[IPBlock] Failed to refresh blocked IPs cache:', err);
  }
}

export function extractClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || '127.0.0.1';
}

export async function checkIpBlocked(req: Request, res: Response, next: NextFunction) {
  const clientIp = extractClientIp(req);
  await refreshBlockedCache();

  if (blockedIpCache.has(clientIp)) {
    return next(new ForbiddenError(`Your IP address (${clientIp}) is blocked by the administrator.`));
  }

  next();
}
