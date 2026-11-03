import { db, users, roles, staff } from '@pb/database';
import { eq, sql } from 'drizzle-orm';
import crypto from 'crypto';
import { promisify } from 'util';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { UnauthorizedError, AppError } from '../../common/errors.js';
import { addRedirectIp } from '../../middleware/inactive-redirect.js';
import { UserSession, SystemRole, CaptchaData } from '@pb/types';
import {
  registerLoginFailure, clearLoginFailures,
  assertUsernameNotLocked, registerUsernameFailure, clearUsernameFailures,
} from './login-guard.js';
import { createSession } from './session-store.js';

const captchaStore = new Map<string, { answer: string; expiresAt: number }>();
const CAPTCHA_TTL_MS = 120000;
const CAPTCHA_STORE_MAX = 50000;

// Passwords: PBKDF2-SHA512 with 210,000 iterations (OWASP), stored as
// "pbkdf2_sha512$<iterations>$<salt>$<hash>", computed off the event loop. Older stored forms
// still sign in — "salt:hash" (1,000 iterations) and plain text — and are re-hashed to the new
// form on that user's next successful login (see needsRehash).
const PBKDF2_ITERATIONS = 210000;
const HASH_PREFIX = 'pbkdf2_sha512$';
const pbkdf2 = promisify(crypto.pbkdf2);

async function derive(password: string, salt: string, iterations: number): Promise<string> {
  return (await pbkdf2(password, salt, iterations, 64, 'sha512')).toString('hex');
}

function sameText(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${HASH_PREFIX}${PBKDF2_ITERATIONS}$${salt}$${await derive(password, salt, PBKDF2_ITERATIONS)}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (!storedHash) return false;
  if (storedHash.startsWith(HASH_PREFIX)) {
    const [, iter, salt, hash] = storedHash.split('$');
    const iterations = parseInt(iter, 10);
    if (!iterations || !salt || !hash) return false;
    return sameText(await derive(password, salt, iterations), hash);
  }
  if (storedHash.includes(':')) {
    const [salt, hash] = storedHash.split(':');
    return sameText(await derive(password, salt, 1000), hash);
  }
  // Fallback for direct match if stored as plain text
  return sameText(password, storedHash);
}

// A stored hash in an older / weaker form (re-hashed after a successful login)
export function needsRehash(storedHash: string): boolean {
  if (!storedHash.startsWith(HASH_PREFIX)) return true;
  return parseInt(storedHash.split('$')[1], 10) < PBKDF2_ITERATIONS;
}

// Strong password rule (same as the Staffs page and the Android app): at least 8 characters,
// with at least 1 number and at least 1 letter.
export const WEAK_PASSWORD_MESSAGE =
  'Password must be at least 8 characters, with at least 1 number and at least 1 letter';
export function isStrongPassword(pw: string): boolean {
  return pw.length >= 8 && /\d/.test(pw) && /[A-Za-z]/.test(pw);
}

// A login lasts 8 hours
export const TOKEN_EXPIRES_IN = '8h';

export class AuthService {
  // Randomly picks one of 4 challenge types (add/subtract/multiply/retype-the-number) to
  // match the live reference's varied captcha, rather than always being addition-only.
  static generateCaptcha(): CaptchaData {
    const id = crypto.randomUUID();
    const types = ['add', 'subtract', 'multiply', 'copy'] as const;
    const type = types[Math.floor(Math.random() * types.length)];

    let question: string;
    let answer: string;

    // Short single-digit sums (4 + 7, 9 - 1, 8 * 1), or a 5-digit number to retype (87867)
    const digit = () => Math.floor(Math.random() * 9) + 1; // 1..9
    if (type === 'add') {
      const a = digit();
      const b = digit();
      question = `${a} + ${b}`;
      answer = (a + b).toString();
    } else if (type === 'subtract') {
      const a = Math.floor(Math.random() * 8) + 2; // 2..9
      const b = Math.floor(Math.random() * (a - 1)) + 1; // always < a, so the result stays positive
      question = `${a} - ${b}`;
      answer = (a - b).toString();
    } else if (type === 'multiply') {
      const a = digit();
      const b = digit();
      question = `${a} * ${b}`;
      answer = (a * b).toString();
    } else {
      const num = Math.floor(Math.random() * 90000) + 10000;
      question = num.toString();
      answer = num.toString();
    }

    // Expired captchas are dropped, and the store is capped, so asking for captchas over and
    // over can't fill the server's memory.
    const now = Date.now();
    for (const [key, entry] of captchaStore) {
      if (entry.expiresAt < now) captchaStore.delete(key);
    }
    if (captchaStore.size >= CAPTCHA_STORE_MAX) captchaStore.clear();
    captchaStore.set(id, { answer, expiresAt: now + CAPTCHA_TTL_MS });
    return { id, question };
  }

  static async login(username: string, password: string, captchaId?: string, captchaAnswer?: string, clientIp?: string) {
    // The captcha is required (both apps always send it) and good for one try only — a login
    // that leaves it out, or reuses one, is refused before the password is looked at.
    const entry = captchaId ? captchaStore.get(captchaId) : undefined;
    if (captchaId) captchaStore.delete(captchaId);
    if (!entry || !captchaAnswer || entry.expiresAt < Date.now() || entry.answer !== captchaAnswer.trim()) {
      throw new UnauthorizedError('Invalid or expired Captcha');
    }

    const cleanUsername = (username || '').trim();
    // Too many wrong passwords for this username (from any IP): refused for a while
    assertUsernameNotLocked(cleanUsername);

    // Case-insensitive username lookup
    const [user] = await db.select().from(users).where(
      sql`LOWER(${users.username}) = LOWER(${cleanUsername})`
    );

    // Wrong username / password counts toward the 3-in-a-row IP block (login-guard.ts).
    const left = (n: number) => ` (${n} attempt${n === 1 ? '' : 's'} left)`;
    // Staffs page Active = NO: right username + password still doesn't log in — the login page
    // sends the browser off to Google (live behaviour). Not counted as a wrong login.
    if (user && !user.isActive && (await verifyPassword(password, user.passwordHash))) {
      // ...and from now on this IP is sent to Google when it opens the site (inactive-redirect.ts)
      if (clientIp) await addRedirectIp(clientIp, user.username);
      throw new AppError('Account is inactive', 403, 'ACCOUNT_INACTIVE');
    }
    if (!user || !user.isActive) {
      registerUsernameFailure(cleanUsername);
      const remaining = clientIp ? await registerLoginFailure(clientIp, cleanUsername) : null;
      throw new UnauthorizedError('Invalid credentials or account is inactive' + (remaining !== null ? left(remaining) : ''));
    }

    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      registerUsernameFailure(cleanUsername);
      const remaining = clientIp ? await registerLoginFailure(clientIp, cleanUsername) : null;
      throw new UnauthorizedError('Invalid credentials' + (remaining !== null ? left(remaining) : ''));
    }
    if (clientIp) clearLoginFailures(clientIp);
    clearUsernameFailures(cleanUsername);

    // A password stored in an older form (plain text / 1,000 iterations) is upgraded now that
    // we have it in hand.
    const upgradedHash = needsRehash(user.passwordHash) ? await hashPassword(password) : undefined;
    await db.update(users).set({
      lastLoginAt: new Date(),
      ...(upgradedHash ? { passwordHash: upgradedHash } : {}),
    }).where(eq(users.id, user.id));

    // Update staff working status & timestamp on successful login
    await db.update(staff).set({
      isWorkingLive: true,
      updatedAt: new Date(),
    }).where(sql`user_id = ${user.id} OR LOWER(username) = LOWER(${user.username})`).catch(() => {});

    const [role] = await db.select().from(roles).where(eq(roles.id, user.roleId));

    const session: UserSession = {
      userId: user.id,
      username: user.username,
      roleId: user.roleId,
      roleName: (role?.name || 'DATA ENTRY OPERATOR') as SystemRole,
    };

    // One session per account per IP: this login signs out the account's earlier session on
    // the same IP (session-store.ts). The session id rides in the token only.
    const sid = clientIp ? await createSession(user.id, clientIp) : undefined;
    const token = jwt.sign(sid ? { ...session, sid } : session, env.JWT_SECRET, { expiresIn: TOKEN_EXPIRES_IN, algorithm: 'HS256' });

    return {
      user: session,
      token,
    };
  }

  static async changePassword(userId: number, currentPassword: string, newPassword: string) {
    if (!currentPassword) {
      throw new AppError('Current password is required', 400);
    }
    if (!newPassword || !isStrongPassword(newPassword.trim())) {
      throw new AppError(`New ${WEAK_PASSWORD_MESSAGE.toLowerCase()}`, 400);
    }

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) {
      throw new AppError('User not found', 404);
    }

    const isCurrentValid = await verifyPassword(currentPassword, user.passwordHash);
    if (!isCurrentValid) {
      throw new AppError('Current password is incorrect', 400);
    }

    const newHash = await hashPassword(newPassword.trim());

    await db.update(users).set({
      passwordHash: newHash,
    }).where(eq(users.id, userId));

    // The staff row no longer keeps a readable copy of the password (only the hash in users)
    await db.update(staff).set({
      password: null,
    }).where(sql`user_id = ${userId} OR LOWER(username) = LOWER(${user.username})`).catch(() => {});

    return { success: true };
  }
}
