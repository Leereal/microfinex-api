import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

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

  // Log request start
  console.log(
    `[${new Date().toISOString()}] ${req.requestId} - ${req.method} ${req.originalUrl} - IP: ${clientIP} - UA: ${userAgent}`
  );

  // Log request completion
  res.on('finish', () => {
    const duration = Date.now() - (req.startTime || 0);
    const contentLength = res.get('Content-Length') || '0';

    console.log(
      `[${new Date().toISOString()}] ${req.requestId} - ${res.statusCode} - ${duration}ms - ${contentLength} bytes`
    );
  });

  // Log errors
  res.on('error', err => {
    console.error(
      `[${new Date().toISOString()}] ${req.requestId} - Error:`,
      err
    );
  });

  next();
};

/**
 * API request logger for detailed logging
 */
export const apiLogger = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const startTime = Date.now();

  // Capture response
  const originalSend = res.send;
  res.send = function (data) {
    const duration = Date.now() - startTime;

    // Log API request details
    console.log({
      requestId: req.requestId,
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
      timestamp: new Date().toISOString(),
      ...(req.user && { userId: req.user.userId }),
    });

    return originalSend.call(this, data);
  };

  next();
};

/**
 * Audit logger for sensitive operations
 */
export const auditLogger = (action: string) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Log before action
    console.log({
      type: 'AUDIT',
      action,
      requestId: req.requestId,
      userId: req.user?.userId,
      organizationId: req.user?.organizationId,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      timestamp: new Date().toISOString(),
      requestData: {
        method: req.method,
        url: req.originalUrl,
        body: req.body,
        params: req.params,
        query: req.query,
      },
    });

    // Log after response
    res.on('finish', () => {
      console.log({
        type: 'AUDIT_COMPLETE',
        action,
        requestId: req.requestId,
        userId: req.user?.userId,
        statusCode: res.statusCode,
        timestamp: new Date().toISOString(),
      });
    });

    next();
  };
};
