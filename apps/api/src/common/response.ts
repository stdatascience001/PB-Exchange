import { Response } from 'express';

export function sendSuccess<T>(res: Response, data: T, message?: string, statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    message: message || 'Operation successful',
    data,
  });
}

export function sendError(res: Response, message: string, code = 'INTERNAL_ERROR', statusCode = 500, details?: any) {
  return res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
      details,
    },
  });
}
