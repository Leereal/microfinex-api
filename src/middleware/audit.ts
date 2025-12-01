import { Request, Response, NextFunction } from 'express';
import auditService, { generateRequestId } from '../services/audit.service';
import { AuditStatus } from '@prisma/client';

// Extend Express Request to include audit context
declare global {
  namespace Express {
    interface Request {
      auditContext?: {
        requestId: string;
        startTime: number;
        userId?: string;
        organizationId?: string;
        branchId?: string;
        sessionId?: string;
      };
      previousEntityState?: any;
    }
  }
}

// Entity type mapping from route patterns
const RESOURCE_TYPE_MAP: Record<string, string> = {
  '/api/v1/clients': 'CLIENT',
  '/api/v1/loans': 'LOAN',
  '/api/v1/payments': 'PAYMENT',
  '/api/v1/users': 'USER',
  '/api/v1/organizations': 'ORGANIZATION',
  '/api/v1/branches': 'BRANCH',
  '/api/v1/roles': 'ROLE',
  '/api/v1/groups': 'GROUP',
  '/api/v1/employers': 'EMPLOYER',
  '/api/v1/shops': 'SHOP',
  '/api/v1/loan-products': 'LOAN_PRODUCT',
  '/api/v1/loan-categories': 'LOAN_CATEGORY',
  '/api/v1/settings': 'SETTINGS',
  '/api/v1/exchange-rates': 'EXCHANGE_RATE',
  '/api/v1/online-applications': 'ONLINE_APPLICATION',
};

// Action mapping from HTTP methods
const METHOD_TO_ACTION: Record<string, string> = {
  POST: 'CREATE',
  PUT: 'UPDATE',
  PATCH: 'UPDATE',
  DELETE: 'DELETE',
  GET: 'READ',
};

// Routes that should skip audit logging
const SKIP_AUDIT_PATHS = [
  '/health',
  '/api/v1/health',
  '/api/v1/audit', // Don't audit audit endpoints
  '/api-docs',
  '/swagger',
];

// Routes that should log READ operations (sensitive data)
const LOG_READ_PATHS = [
  '/api/v1/clients',
  '/api/v1/loans',
  '/api/v1/payments',
  '/api/v1/users',
];

/**
 * Initialize audit context for the request
 */
export function initAuditContext(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  req.auditContext = {
    requestId: generateRequestId(),
    startTime: Date.now(),
    userId: req.userContext?.id,
    organizationId:
      req.userContext?.organizationId ||
      req.body?.organizationId ||
      req.params?.organizationId,
    branchId: req.body?.branchId || req.params?.branchId,
    sessionId: req.headers['x-session-id'] as string,
  };

  // Add request ID to response headers for tracking
  res.setHeader('X-Request-ID', req.auditContext.requestId);

  next();
}

/**
 * Capture the previous state of an entity before update/delete
 */
export function capturePreviousState(
  getEntityFn: (id: string) => Promise<any>
) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const entityId =
        req.params.id ||
        req.params.clientId ||
        req.params.loanId ||
        req.params.userId ||
        req.params.organizationId;

      if (entityId && ['PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        const previousState = await getEntityFn(entityId);
        req.previousEntityState = previousState;
      }

      next();
    } catch (error) {
      // Don't block the request if we can't capture previous state
      console.error('Error capturing previous state for audit:', error);
      next();
    }
  };
}

/**
 * Determine resource type from the request path
 */
function getResourceType(path: string): string {
  for (const [pattern, resourceType] of Object.entries(RESOURCE_TYPE_MAP)) {
    if (path.startsWith(pattern)) {
      return resourceType;
    }
  }
  return 'UNKNOWN';
}

/**
 * Extract resource ID from the request
 */
function getResourceId(req: Request): string {
  return (
    req.params.id ||
    req.params.clientId ||
    req.params.loanId ||
    req.params.userId ||
    req.params.organizationId ||
    req.params.branchId ||
    req.params.roleId ||
    req.body?.id ||
    'unknown'
  );
}

/**
 * Check if the path should skip audit logging
 */
function shouldSkipAudit(path: string, method: string): boolean {
  if (SKIP_AUDIT_PATHS.some(p => path.startsWith(p))) {
    return true;
  }

  // Skip GET requests unless they're for sensitive data
  if (method === 'GET' && !LOG_READ_PATHS.some(p => path.startsWith(p))) {
    return true;
  }

  return false;
}

/**
 * Main audit logging middleware
 * Automatically logs CREATE, UPDATE, DELETE operations
 */
export function auditLogger(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Skip if no audit context
  if (!req.auditContext) {
    next();
    return;
  }

  // Skip certain paths
  if (shouldSkipAudit(req.path, req.method)) {
    next();
    return;
  }

  // Store original json method
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  // Wrap response methods to capture response and log audit
  res.json = function (body: any) {
    logAuditEntry(req, res, body);
    return originalJson(body);
  };

  res.send = function (body: any) {
    if (typeof body === 'object') {
      logAuditEntry(req, res, body);
    }
    return originalSend(body);
  };

  next();
}

/**
 * Log the audit entry after response
 */
async function logAuditEntry(
  req: Request,
  res: Response,
  responseBody: any
): Promise<void> {
  try {
    const ctx = req.auditContext!;
    const duration = Date.now() - ctx.startTime;
    const action = METHOD_TO_ACTION[req.method] || req.method;
    const resource = getResourceType(req.path);
    const resourceId = getResourceId(req);
    const status: AuditStatus = res.statusCode >= 400 ? 'FAILURE' : 'SUCCESS';

    // Get IP address
    const ipAddress =
      req.ip ||
      (req.headers['x-forwarded-for'] as string) ||
      req.socket?.remoteAddress ||
      'unknown';

    const auditEntry = {
      action,
      resource,
      resourceId,
      userId: ctx.userId || 'anonymous',
      organizationId: ctx.organizationId,
      branchId: ctx.branchId,
      previousValue: req.previousEntityState || null,
      newValue:
        action === 'DELETE' ? null : responseBody?.data || req.body || null,
      changes: {
        path: req.path,
        method: req.method,
        statusCode: res.statusCode,
        query: req.query,
      },
      status,
      duration,
      requestId: ctx.requestId,
      sessionId: ctx.sessionId,
      ipAddress,
      userAgent: req.headers['user-agent'] as string,
    };

    // Log asynchronously (don't block response)
    auditService.createAuditLog(auditEntry).catch(error => {
      console.error('Failed to create audit log:', error);
    });
  } catch (error) {
    console.error('Error in audit logging:', error);
  }
}

/**
 * Manual audit logging for custom actions
 */
export async function logCustomAction(
  req: Request,
  action: string,
  resource: string,
  resourceId: string,
  details: {
    previousValue?: any;
    newValue?: any;
    changes?: any;
    status?: AuditStatus;
  }
): Promise<void> {
  try {
    const ctx = req.auditContext || {
      requestId: generateRequestId(),
      startTime: Date.now(),
    };

    await auditService.createAuditLog({
      action,
      resource,
      resourceId,
      userId: req.userContext?.id || 'anonymous',
      organizationId: req.userContext?.organizationId,
      branchId: req.body?.branchId,
      previousValue: details.previousValue,
      newValue: details.newValue,
      changes: details.changes,
      status: details.status || 'SUCCESS',
      duration: Date.now() - ctx.startTime,
      requestId: ctx.requestId,
      sessionId: ctx.sessionId,
      ipAddress: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] as string,
    });
  } catch (error) {
    console.error('Error logging custom action:', error);
  }
}

/**
 * Log authentication events
 */
export async function logAuthEvent(
  req: Request,
  action:
    | 'LOGIN'
    | 'LOGOUT'
    | 'LOGIN_FAILED'
    | 'PASSWORD_CHANGE'
    | 'PASSWORD_RESET'
    | 'TOKEN_REFRESH',
  userId: string,
  status: AuditStatus = 'SUCCESS',
  details?: any
): Promise<void> {
  try {
    await auditService.logAuth(
      action,
      userId,
      {
        ipAddress:
          req.ip || (req.headers['x-forwarded-for'] as string) || 'unknown',
        userAgent: req.headers['user-agent'] as string,
        requestId: req.auditContext?.requestId || generateRequestId(),
        sessionId: req.auditContext?.sessionId,
        changes: details,
      },
      status
    );
  } catch (error) {
    console.error('Error logging auth event:', error);
  }
}

export default {
  initAuditContext,
  capturePreviousState,
  auditLogger,
  logCustomAction,
  logAuthEvent,
};
