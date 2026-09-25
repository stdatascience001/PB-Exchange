import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { UnauthorizedError, ForbiddenError } from '../common/errors.js';
import { UserSession, SystemRole } from '@pb/types';

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      user?: UserSession;
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Missing or malformed Authorization header'));
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as UserSession;
    req.user = decoded;
    next();
  } catch (err) {
    next(new UnauthorizedError('Invalid or expired token'));
  }
}

// Same as authenticate(), but also accepts the token as a `?token=` query param — needed only
// for the dashboard SSE stream, since the browser's EventSource API can't set a custom
// Authorization header. Kept separate from authenticate() so every other route's auth is
// completely unaffected.
export function authenticateSSE(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const headerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : undefined;
  const token = headerToken || (req.query.token as string | undefined);

  if (!token) {
    return next(new UnauthorizedError('Missing token'));
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as UserSession;
    req.user = decoded;
    next();
  } catch (err) {
    next(new UnauthorizedError('Invalid or expired token'));
  }
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
