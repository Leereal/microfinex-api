import { prisma } from '../config/database';
import { AuditLog, Prisma } from '@prisma/client';
// randomUUID rather than the uuid package: same output, no dependency, and
// uuid ships ESM-only, which made every module importing this file unusable
// from the Jest suites.
import { randomUUID } from 'node:crypto';

// AuditStatus type (matches Prisma enum)
export type AuditStatus = 'SUCCESS' | 'FAILURE' | 'PARTIAL';

// Types
export interface AuditLogEntry {
  action: string;
  resource: string; // Entity type (CLIENT, LOAN, etc.)
  // Null when the route carries no identifier - a list endpoint, say. It used
  // to be given the literal string 'unknown', which filtered and grouped as if
  // it were a real record.
  resourceId: string | null;
  userId: string | null;
  organizationId?: string | null;
  branchId?: string | null;
  previousValue?: any;
  newValue?: any;
  changes?: any;
  status?: AuditStatus;
  duration?: number;
  requestId?: string;
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
  errorMessage?: string;
}

export interface AuditSearchParams {
  organizationId?: string;
  userId?: string;
  resource?: string;
  resourceId?: string;
  action?: string;
  status?: AuditStatus;
  startDate?: Date;
  endDate?: Date;
  branchId?: string;
  requestId?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface AuditSearchResult {
  logs: AuditLog[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface EntityHistory {
  resource: string;
  resourceId: string;
  currentState: any;
  history: {
    action: string;
    timestamp: Date;
    userId: string;
    previousValue: any;
    newValue: any;
    changes: FieldChange[];
  }[];
}

export interface FieldChange {
  field: string;
  oldValue: any;
  newValue: any;
}

/**
 * What the audit dashboard needs.
 *
 * The `by*` arrays are the raw groupings; the `success`/`failure` counts and
 * the `top*` arrays are what the UI actually renders. Both are returned because
 * the two sides had drifted apart: the client read `successCount`,
 * `failureCount` and `topActions`, none of which the server had ever sent, so
 * the cards showed 0, 0 and "N/A" against five thousand logged events.
 */
export interface AuditStats {
  totalLogs: number;
  successCount: number;
  failureCount: number;
  byAction: { action: string; count: number }[];
  byResource: { resource: string; count: number }[];
  byStatus: { status: AuditStatus; count: number }[];
  byUser: { userId: string; count: number }[];
  topActions: { action: string; count: number }[];
  topResources: { resource: string; count: number }[];
  topUsers: { userId: string; userName: string; count: number }[];
  activityByHour: { hour: number; count: number }[];
  recentActivity: AuditLog[];
}

// ===== CORE AUDIT LOGGING =====

/**
 * Validate if a string is a valid UUID
 */
function isValidUUID(str: string | null | undefined): boolean {
  if (!str) return false;
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

/**
 * Create an audit log entry
 */
export async function createAuditLog(entry: AuditLogEntry): Promise<AuditLog> {
  // Only set userId if it's a valid UUID (to avoid foreign key constraint violations)
  const validUserId = isValidUUID(entry.userId) ? entry.userId : null;
  const validOrganizationId = isValidUUID(entry.organizationId)
    ? entry.organizationId
    : null;
  const validBranchId = isValidUUID(entry.branchId) ? entry.branchId : null;

  return prisma.auditLog.create({
    data: {
      action: entry.action,
      resource: entry.resource,
      resourceId: entry.resourceId || null,
      userId: validUserId,
      organizationId: validOrganizationId,
      branchId: validBranchId,
      previousValue: entry.previousValue || Prisma.DbNull,
      newValue: entry.newValue || Prisma.DbNull,
      changes: entry.changes || Prisma.DbNull,
      status: entry.status || 'SUCCESS',
      duration: entry.duration || null,
      requestId: entry.requestId || null,
      sessionId: entry.sessionId || null,
      ipAddress: entry.ipAddress || null,
      userAgent: entry.userAgent || null,
      errorMessage: entry.errorMessage || null,
    },
  });
}

/**
 * Log a CREATE action
 */
export async function logCreate(
  resource: string,
  resourceId: string,
  newValue: any,
  context: Partial<AuditLogEntry>
): Promise<AuditLog> {
  return createAuditLog({
    action: 'CREATE',
    resource,
    resourceId,
    newValue,
    previousValue: null,
    ...context,
    userId: context.userId || null, // Don't use 'system' - use null if no user
  });
}

/**
 * Log a READ action (optional, for sensitive data access)
 */
export async function logRead(
  resource: string,
  resourceId: string,
  context: Partial<AuditLogEntry>
): Promise<AuditLog> {
  return createAuditLog({
    action: 'READ',
    resource,
    resourceId,
    ...context,
    userId: context.userId || null, // Don't use 'system' - use null if no user
  });
}

/**
 * Log an UPDATE action with diff
 */
export async function logUpdate(
  resource: string,
  resourceId: string,
  previousValue: any,
  newValue: any,
  context: Partial<AuditLogEntry>
): Promise<AuditLog> {
  // Calculate diff and store in changes
  const changes = calculateDiff(previousValue, newValue);

  return createAuditLog({
    action: 'UPDATE',
    resource,
    resourceId,
    previousValue,
    newValue,
    changes: { fieldChanges: changes },
    ...context,
    userId: context.userId || null, // Don't use 'system' - use null if no user
  });
}

/**
 * Log a DELETE action
 */
export async function logDelete(
  resource: string,
  resourceId: string,
  previousValue: any,
  context: Partial<AuditLogEntry>
): Promise<AuditLog> {
  return createAuditLog({
    action: 'DELETE',
    resource,
    resourceId,
    previousValue,
    newValue: null,
    ...context,
    userId: context.userId || null, // Don't use 'system' - use null if no user
  });
}

/**
 * Log an authentication action
 */
export async function logAuth(
  action:
    | 'LOGIN'
    | 'LOGOUT'
    | 'LOGIN_FAILED'
    | 'PASSWORD_CHANGE'
    | 'PASSWORD_RESET'
    | 'TOKEN_REFRESH',
  userId: string,
  context: Partial<AuditLogEntry>,
  status: AuditStatus = 'SUCCESS'
): Promise<AuditLog> {
  return createAuditLog({
    action,
    resource: 'AUTH',
    resourceId: userId,
    status,
    ...context,
    userId,
  });
}

/**
 * Log an error/failure
 */
export async function logFailure(
  action: string,
  resource: string,
  resourceId: string,
  error: string,
  context: Partial<AuditLogEntry>
): Promise<AuditLog> {
  return createAuditLog({
    action,
    resource,
    resourceId,
    status: 'FAILURE',
    errorMessage: error,
    ...context,
    userId: context.userId || 'system',
  });
}

// ===== DIFF CALCULATION =====

/**
 * Calculate the difference between two objects
 */
export function calculateDiff(oldObj: any, newObj: any): FieldChange[] {
  const changes: FieldChange[] = [];

  if (!oldObj || !newObj) {
    return changes;
  }

  // Get all keys from both objects
  const allKeys = new Set([
    ...Object.keys(oldObj || {}),
    ...Object.keys(newObj || {}),
  ]);

  for (const key of allKeys) {
    const oldValue = oldObj?.[key];
    const newValue = newObj?.[key];

    // Skip internal fields
    if (key.startsWith('_') || key === 'password' || key === 'passwordHash') {
      continue;
    }

    // Check if values are different
    if (!deepEqual(oldValue, newValue)) {
      changes.push({
        field: key,
        oldValue: sanitizeValue(oldValue),
        newValue: sanitizeValue(newValue),
      });
    }
  }

  return changes;
}

/**
 * Deep equality check
 */
function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;

  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }

  if (typeof a === 'object') {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every(key => deepEqual(a[key], b[key]));
  }

  return false;
}

/**
 * Sanitize sensitive values
 */
function sanitizeValue(value: any): any {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && value !== null) {
    const sanitized: any = {};
    for (const [key, val] of Object.entries(value)) {
      // Skip sensitive fields
      if (
        ['password', 'passwordHash', 'token', 'secret', 'apiKey'].includes(key)
      ) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = sanitizeValue(val);
      }
    }
    return sanitized;
  }
  return value;
}

// ===== SEARCH & QUERY =====

/**
 * Search audit logs with filters
 */
export async function searchAuditLogs(
  params: AuditSearchParams
): Promise<AuditSearchResult> {
  const {
    organizationId,
    userId,
    resource,
    resourceId,
    action,
    status,
    startDate,
    endDate,
    branchId,
    requestId,
    page = 1,
    limit = 50,
    sortBy = 'timestamp',
    sortOrder = 'desc',
  } = params;

  // Build where clause
  const where: Prisma.AuditLogWhereInput = {};

  if (organizationId) where.organizationId = organizationId;
  if (userId) where.userId = userId;
  if (resource) where.resource = resource;
  if (resourceId) where.resourceId = resourceId;
  if (action) where.action = action;
  if (status) where.status = status;
  if (branchId) where.branchId = branchId;
  if (requestId) where.requestId = requestId;

  if (startDate || endDate) {
    where.timestamp = {};
    if (startDate) where.timestamp.gte = startDate;
    if (endDate) where.timestamp.lte = endDate;
  }

  // Get total count
  const total = await prisma.auditLog.count({ where });

  // Get paginated results.
  //
  // The user relation is included because the trail is read by people: without
  // it the UI had nothing but the raw userId and showed the first eight
  // characters of a UUID in the "User" column, which identifies nobody.
  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { [sortBy]: sortOrder },
    skip: (page - 1) * limit,
    take: limit,
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
        },
      },
      organization: {
        select: { id: true, name: true },
      },
    },
  });

  return {
    logs,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * Get entity history (all changes to a specific entity)
 */
export async function getEntityHistory(
  resource: string,
  resourceId: string
): Promise<EntityHistory> {
  const logs = await prisma.auditLog.findMany({
    where: { resource, resourceId },
    orderBy: { timestamp: 'desc' },
  });

  // Get current state from the most recent CREATE or UPDATE
  let currentState = null;
  for (const log of logs) {
    if (log.newValue && log.action !== 'DELETE') {
      currentState = log.newValue;
      break;
    }
  }

  const history = logs.map(log => ({
    action: log.action,
    timestamp: log.timestamp,
    userId: log.userId || 'system',
    previousValue: log.previousValue,
    newValue: log.newValue,
    changes:
      (log.changes as any)?.fieldChanges ||
      calculateDiff(log.previousValue, log.newValue),
  }));

  return {
    resource,
    resourceId,
    currentState,
    history,
  };
}

/**
 * Get user activity log
 */
export async function getUserActivity(
  userId: string,
  options: { startDate?: Date; endDate?: Date; limit?: number } = {}
): Promise<AuditLog[]> {
  const { startDate, endDate, limit = 100 } = options;

  const where: Prisma.AuditLogWhereInput = { userId };

  if (startDate || endDate) {
    where.timestamp = {};
    if (startDate) where.timestamp.gte = startDate;
    if (endDate) where.timestamp.lte = endDate;
  }

  return prisma.auditLog.findMany({
    where,
    orderBy: { timestamp: 'desc' },
    take: limit,
  });
}

// ===== STATISTICS =====

/**
 * Get audit statistics for an organization
 */
export async function getAuditStats(
  organizationId: string | null | undefined,
  options: { startDate?: Date; endDate?: Date } = {}
): Promise<AuditStats> {
  const { startDate, endDate } = options;

  // A super admin belongs to no organization, so an absent id means
  // platform-wide rather than "no data". The controller used to reject the
  // request outright in that case.
  const where: Prisma.AuditLogWhereInput = organizationId
    ? { organizationId }
    : {};

  if (startDate || endDate) {
    where.timestamp = {};
    if (startDate) where.timestamp.gte = startDate;
    if (endDate) where.timestamp.lte = endDate;
  }

  // Total count
  const totalLogs = await prisma.auditLog.count({ where });

  // Group by action
  const byAction = await prisma.auditLog.groupBy({
    by: ['action'],
    where,
    _count: { action: true },
  });

  // Group by resource
  const byResource = await prisma.auditLog.groupBy({
    by: ['resource'],
    where,
    _count: { resource: true },
  });

  // Group by status
  const byStatus = await prisma.auditLog.groupBy({
    by: ['status'],
    where,
    _count: { status: true },
  });

  // Top users
  const byUser = await prisma.auditLog.groupBy({
    by: ['userId'],
    where,
    _count: { userId: true },
    orderBy: { _count: { userId: 'desc' } },
    take: 10,
  });

  // Recent activity
  const recentActivity = await prisma.auditLog.findMany({
    where,
    orderBy: { timestamp: 'desc' },
    take: 10,
    include: {
      user: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
    },
  });

  // Names for the busiest users, so the panel reads as people not identifiers.
  const topUserIds = byUser
    .map(u => u.userId)
    .filter((id): id is string => Boolean(id));

  const topUserRecords = topUserIds.length
    ? await prisma.user.findMany({
        where: { id: { in: topUserIds } },
        select: { id: true, firstName: true, lastName: true, email: true },
      })
    : [];

  const userNames = new Map(
    topUserRecords.map(u => [
      u.id,
      [u.firstName, u.lastName].filter(Boolean).join(' ').trim() ||
        u.email ||
        u.id,
    ])
  );

  // Activity by hour of day.
  //
  // Grouping on `timestamp` itself would produce one group per row - the column
  // is millisecond-precision, so it is effectively unique - and pull the entire
  // table back to count it. The bucketing belongs in the database.
  const hourRows = await prisma.$queryRaw<
    Array<{ hour: number; count: bigint }>
  >(
    Prisma.sql`
      SELECT EXTRACT(HOUR FROM "timestamp")::int AS hour, COUNT(*)::bigint AS count
      FROM "audit_logs"
      WHERE ${organizationId ? Prisma.sql`"organizationId" = ${organizationId}` : Prisma.sql`TRUE`}
        AND ${startDate ? Prisma.sql`"timestamp" >= ${startDate}` : Prisma.sql`TRUE`}
        AND ${endDate ? Prisma.sql`"timestamp" <= ${endDate}` : Prisma.sql`TRUE`}
      GROUP BY 1
    `
  );

  const hourCounts = new Array<number>(24).fill(0);
  for (const row of hourRows) {
    const hour = Number(row.hour);
    if (hour >= 0 && hour < 24) hourCounts[hour] = Number(row.count);
  }

  const statusCount = (target: AuditStatus) =>
    byStatus.find(entry => entry.status === target)?._count.status ?? 0;

  const actionCounts = byAction.map(a => ({
    action: a.action,
    count: a._count.action,
  }));
  const resourceCounts = byResource.map(e => ({
    resource: e.resource,
    count: e._count.resource,
  }));

  return {
    totalLogs,
    successCount: statusCount('SUCCESS' as AuditStatus),
    failureCount: statusCount('FAILURE' as AuditStatus),
    topActions: [...actionCounts].sort((a, b) => b.count - a.count).slice(0, 10),
    topResources: [...resourceCounts]
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    topUsers: byUser
      .filter(u => u.userId)
      .map(u => ({
        userId: u.userId as string,
        userName: userNames.get(u.userId as string) || 'Unknown user',
        count: u._count.userId,
      })),
    activityByHour: hourCounts.map((count, hour) => ({ hour, count })),
    byAction: actionCounts,
    byResource: resourceCounts,
    byStatus: byStatus.map(s => ({
      status: s.status as AuditStatus,
      count: s._count.status,
    })),
    byUser: byUser.map(u => ({
      userId: u.userId || 'system',
      count: u._count.userId,
    })),
    recentActivity,
  };
}

// ===== EXPORT =====

/**
 * Export audit logs to CSV format
 */
export async function exportAuditLogs(
  params: AuditSearchParams
): Promise<string> {
  // Get all logs matching the criteria (with a high limit)
  const result = await searchAuditLogs({ ...params, limit: 10000 });
  const logs = result.logs;

  // CSV header
  const headers = [
    'ID',
    'Timestamp',
    'Action',
    'Resource',
    'Resource ID',
    'User ID',
    'Organization ID',
    'Branch ID',
    'Status',
    'Duration (ms)',
    'IP Address',
    'Request ID',
  ];

  // Convert logs to CSV rows
  const rows = logs.map(log => [
    log.id,
    log.timestamp.toISOString(),
    log.action,
    log.resource,
    log.resourceId || '',
    log.userId || '',
    log.organizationId || '',
    log.branchId || '',
    log.status,
    log.duration || '',
    log.ipAddress || '',
    log.requestId || '',
  ]);

  // Build CSV string
  const csvContent = [
    headers.join(','),
    ...rows.map(row =>
      row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    ),
  ].join('\n');

  return csvContent;
}

/**
 * Export audit logs to JSON format
 */
export async function exportAuditLogsJson(
  params: AuditSearchParams
): Promise<AuditLog[]> {
  const result = await searchAuditLogs({ ...params, limit: 10000 });
  return result.logs;
}

// ===== CLEANUP =====

/**
 * Archive old audit logs (for reference - implement based on your needs)
 */
export async function archiveOldLogs(
  olderThan: Date,
  organizationId?: string
): Promise<{ count: number }> {
  const where: Prisma.AuditLogWhereInput = {
    timestamp: { lt: olderThan },
  };

  if (organizationId) {
    where.organizationId = organizationId;
  }

  // Count what would be archived
  const count = await prisma.auditLog.count({ where });

  // In production, you would:
  // 1. Export to cold storage
  // 2. Delete from main table
  // For now, just return the count

  return { count };
}

/**
 * Generate a unique request ID for tracking
 */
export function generateRequestId(): string {
  return randomUUID();
}

export const auditService = {
  // Core logging
  createAuditLog,
  logCreate,
  logRead,
  logUpdate,
  logDelete,
  logAuth,
  logFailure,

  // Diff calculation
  calculateDiff,

  // Search & Query
  searchAuditLogs,
  getEntityHistory,
  getUserActivity,

  // Statistics
  getAuditStats,

  // Export
  exportAuditLogs,
  exportAuditLogsJson,

  // Utilities
  archiveOldLogs,
  generateRequestId,
};

export default auditService;
