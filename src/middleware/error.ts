import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export interface AppError extends Error {
  statusCode?: number;
  isOperational?: boolean;
}

/**
 * Global error handler middleware
 */
export const errorHandler = (
  error: AppError | Error,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  let statusCode = 500;
  let message = 'Internal server error';
  let errorCode = 'INTERNAL_ERROR';
  let details: any = undefined;

  // Handle specific error types
  if (error instanceof ZodError) {
    statusCode = 400;
    message = 'Validation error';
    errorCode = 'VALIDATION_ERROR';
    details = error.errors.map(err => ({
      path: err.path.join('.'),
      message: err.message,
      code: err.code,
    }));
  } else if ('statusCode' in error && error.statusCode) {
    statusCode = error.statusCode;
    message = error.message;
  } else if (error.name === 'UnauthorizedError') {
    statusCode = 401;
    message = 'Unauthorized';
    errorCode = 'UNAUTHORIZED';
  } else if (error.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation failed';
    errorCode = 'VALIDATION_ERROR';
  } else if (error.name === 'CastError') {
    statusCode = 400;
    message = 'Invalid data format';
    errorCode = 'INVALID_FORMAT';
  } else if (error.name === 'MongoError' || error.name === 'MongoServerError') {
    statusCode = 500;
    message = 'Database error';
    errorCode = 'DATABASE_ERROR';
  }

  // Log the error (don't log client errors in production)
  if (statusCode >= 500 || process.env.NODE_ENV !== 'production') {
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      statusCode,
      url: req.url,
      method: req.method,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
      timestamp: new Date().toISOString(),
    });
  }

  // Send error response
  res.status(statusCode).json({
    success: false,
    message,
    error: errorCode,
    ...(details && { details }),
    timestamp: new Date().toISOString(),
    ...(process.env.NODE_ENV === 'development' && {
      stack: error.stack,
    }),
  });
};

/**
 * Async wrapper to catch errors in async route handlers
 */
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Create an operational error
 */
export const createError = (message: string, statusCode = 500): AppError => {
  const error = new Error(message) as AppError;
  error.statusCode = statusCode;
  error.isOperational = true;
  return error;
};
