import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { logger } from '../utils/logger';

/**
 * Map the Prisma error codes we can act on to meaningful HTTP responses.
 * Without this every constraint violation surfaces as a generic 500, which
 * tells the client nothing and looks like an outage rather than bad input.
 */
function mapPrismaError(error: Prisma.PrismaClientKnownRequestError): {
  statusCode: number;
  message: string;
  errorCode: string;
  details?: any;
} {
  const target = error.meta?.target;
  const fields = Array.isArray(target) ? target.join(', ') : target;

  switch (error.code) {
    case 'P2002':
      return {
        statusCode: 409,
        message: fields
          ? `A record with this ${fields} already exists`
          : 'A record with these details already exists',
        errorCode: 'DUPLICATE_RECORD',
        details: fields ? { fields: target } : undefined,
      };
    case 'P2003':
      return {
        statusCode: 400,
        message: 'Referenced record does not exist',
        errorCode: 'FOREIGN_KEY_VIOLATION',
        details: error.meta?.field_name
          ? { field: error.meta.field_name }
          : undefined,
      };
    case 'P2025':
      return {
        statusCode: 404,
        message: 'Record not found',
        errorCode: 'NOT_FOUND',
      };
    case 'P2000':
      return {
        statusCode: 400,
        message: 'A provided value is too long for its field',
        errorCode: 'VALUE_TOO_LONG',
        details: error.meta?.column_name
          ? { field: error.meta.column_name }
          : undefined,
      };
    case 'P2014':
      return {
        statusCode: 400,
        message: 'This change would break a required relation',
        errorCode: 'RELATION_VIOLATION',
      };
    default:
      return {
        statusCode: 500,
        message: 'Database error',
        errorCode: 'DATABASE_ERROR',
      };
  }
}

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
  } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const mapped = mapPrismaError(error);
    statusCode = mapped.statusCode;
    message = mapped.message;
    errorCode = mapped.errorCode;
    details = mapped.details;
  } else if (error instanceof Prisma.PrismaClientValidationError) {
    statusCode = 400;
    message = 'Invalid data supplied';
    errorCode = 'VALIDATION_ERROR';
  } else if ('statusCode' in error && error.statusCode) {
    statusCode = error.statusCode;
    message = error.message;
    // Give the client a code that matches the status rather than leaving the
    // default INTERNAL_ERROR on what is usually a 4xx.
    if (statusCode >= 400 && statusCode < 500) {
      errorCode = 'REQUEST_ERROR';
    }
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
  }

  // Log the error (don't log client errors in production)
  if (statusCode >= 500 || process.env.NODE_ENV !== 'production') {
    logger.error(`${req.method} ${req.url} failed: ${error.message}`, {
      message: error.message,
      stack: error.stack,
      statusCode,
      errorCode,
      url: req.url,
      method: req.method,
      requestId: (req as any).requestId,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
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
