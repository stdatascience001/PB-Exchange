import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { UnauthorizedError, ForbiddenError, AppError } from '../common/errors.js';
import { isSessionActive, isIpTakenByOtherUser, SESSION_REPLACED_MESSAGE } from '../modules/auth/session-store.js';
import { extractClientIp } from './ip-block.middleware.js';
import { UserSession, SystemRole } from '@pb/types';

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      user?: UserSession;
    }
  }
}

// One account per IP (session-store.ts): a token whose session was replaced by a newer login
// on the same IP is refused with code SESSION_REPLACED; the web app then signs out. A token
// from before sessions existed (no sid) is refused once another account is logged in on the IP.
async function sessionReplaced(req: Request, decoded: UserSession & { sid?: string }): Promise<boolean> {
  if (decoded.sid) return !(await isSessionActive(decoded.sid));
  return isIpTakenByOtherUser(extractClientIp(req), decoded.userId);
}

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Missing or malformed Authorization header'));
  }

  const token = authHeader.split(' ')[1];
  let decoded: UserSession & { sid?: string };
  try {
    decoded = jwt.verify(token, env.JWT_SECRET) as UserSession & { sid?: string };
  } catch (err) {
    return next(new UnauthorizedError('Invalid or expired token'));
  }
  if (await sessionReplaced(req, decoded)) {
    return next(new AppError(SESSION_REPLACED_MESSAGE, 401, 'SESSION_REPLACED'));
  }
  req.user = decoded;
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

  let decoded: UserSession & { sid?: string };
  try {
    decoded = jwt.verify(token, env.JWT_SECRET) as UserSession & { sid?: string };
  } catch (err) {
    return next(new UnauthorizedError('Invalid or expired token'));
  }
  if (await sessionReplaced(req, decoded)) {
    return next(new AppError(SESSION_REPLACED_MESSAGE, 401, 'SESSION_REPLACED'));
  }
  req.user = decoded;
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
