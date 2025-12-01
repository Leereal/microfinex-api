import { Request, Response, NextFunction } from 'express';
import auditService from '../services/audit.service';

/**
 * Search audit logs
 * GET /api/v1/audit/logs
 */
export async function searchAuditLogs(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
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
    } = req.query;

    // Use user's organizationId if not provided (for non-admin users)
    const orgId = (organizationId as string) || req.userContext?.organizationId;

    const result = await auditService.searchAuditLogs({
      organizationId: orgId,
      userId: userId as string,
      resource: resource as string,
      resourceId: resourceId as string,
      action: action as string,
      status: status as any,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
      branchId: branchId as string,
      requestId: requestId as string,
      page: parseInt(page as string) || 1,
      limit: parseInt(limit as string) || 50,
      sortBy: sortBy as string,
      sortOrder: sortOrder as 'asc' | 'desc',
    });

    res.status(200).json({
      success: true,
      data: result.logs,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: result.totalPages,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get audit log by ID
 * GET /api/v1/audit/logs/:id
 */
export async function getAuditLogById(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;

    const log = await auditService.searchAuditLogs({
      page: 1,
      limit: 1,
    });

    // Find the specific log
    const result = log.logs.find(l => l.id === id);

    if (!result) {
      res.status(404).json({
        success: false,
        message: 'Audit log not found',
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get entity history
 * GET /api/v1/audit/history/:resource/:resourceId
 */
export async function getEntityHistory(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { resource, resourceId } = req.params;

    if (!resource || !resourceId) {
      res.status(400).json({
        success: false,
        message: 'Resource and resourceId are required',
      });
      return;
    }

    const history = await auditService.getEntityHistory(resource, resourceId);

    res.status(200).json({
      success: true,
      data: history,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get user activity
 * GET /api/v1/audit/users/:userId/activity
 */
export async function getUserActivity(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.params.userId!;
    const { startDate, endDate, limit = 100 } = req.query;

    const activity = await auditService.getUserActivity(userId, {
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
      limit: parseInt(limit as string) || 100,
    });

    res.status(200).json({
      success: true,
      data: activity,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get my activity (current user)
 * GET /api/v1/audit/me/activity
 */
export async function getMyActivity(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.userContext?.id;

    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'User not authenticated',
      });
      return;
    }

    const { startDate, endDate, limit = 100 } = req.query;

    const activity = await auditService.getUserActivity(userId as string, {
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
      limit: parseInt(limit as string) || 100,
    });

    res.status(200).json({
      success: true,
      data: activity,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get audit statistics
 * GET /api/v1/audit/stats
 */
export async function getAuditStats(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { organizationId, startDate, endDate } = req.query;

    // Use user's organizationId if not provided
    const orgId = (organizationId as string) || req.userContext?.organizationId;

    if (!orgId) {
      res.status(400).json({
        success: false,
        message: 'Organization ID is required',
      });
      return;
    }

    const stats = await auditService.getAuditStats(orgId, {
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
    });

    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Export audit logs (CSV)
 * GET /api/v1/audit/export/csv
 */
export async function exportAuditLogsCsv(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
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
    } = req.query;

    // Use user's organizationId if not provided
    const orgId = (organizationId as string) || req.userContext?.organizationId;

    const csvContent = await auditService.exportAuditLogs({
      organizationId: orgId,
      userId: userId as string,
      resource: resource as string,
      resourceId: resourceId as string,
      action: action as string,
      status: status as any,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
      branchId: branchId as string,
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=audit-logs-${new Date().toISOString().split('T')[0]}.csv`
    );
    res.status(200).send(csvContent);
  } catch (error) {
    next(error);
  }
}

/**
 * Export audit logs (JSON)
 * GET /api/v1/audit/export/json
 */
export async function exportAuditLogsJson(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
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
    } = req.query;

    // Use user's organizationId if not provided
    const orgId = (organizationId as string) || req.userContext?.organizationId;

    const logs = await auditService.exportAuditLogsJson({
      organizationId: orgId,
      userId: userId as string,
      resource: resource as string,
      resourceId: resourceId as string,
      action: action as string,
      status: status as any,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
      branchId: branchId as string,
    });

    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=audit-logs-${new Date().toISOString().split('T')[0]}.json`
    );
    res.status(200).json(logs);
  } catch (error) {
    next(error);
  }
}

/**
 * Get archive count (dry run)
 * GET /api/v1/audit/archive/count
 */
export async function getArchiveCount(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { olderThan, organizationId } = req.query;

    if (!olderThan) {
      res.status(400).json({
        success: false,
        message: 'olderThan date is required',
      });
      return;
    }

    const orgId = (organizationId as string) || req.userContext?.organizationId;

    const result = await auditService.archiveOldLogs(
      new Date(olderThan as string),
      orgId
    );

    res.status(200).json({
      success: true,
      data: {
        logsToArchive: result.count,
        olderThan: olderThan,
      },
    });
  } catch (error) {
    next(error);
  }
}

export const auditController = {
  searchAuditLogs,
  getAuditLogById,
  getEntityHistory,
  getUserActivity,
  getMyActivity,
  getAuditStats,
  exportAuditLogsCsv,
  exportAuditLogsJson,
  getArchiveCount,
};

export default auditController;
