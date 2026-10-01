import { Request, Response, NextFunction } from 'express';
import { db, blockedIps } from '@pb/database';
import { eq } from 'drizzle-orm';
import { AppError } from '../common/errors.js';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { isRedirectIp } from './inactive-redirect.js';

const blockedIpCache = new Set<string>();
// IP → auto-unblock time for temporary blocks (LOGIN_BLOCK_MINUTES > 0)
const blockExpiry = new Map<string, number>();
let lastCacheRefresh = 0;

// A fresh block (login guard) or unblock (Access Block → Delete) takes effect on the next
// request instead of waiting for the 60s cache refresh.
export function markIpBlocked(ip: string) {
  blockedIpCache.add(ip);
}
export function invalidateBlockedCache() {
  lastCacheRefresh = 0;
}

async function refreshBlockedCache() {
  const now = Date.now();
  if (now - lastCacheRefresh < 60000) return;

  try {
    const list = await db.select().from(blockedIps).where(eq(blockedIps.isActive, true));
    blockedIpCache.clear();
    blockExpiry.clear();
    for (const item of list) {
      if (item.expiresAt && item.expiresAt.getTime() <= now) {
        // Temporary block has run out — lift it.
        await db.update(blockedIps).set({ isActive: false, unblockedAt: new Date(), updatedAt: new Date() })
          .where(eq(blockedIps.id, item.id)).catch(() => {});
        continue;
      }
      blockedIpCache.add(item.ipAddress);
      if (item.expiresAt) blockExpiry.set(item.ipAddress, item.expiresAt.getTime());
    }
    lastCacheRefresh = now;
  } catch (err) {
    console.warn('[IPBlock] Failed to refresh blocked IPs cache:', err);
  }
}

export function extractClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const raw = typeof forwarded === 'string'
    ? forwarded.split(',')[0].trim()
    : (req.socket.remoteAddress || '127.0.0.1');
  // "::ffff:1.2.3.4" (IPv4 seen through an IPv6 socket) is the same client as "1.2.3.4".
  return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
}

export async function checkIpBlocked(req: Request, res: Response, next: NextFunction) {
  const clientIp = extractClientIp(req);
  await refreshBlockedCache();

  if (blockedIpCache.has(clientIp)) {
    const until = blockExpiry.get(clientIp);
    if (until && until <= Date.now()) {
      invalidateBlockedCache();
    } else {
      // code IP_BLOCKED: the web app swaps the whole screen for its "access blocked" page.
      return next(new AppError(`Your IP address (${clientIp}) is blocked by the administrator.`, 403, 'IP_BLOCKED'));
    }
  }

  // An IP an inactive staff member tried to sign in from: the app is sent to Google (code
  // IP_REDIRECT). A request carrying a valid session token (someone already signed in on that
  // IP) is let through, so an admin sharing the IP isn't locked out mid-session.
  if (await isRedirectIp(clientIp)) {
    const auth = req.headers.authorization;
    let signedIn = false;
    if (auth && auth.startsWith('Bearer ')) {
      try {
        jwt.verify(auth.slice(7), env.JWT_SECRET);
        signedIn = true;
      } catch {
        signedIn = false;
      }
    }
    if (!signedIn) {
      return next(new AppError('Redirect', 403, 'IP_REDIRECT'));
    }
  }

  next();
}
