export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: any;

  constructor(message: string, statusCode = 400, code = 'BAD_REQUEST', details?: any) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Permission denied') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
  }
}

export class CutoffError extends AppError {
  constructor(message = 'Shift entry cutoff time exceeded for your role') {
    super(message, 400, 'SHIFT_CUTOFF_EXCEEDED');
  }
}

export class LimitExceededError extends AppError {
  constructor(message = 'Transaction exceeds configured party limit or capping') {
    super(message, 400, 'LIMIT_EXCEEDED');
  }
}
