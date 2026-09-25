import { db, users, roles, staff } from '@pb/database';
import { eq, sql } from 'drizzle-orm';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { UnauthorizedError, AppError } from '../../common/errors.js';
import { UserSession, SystemRole, CaptchaData } from '@pb/types';

const captchaStore = new Map<string, { answer: string; expiresAt: number }>();

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash) return false;
  if (storedHash.includes(':')) {
    const [salt, hash] = storedHash.split(':');
    const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return hash === verifyHash;
  }
  // Fallback for direct match if stored as plain text
  return password === storedHash;
}

export class AuthService {
  // Randomly picks one of 4 challenge types (add/subtract/multiply/retype-the-number) to
  // match the live reference's varied captcha, rather than always being addition-only.
  static generateCaptcha(): CaptchaData {
    const id = crypto.randomUUID();
    const types = ['add', 'subtract', 'multiply', 'copy'] as const;
    const type = types[Math.floor(Math.random() * types.length)];

    let question: string;
    let answer: string;

    if (type === 'add') {
      const a = Math.floor(Math.random() * 90) + 10;
      const b = Math.floor(Math.random() * 90) + 10;
      question = `${a} + ${b}`;
      answer = (a + b).toString();
    } else if (type === 'subtract') {
      const a = Math.floor(Math.random() * 90) + 10;
      const b = Math.floor(Math.random() * (a - 1)) + 1; // always < a, so the result stays positive
      question = `${a} - ${b}`;
      answer = (a - b).toString();
    } else if (type === 'multiply') {
      const a = Math.floor(Math.random() * 40) + 2;
      const b = Math.floor(Math.random() * 9) + 2;
      question = `${a} x ${b}`;
      answer = (a * b).toString();
    } else {
      const num = Math.floor(Math.random() * 90000) + 10000;
      question = num.toString();
      answer = num.toString();
    }

    captchaStore.set(id, { answer, expiresAt: Date.now() + 120000 });
    return { id, question };
  }

  static async login(username: string, password: string, captchaId?: string, captchaAnswer?: string) {
    if (captchaId && captchaAnswer) {
      const entry = captchaStore.get(captchaId);
      if (!entry || entry.expiresAt < Date.now() || entry.answer !== captchaAnswer.trim()) {
        throw new UnauthorizedError('Invalid or expired Captcha');
      }
      captchaStore.delete(captchaId);
    }

    const cleanUsername = (username || '').trim();

    // Case-insensitive username lookup
    const [user] = await db.select().from(users).where(
      sql`LOWER(${users.username}) = LOWER(${cleanUsername})`
    );

    if (!user || !user.isActive) {
      throw new UnauthorizedError('Invalid credentials or account is inactive');
    }

    const isValid = verifyPassword(password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedError('Invalid credentials');
    }

    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

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

    const token = jwt.sign(session, env.JWT_SECRET, { expiresIn: '1d' });

    return {
      user: session,
      token,
    };
  }

  static async changePassword(userId: number, currentPassword: string, newPassword: string) {
    if (!currentPassword) {
      throw new AppError('Current password is required', 400);
    }
    if (!newPassword || newPassword.trim().length < 4) {
      throw new AppError('New password must be at least 4 characters long', 400);
    }

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) {
      throw new AppError('User not found', 404);
    }

    const isCurrentValid = verifyPassword(currentPassword, user.passwordHash);
    if (!isCurrentValid) {
      throw new AppError('Current password is incorrect', 400);
    }

    const newHash = hashPassword(newPassword.trim());

    await db.update(users).set({
      passwordHash: newHash,
    }).where(eq(users.id, userId));

    // Also sync staff table if linked
    await db.update(staff).set({
      password: newPassword.trim(),
    }).where(sql`user_id = ${userId} OR LOWER(username) = LOWER(${user.username})`).catch(() => {});

    return { success: true };
  }
}
