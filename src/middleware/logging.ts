import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

// Extend Express Request interface to include logging properties
declare module 'express' {
  interface Request {
    requestId?: string;
    startTime?: number;
  }
}

/**
 * Request logging middleware
 */
export const requestLogger = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Generate unique request ID
  req.requestId = uuidv4();
  req.startTime = Date.now();

  // Get client IP
  const clientIP = req.ip || req.connection.remoteAddress || 'unknown';

  // Get user agent
  const userAgent = req.get('User-Agent') || 'unknown';

  // Log request completion only. Logging both start and finish doubled the
  // volume without adding information, since the finish line carries the same
  // request id.
  res.on('finish', () => {
    const duration = Date.now() - (req.startTime || 0);

    // Server errors deserve attention; client errors are routine.
    const level =
      res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    logger.log(level, `${req.method} ${req.originalUrl} ${res.statusCode}`, {
      requestId: req.requestId,
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: duration,
      contentLength: res.get('Content-Length') || '0',
      ip: clientIP,
      userAgent,
    });
  });

  // Log errors
  res.on('error', err => {
    logger.error('Response stream error', {
      requestId: req.requestId,
      error: err.message,
      stack: err.stack,
    });
  });

  next();
};

/*
 * apiLogger and a second auditLogger factory previously lived here. Both were
 * unreferenced, and the audit one logged the full request body - which on
 * /auth/login meant writing plaintext passwords to stdout. Auditing is handled
 * by src/middleware/audit.ts, which redacts credentials.
 */
