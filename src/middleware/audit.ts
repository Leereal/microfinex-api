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
        /** The full request path, captured before Express rewrites it. */
        path?: string;
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
  '/api/v1/payment-methods': 'PAYMENT_METHOD',
  '/api/v1/payment-gateways': 'PAYMENT_GATEWAY',
  '/api/v1/currencies': 'CURRENCY',
  '/api/v1/charges': 'CHARGE',
  '/api/v1/transactions': 'TRANSACTION',
  '/api/v1/documents': 'DOCUMENT',
  '/api/v1/uploads': 'UPLOAD',
  '/api/v1/auth': 'AUTH',
  '/api/v1/disbursements': 'DISBURSEMENT',
  '/api/v1/collateral-types': 'COLLATERAL_TYPE',
  '/api/v1/loan-purposes': 'LOAN_PURPOSE',
  '/api/v1/expense-categories': 'EXPENSE_CATEGORY',
  '/api/v1/income-categories': 'INCOME_CATEGORY',
  '/api/v1/targets': 'TARGET',
  '/api/v1/reports': 'REPORT',
  '/api/v1/notifications': 'NOTIFICATION',
  '/api/v1/permissions': 'PERMISSION',
  '/api/v1/client-deletion-requests': 'CLIENT_DELETION_REQUEST',
};

// Action mapping from HTTP methods
const METHOD_TO_ACTION: Record<string, string> = {
  POST: 'CREATE',
  PUT: 'UPDATE',
  PATCH: 'UPDATE',
  DELETE: 'DELETE',
  GET: 'READ',
};

/**
 * Actions worth naming, where the HTTP verb says nothing useful.
 *
 * A sign-in is a POST, so the verb map recorded it as "CREATE" - the audit
 * trail's single most security-relevant event was indistinguishable from
 * creating a record. Matched on the path ending, since the mount prefix varies.
 */
const PATH_TO_ACTION: Array<[RegExp, string]> = [
  [/\/auth\/login$/i, 'LOGIN'],
  [/\/auth\/logout$/i, 'LOGOUT'],
  [/\/auth\/refresh(-token)?$/i, 'TOKEN_REFRESH'],
  [/\/auth\/register$/i, 'REGISTER'],
  [/\/auth\/forgot-password$/i, 'PASSWORD_RESET_REQUEST'],
  // Not anchored to /auth: an administrator resetting somebody else's password
  // hits /users/:id/reset-password, and that is the version most worth naming.
  [/\/reset-password$/i, 'PASSWORD_RESET'],
  [/\/change-password$/i, 'PASSWORD_CHANGE'],
  [/\/verify-email$/i, 'EMAIL_VERIFY'],
  [/\/unverify-email$/i, 'EMAIL_UNVERIFY'],
  [/\/switch-branch$/i, 'BRANCH_SWITCH'],
  [/\/set-default$/i, 'SET_DEFAULT'],
  [/\/toggle-active$/i, 'STATUS_CHANGE'],
  [/\/status$/i, 'STATUS_CHANGE'],
  [/\/approve$/i, 'APPROVE'],
  [/\/reject$/i, 'REJECT'],
  [/\/disburse$/i, 'DISBURSE'],
  [/\/reverse$/i, 'REVERSE'],
  [/\/cancel$/i, 'CANCEL'],
  [/\/top-?up$/i, 'TOP_UP'],
];

/** HTTP methods that never represent an auditable action. */
const NON_AUDITABLE_METHODS = new Set(['HEAD', 'OPTIONS']);

// Routes that should skip audit logging
const SKIP_AUDIT_PATHS = [
  '/health',
  '/api/v1/health',
  '/api/v1/audit', // Don't audit audit endpoints
  '/api/v1/client-drafts', // Don't audit draft auto-saves (too noisy)
  '/api-docs',
  '/swagger',
];

/**
 * Field names whose values must never reach the audit log.
 *
 * The generic logger records the request body when a response carries no
 * `data` payload, which is exactly what happens on a failed login - so
 * without this list every rejected sign-in would persist the submitted
 * password in plaintext, and every successful one would persist the issued
 * access token. Auth events are recorded separately by logAuthEvent, which
 * stores no credentials.
 */
const REDACTED_FIELDS = new Set([
  'password',
  'newpassword',
  'oldpassword',
  'currentpassword',
  'confirmpassword',
  'passwordconfirmation',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'apikey',
  'secret',
  'clientsecret',
  'servicerolekey',
  'authorization',
  'pin',
  'otp',
  'mfacode',
  'totp',
  'sessiontoken',
  'privatekey',
]);

const REDACTED_PLACEHOLDER = '[REDACTED]';

/**
 * Recursively strip credential-bearing fields from a value before it is
 * persisted. Returns a copy; the caller's object is never mutated.
 */
function redactSensitive(value: any, depth = 0): any {
  // Guard against deeply nested or cyclic payloads.
  if (depth > 8 || value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(entry => redactSensitive(entry, depth + 1));
  }

  if (typeof value !== 'object' || value instanceof Date) {
    return value;
  }

  const result: Record<string, any> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (REDACTED_FIELDS.has(key.toLowerCase())) {
      result[key] = REDACTED_PLACEHOLDER;
    } else {
      result[key] = redactSensitive(entry, depth + 1);
    }
  }
  return result;
}

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
  // This middleware runs globally, before any route-level authentication has
  // had a chance to populate req.userContext. Identity is therefore resolved
  // lazily by resolveActor() when the entry is actually written, not captured
  // here - reading it now would stamp every audit record with a null user.
  req.auditContext = {
    requestId: generateRequestId(),
    startTime: Date.now(),
    sessionId: req.headers['x-session-id'] as string,
    // Captured here deliberately.
    //
    // The entry is written from inside res.json, by which point the request has
    // descended into a mounted router and Express has stripped the mount prefix
    // from req.url - so req.path reads '/' or '/:id' rather than
    // '/api/v1/clients'. Every entry was therefore classified UNKNOWN. Only
    // req.originalUrl survives routing intact.
    path: (req.originalUrl || req.url || '').split('?')[0],
  };

  // Add request ID to response headers for tracking
  res.setHeader('X-Request-ID', req.auditContext.requestId);

  next();
}

/**
 * Resolve who performed the request, at the point the audit entry is written.
 *
 * The three authentication middlewares populate different shapes
 * (auth.ts sets req.user.userId, auth-supabase.ts sets req.userContext.id and
 * req.user.id), so all of them are consulted.
 */
function resolveActor(req: Request): {
  userId: string | null;
  organizationId: string | null;
  branchId: string | null;
} {
  const user = (req as any).user;

  return {
    userId: req.userContext?.id || user?.id || user?.userId || null,
    organizationId:
      req.userContext?.organizationId ||
      user?.organizationId ||
      req.body?.organizationId ||
      req.params?.organizationId ||
      null,
    branchId:
      user?.branchId || req.body?.branchId || req.params?.branchId || null,
  };
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
  // Longest pattern first, so /api/v1/loan-products is not swallowed by a
  // shorter prefix that happens to match.
  const patterns = Object.entries(RESOURCE_TYPE_MAP).sort(
    (a, b) => b[0].length - a[0].length
  );

  for (const [pattern, resourceType] of patterns) {
    if (path.startsWith(pattern)) {
      return resourceType;
    }
  }

  // An unmapped route still says more than "UNKNOWN": derive the resource from
  // the first path segment, so a new endpoint is legible in the trail the day
  // it ships rather than the day someone remembers to add it to the map.
  const segment = path.replace(/^\/api\/v\d+\//, '').split('/')[0];
  if (segment) {
    return segment
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/_+$/, '')
      .toUpperCase();
  }

  return 'UNKNOWN';
}

/**
 * Extract resource ID from the request
 */
function getResourceId(req: Request, responseBody?: any): string | null {
  // The literal string 'unknown' was stored when nothing matched, which then
  // showed up in the trail as if it were a real identifier and made
  // resourceId filtering useless. Absent is absent.
  return (
    req.params.id ||
    req.params.clientId ||
    req.params.loanId ||
    req.params.userId ||
    req.params.organizationId ||
    req.params.branchId ||
    req.params.roleId ||
    req.body?.id ||
    // On a create the id only exists in the response.
    responseBody?.data?.id ||
    responseBody?.data?.[Object.keys(responseBody?.data ?? {})[0] ?? '']?.id ||
    null
  );
}

/**
 * Check if the path should skip audit logging
 */
function shouldSkipAudit(path: string, method: string): boolean {
  // HEAD and OPTIONS carry no intent - they were being written to the trail as
  // an action literally called "HEAD".
  if (NON_AUDITABLE_METHODS.has(method)) {
    return true;
  }

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

  // Skip certain paths. This runs at app level, where req.path is still the
  // full one, but the captured path is used for consistency with the entry.
  if (shouldSkipAudit(req.auditContext.path || req.path, req.method)) {
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
    // Requests that matched no route at all are not audit events.
    //
    // The API is reachable from the internet and is continuously probed by
    // vulnerability scanners - one signature alone (a WordPress `rest_route`
    // batch probe) accounted for thousands of entries, and 404s made up over
    // half of everything recorded. `req.route` is only set once a handler has
    // matched, which separates that noise from a genuine "record not found"
    // raised by a real endpoint, which is still worth keeping.
    if (res.statusCode === 404 && !(req as any).route) {
      return;
    }

    const ctx = req.auditContext!;
    const duration = Date.now() - ctx.startTime;
    const path = ctx.path || req.originalUrl?.split('?')[0] || req.path;
    const namedAction = PATH_TO_ACTION.find(([pattern]) => pattern.test(path));
    const action =
      namedAction?.[1] || METHOD_TO_ACTION[req.method] || req.method;
    const resource = getResourceType(path);
    const resourceId = getResourceId(req, responseBody);
    const status: AuditStatus = res.statusCode >= 400 ? 'FAILURE' : 'SUCCESS';

    // Get IP address
    const ipAddress =
      req.ip ||
      (req.headers['x-forwarded-for'] as string) ||
      req.socket?.remoteAddress ||
      'unknown';

    // Resolved now rather than at request start, so authentication has run.
    const actor = resolveActor(req);

    const auditEntry = {
      action,
      resource,
      resourceId,
      userId: actor.userId, // Don't use 'anonymous' - use null for unknown users
      organizationId: actor.organizationId,
      branchId: actor.branchId,
      previousValue: redactSensitive(req.previousEntityState) || null,
      newValue:
        action === 'DELETE'
          ? null
          : redactSensitive(responseBody?.data ?? req.body) || null,
      changes: {
        path,
        method: req.method,
        statusCode: res.statusCode,
        query: redactSensitive(req.query),
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

    const actor = resolveActor(req);

    await auditService.createAuditLog({
      action,
      resource,
      resourceId,
      userId: actor.userId,
      organizationId: actor.organizationId ?? undefined,
      branchId: actor.branchId ?? undefined,
      previousValue: redactSensitive(details.previousValue),
      newValue: redactSensitive(details.newValue),
      changes: redactSensitive(details.changes),
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
