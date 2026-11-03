import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { UnauthorizedError, ForbiddenError, AppError } from '../common/errors.js';
import { isSessionActive, hasNewerSessionOnIp, SESSION_REPLACED_MESSAGE } from '../modules/auth/session-store.js';
import { extractClientIp } from './ip-block.middleware.js';
import { assertRoleMayCall } from './role-policy.js';
import { getAccountStatus } from '../modules/auth/account-status.js';
import { UserSession, SystemRole } from '@pb/types';

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      user?: UserSession;
    }
  }
}

// One session per account per IP (session-store.ts): a token whose session was replaced by a
// newer login of the SAME account on the same IP is refused with code SESSION_REPLACED; the web
// app then signs that tab out. Different accounts on one machine / network (separate tabs) never
// replace each other. A token from before sessions existed (no sid) is refused once the same
// account has logged in again on the IP.
async function sessionReplaced(req: Request, decoded: UserSession & { sid?: string }): Promise<boolean> {
  if (decoded.sid) return !(await isSessionActive(decoded.sid));
  return hasNewerSessionOnIp(extractClientIp(req), decoded.userId);
}

// Token checks shared by authenticate() and authenticateSSE(): signature + expiry (an expired
// login answers SESSION_EXPIRED so the apps sign out and say why), the one-session-per-IP rule,
// the account as it is now in the database (inactive / deleted → signed out; the role in force
// is the current one, not the one the token was issued with), then the role's API access
// (role-policy.ts — the same pages the website shows that role).
async function acceptToken(req: Request, token: string): Promise<AppError | null> {
  let decoded: UserSession & { sid?: string };
  try {
    decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as UserSession & { sid?: string };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return new AppError(SESSION_EXPIRED_MESSAGE, 401, 'SESSION_EXPIRED');
    }
    return new UnauthorizedError('Invalid or expired token');
  }
  if (await sessionReplaced(req, decoded)) {
    return new AppError(SESSION_REPLACED_MESSAGE, 401, 'SESSION_REPLACED');
  }
  const account = await getAccountStatus(decoded.userId);
  if (account && (!account.exists || !account.isActive)) {
    return new AppError('Your account is inactive. Please contact the administrator.', 401, 'SESSION_EXPIRED');
  }
  req.user = {
    userId: decoded.userId,
    username: decoded.username,
    roleId: account?.roleId ?? decoded.roleId,
    roleName: account?.roleName ?? decoded.roleName,
  };
  try {
    assertRoleMayCall(req);
  } catch (err) {
    return err as AppError;
  }
  return null;
}

export const SESSION_EXPIRED_MESSAGE = 'Your login session has expired. Please log in again.';

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Missing or malformed Authorization header'));
  }

  const token = authHeader.split(' ')[1];
  const error = await acceptToken(req, token);
  if (error) return next(error);
  next();
}

// Same as authenticate(), but also accepts the token as a `?token=` query param — needed only
// for the dashboard SSE stream, since the browser's EventSource API can't set a custom
// Authorization header. Kept separate from authenticate() so every other route's auth is
// completely unaffected.
export async function authenticateSSE(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const headerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : undefined;
  const token = headerToken || (req.query.token as string | undefined);

  if (!token) {
    return next(new UnauthorizedError('Missing token'));
  }

  const error = await acceptToken(req, token);
  if (error) return next(error);
  next();
}

export function requireRoles(...allowedRoles: SystemRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new UnauthorizedError());
    }

    if (!allowedRoles.includes(req.user.roleName)) {
      return next(new ForbiddenError(`Access denied. Requires one of roles: ${allowedRoles.join(', ')}`));
    }

    next();
  };
}
