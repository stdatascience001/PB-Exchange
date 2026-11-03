import { Request, Response, NextFunction } from 'express';
import { AppError } from '../common/errors.js';
import { extractClientIp } from './ip-block.middleware.js';

// Simple per-IP request limit for the public auth endpoints (login, captcha): at most `max`
// requests per `windowMs` from one IP, then 429 until the window ends. In memory, per process.
export function rateLimit(name: string, max: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, _res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = extractClientIp(req);
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      if (hits.size > 50000) hits.clear();
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      const seconds = Math.ceil((entry.resetAt - now) / 1000);
      return next(new AppError(`Too many requests. Please try again after ${seconds} seconds.`, 429, 'TOO_MANY_REQUESTS', { limit: name }));
    }
    next();
  };
}
