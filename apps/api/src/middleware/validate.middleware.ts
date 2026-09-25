import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { sendError } from '../common/response.js';

export function validate(schema: ZodSchema) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = await schema.parseAsync(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const details = error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message,
        }));
        return sendError(res, 'Validation failed', 'VALIDATION_ERROR', 400, details);
      }
      next(error);
    }
  };
}
