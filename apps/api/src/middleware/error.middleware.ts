import { Request, Response, NextFunction } from 'express';
import { AppError } from '../common/errors.js';
import { sendError } from '../common/response.js';

export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  console.error(`[Error] ${req.method} ${req.path}:`, err);

  if (err instanceof AppError) {
    return sendError(res, err.message, err.code, err.statusCode, err.details);
  }

  return sendError(res, err.message || 'Internal Server Error', 'INTERNAL_ERROR', 500);
}
