import { prisma } from '../config/database';
import { AuditLog, Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

// AuditStatus type (matches Prisma enum)
export type AuditStatus = 'SUCCESS' | 'FAILURE' | 'PARTIAL';

// Types
export interface AuditLogEntry {
  action: string;
  resource: string;       // Entity type (CLIENT, LOAN, etc.)
  resourceId: string;     // Entity ID
  userId: string;
  organizationId?: string;
  branchId?: string;
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

export interface AuditStats {
  totalLogs: number;
  byAction: { action: string; count: number }[];
  byResource: { resource: string; count: number }[];
  byStatus: { status: AuditStatus; count: number }[];
  byUser: { userId: string; count: number }[];
  recentActivity: AuditLog[];
}

// ===== CORE AUDIT LOGGING =====

/**
 * Create an audit log entry
 */
export async function createAuditLog(entry: AuditLogEntry): Promise<AuditLog> {
  return prisma.auditLog.create({
    data: {
      action: entry.action,
      resource: entry.resource,
      resourceId: entry.resourceId || null,
      userId: entry.userId || null,
      organizationId: entry.organizationId || null,
      branchId: entry.branchId || null,
      previousValue: entry.previousValue || Prisma.DbNull,
      newValue: entry.newValue || Prisma.DbNull,
      changes: entry.changes || Prisma.DbNull,
      status: entry.status || 'SUCCESS',
      duration: entry.duration || null,
      requestId: entry.requestId || null,
      sessionId: entry.sessionId || null,
      ipAddress: entry.ipAddress || null,
      userAgent: entry.userAgent || null,
      errorMessage: entry.errorMessage || null
    }
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
    userId: context.userId || 'system'
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
    userId: context.userId || 'system'
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
    userId: context.userId || 'system'
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
    userId: context.userId || 'system'
  });
}

/**
 * Log an authentication action
 */
export async function logAuth(
  action: 'LOGIN' | 'LOGOUT' | 'LOGIN_FAILED' | 'PASSWORD_CHANGE' | 'PASSWORD_RESET' | 'TOKEN_REFRESH',
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
    userId
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
    userId: context.userId || 'system'
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
    ...Object.keys(newObj || {})
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
        newValue: sanitizeValue(newValue)
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
      if (['password', 'passwordHash', 'token', 'secret', 'apiKey'].includes(key)) {
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
export async function searchAuditLogs(params: AuditSearchParams): Promise<AuditSearchResult> {
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
    sortOrder = 'desc'
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

  // Get paginated results
  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { [sortBy]: sortOrder },
    skip: (page - 1) * limit,
    take: limit
  });

  return {
    logs,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit)
  };
}

/**
 * Get entity history (all changes to a specific entity)
 */
export async function getEntityHistory(resource: string, resourceId: string): Promise<EntityHistory> {
  const logs = await prisma.auditLog.findMany({
    where: { resource, resourceId },
    orderBy: { timestamp: 'desc' }
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
    changes: (log.changes as any)?.fieldChanges || calculateDiff(log.previousValue, log.newValue)
  }));

  return {
    resource,
    resourceId,
    currentState,
    history
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
    take: limit
  });
}

// ===== STATISTICS =====

/**
 * Get audit statistics for an organization
 */
export async function getAuditStats(
  organizationId: string,
  options: { startDate?: Date; endDate?: Date } = {}
): Promise<AuditStats> {
  const { startDate, endDate } = options;

  const where: Prisma.AuditLogWhereInput = { organizationId };

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
    _count: { action: true }
  });

  // Group by resource
  const byResource = await prisma.auditLog.groupBy({
    by: ['resource'],
    where,
    _count: { resource: true }
  });

  // Group by status
  const byStatus = await prisma.auditLog.groupBy({
    by: ['status'],
    where,
    _count: { status: true }
  });

  // Top users
  const byUser = await prisma.auditLog.groupBy({
    by: ['userId'],
    where,
    _count: { userId: true },
    orderBy: { _count: { userId: 'desc' } },
    take: 10
  });

  // Recent activity
  const recentActivity = await prisma.auditLog.findMany({
    where,
    orderBy: { timestamp: 'desc' },
    take: 10
  });

  return {
    totalLogs,
    byAction: byAction.map(a => ({ action: a.action, count: a._count.action })),
    byResource: byResource.map(e => ({ resource: e.resource, count: e._count.resource })),
    byStatus: byStatus.map(s => ({ status: s.status as AuditStatus, count: s._count.status })),
    byUser: byUser.map(u => ({ userId: u.userId || 'system', count: u._count.userId })),
    recentActivity
  };
}

// ===== EXPORT =====

/**
 * Export audit logs to CSV format
 */
export async function exportAuditLogs(params: AuditSearchParams): Promise<string> {
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
    'Request ID'
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
    log.requestId || ''
  ]);

  // Build CSV string
  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
  ].join('\n');

  return csvContent;
}

/**
 * Export audit logs to JSON format
 */
export async function exportAuditLogsJson(params: AuditSearchParams): Promise<AuditLog[]> {
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
    timestamp: { lt: olderThan }
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
  return uuidv4();
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
  generateRequestId
};

export default auditService;
