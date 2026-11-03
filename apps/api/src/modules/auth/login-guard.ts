import { db, blockedIps, users } from '@pb/database';
import { eq, sql } from 'drizzle-orm';
import { AppError } from '../../common/errors.js';
import { markIpBlocked } from '../../middleware/ip-block.middleware.js';

// Login security: 3 wrong logins in a row from one IP blocks that IP (blocked_ips), and the
// global IP gate then refuses every request from it — login page included — until an admin
// deletes it on Access Block (the live list keeps blocks from years back), or, when
// LOGIN_BLOCK_MINUTES is set above 0, until that many minutes have passed.
export const MAX_LOGIN_ATTEMPTS = 3;
const BLOCK_MINUTES = Math.max(0, parseInt(process.env.LOGIN_BLOCK_MINUTES || '0', 10) || 0);
// A streak of failures older than this is forgotten (a typo today, another next week ≠ 3 in a row).
const STREAK_RESET_MS = 30 * 60 * 1000;

const failures = new Map<string, { count: number; lastAt: number }>();

export function blockedMessage(ip: string) {
  return `Your IP address (${ip}) has been blocked due to ${MAX_LOGIN_ATTEMPTS} wrong login attempts. Please contact the administrator.`;
}

export function clearLoginFailures(ip: string) {
  failures.delete(ip);
}

// Records one wrong login. Returns how many tries are left, or throws IP_BLOCKED on the 3rd.
export async function registerLoginFailure(ip: string, attemptedUsername: string): Promise<number> {
  const now = Date.now();
  const prev = failures.get(ip);
  const count = prev && now - prev.lastAt < STREAK_RESET_MS ? prev.count + 1 : 1;
  failures.set(ip, { count, lastAt: now });
  if (count < MAX_LOGIN_ATTEMPTS) return MAX_LOGIN_ATTEMPTS - count;

  failures.delete(ip);
  // Party / Added By: the username that was tried when it's a real account (live "65060037"),
  // otherwise "-" / SYSTEM.
  const name = (attemptedUsername || '').trim();
  const [user] = name
    ? await db.select({ username: users.username }).from(users).where(sql`LOWER(${users.username}) = LOWER(${name})`)
    : [];
  const partyName = user?.username || '-';
  const addedBy = user?.username || 'SYSTEM';
  const expiresAt = BLOCK_MINUTES > 0 ? new Date(now + BLOCK_MINUTES * 60 * 1000) : null;
  const reason = `${MAX_LOGIN_ATTEMPTS} wrong login attempts${name ? ` (username: ${name})` : ''}`;

  const [existing] = await db.select({ id: blockedIps.id }).from(blockedIps).where(eq(blockedIps.ipAddress, ip));
  if (existing) {
    await db.update(blockedIps).set({
      isActive: true, reason, partyName, updatedBy: addedBy, updatedAt: new Date(), unblockedAt: null, expiresAt,
    }).where(eq(blockedIps.id, existing.id));
  } else {
    await db.insert(blockedIps).values({
      ipAddress: ip, reason, blockedBy: null, isActive: true, partyName, addedBy, updatedBy: addedBy, expiresAt,
    });
  }
  markIpBlocked(ip);
  throw new AppError(blockedMessage(ip), 403, 'IP_BLOCKED');
}

// Per-username guard (any IP): the IP block above stops one address, this stops guessing one
// account's password from many addresses. USERNAME_MAX_FAILURES wrong logins for a username
// within STREAK_RESET_MS lock that username for USERNAME_LOCK_MINUTES; a right login clears it.
const USERNAME_MAX_FAILURES = 10;
const USERNAME_LOCK_MINUTES = 15;
const usernameFailures = new Map<string, { count: number; lastAt: number; lockedUntil?: number }>();

const usernameKey = (username: string) => (username || '').trim().toLowerCase();

export function assertUsernameNotLocked(username: string) {
  const entry = usernameFailures.get(usernameKey(username));
  if (entry?.lockedUntil && entry.lockedUntil > Date.now()) {
    const minutes = Math.ceil((entry.lockedUntil - Date.now()) / 60000);
    throw new AppError(
      `Too many wrong login attempts for this account. Please try again after ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      429,
      'ACCOUNT_LOCKED'
    );
  }
}

export function registerUsernameFailure(username: string) {
  const key = usernameKey(username);
  if (!key) return;
  const now = Date.now();
  const prev = usernameFailures.get(key);
  const count = prev && now - prev.lastAt < STREAK_RESET_MS && !(prev.lockedUntil && prev.lockedUntil <= now) ? prev.count + 1 : 1;
  usernameFailures.set(key, {
    count,
    lastAt: now,
    lockedUntil: count >= USERNAME_MAX_FAILURES ? now + USERNAME_LOCK_MINUTES * 60 * 1000 : undefined,
  });
  if (usernameFailures.size > 50000) usernameFailures.clear();
}

export function clearUsernameFailures(username: string) {
  usernameFailures.delete(usernameKey(username));
}
