import { Request, Response, NextFunction } from 'express';
import { z, ZodError, ZodSchema } from 'zod';

/**
 * Middleware to validate request data against a Zod schema
 * Supports schemas with nested { params, body, query } structure
 * or flat body-only schemas
 */
export const validateRequest = (schema: ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      // First, try parsing just the body (most common case for POST/PUT requests)
      const bodyResult = schema.safeParse(req.body);

      if (bodyResult.success) {
        req.body = bodyResult.data;
        next();
        return;
      }

      // If body parsing failed, check if schema expects { params, body, query } structure
      const fullRequest = {
        params: req.params,
        body: req.body,
        query: req.query,
      };

      const fullResult = schema.safeParse(fullRequest);
      if (fullResult.success) {
        if (fullResult.data.params) req.params = fullResult.data.params;
        if (fullResult.data.body) req.body = fullResult.data.body;
        if (fullResult.data.query) req.query = fullResult.data.query;
        next();
        return;
      }

      // Neither worked, throw the body error (more relevant for API endpoints)
      throw bodyResult.error;
    } catch (error) {
      if (error instanceof ZodError) {
        const validationErrors = error.errors.map(err => ({
          path: err.path.join('.'),
          message: err.message,
          code: err.code,
        }));

        res.status(400).json({
          success: false,
          message: 'Validation failed',
          error: 'VALIDATION_ERROR',
          details: validationErrors,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Handle unexpected errors
      console.error('Validation error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  };
};

/**
 * Middleware to validate query parameters
 */
export const validateQuery = (schema: ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.query = schema.parse(req.query);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const validationErrors = error.errors.map(err => ({
          path: err.path.join('.'),
          message: err.message,
          code: err.code,
        }));

        res.status(400).json({
          success: false,
          message: 'Query validation failed',
          error: 'QUERY_VALIDATION_ERROR',
          details: validationErrors,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      console.error('Query validation error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  };
};

/**
 * Middleware to validate URL parameters
 */
export const validateParams = (schema: ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.params = schema.parse(req.params);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const validationErrors = error.errors.map(err => ({
          path: err.path.join('.'),
          message: err.message,
          code: err.code,
        }));

        res.status(400).json({
          success: false,
          message: 'Parameter validation failed',
          error: 'PARAM_VALIDATION_ERROR',
          details: validationErrors,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      console.error('Parameter validation error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  };
};

/**
 * Common validation schemas
 */
export const commonSchemas = {
  // UUID validation
  uuid: z.string().uuid('Invalid UUID format'),

  // Pagination
  pagination: z.object({
    page: z
      .string()
      .transform(val => parseInt(val, 10))
      .pipe(z.number().min(1))
      .optional(),
    limit: z
      .string()
      .transform(val => parseInt(val, 10))
      .pipe(z.number().min(1).max(100))
      .optional(),
    sort: z.string().optional(),
    order: z.enum(['asc', 'desc']).optional(),
  }),

  // Search
  search: z.object({
    q: z.string().min(1).optional(),
    fields: z.string().optional(),
  }),

  // Date range
  dateRange: z.object({
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
  }),

  // File upload
  fileUpload: z.object({
    fileName: z.string().min(1),
    mimeType: z.string().min(1),
    size: z.number().positive(),
  }),
};
