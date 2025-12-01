import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requirePermission, requireAnyPermission } from '../middleware/permissions';
import { PERMISSIONS } from '../constants/permissions';
import auditController from '../controllers/audit.controller';

const router = Router();

// Apply authentication to all audit routes
router.use(authenticate);

/**
 * @route   GET /api/v1/audit/logs
 * @desc    Search audit logs
 * @access  Private (requires AUDIT_VIEW permission)
 */
router.get(
  '/logs',
  requirePermission(PERMISSIONS.AUDIT_VIEW),
  auditController.searchAuditLogs
);

/**
 * @route   GET /api/v1/audit/logs/:id
 * @desc    Get audit log by ID
 * @access  Private (requires AUDIT_VIEW permission)
 */
router.get(
  '/logs/:id',
  requirePermission(PERMISSIONS.AUDIT_VIEW),
  auditController.getAuditLogById
);

/**
 * @route   GET /api/v1/audit/me/activity
 * @desc    Get current user's activity log
 * @access  Private (authenticated users only)
 */
router.get(
  '/me/activity',
  auditController.getMyActivity
);

/**
 * @route   GET /api/v1/audit/users/:userId/activity
 * @desc    Get a specific user's activity log
 * @access  Private (requires AUDIT_VIEW or USERS_VIEW permission)
 */
router.get(
  '/users/:userId/activity',
  requireAnyPermission(PERMISSIONS.AUDIT_VIEW, PERMISSIONS.USERS_VIEW),
  auditController.getUserActivity
);

/**
 * @route   GET /api/v1/audit/history/:resource/:resourceId
 * @desc    Get entity history
 * @access  Private (requires AUDIT_HISTORY permission)
 */
router.get(
  '/history/:resource/:resourceId',
  requirePermission(PERMISSIONS.AUDIT_HISTORY),
  auditController.getEntityHistory
);

/**
 * @route   GET /api/v1/audit/stats
 * @desc    Get audit statistics
 * @access  Private (requires AUDIT_VIEW permission)
 */
router.get(
  '/stats',
  requirePermission(PERMISSIONS.AUDIT_VIEW),
  auditController.getAuditStats
);

/**
 * @route   GET /api/v1/audit/export/csv
 * @desc    Export audit logs as CSV
 * @access  Private (requires AUDIT_EXPORT permission)
 */
router.get(
  '/export/csv',
  requirePermission(PERMISSIONS.AUDIT_EXPORT),
  auditController.exportAuditLogsCsv
);

/**
 * @route   GET /api/v1/audit/export/json
 * @desc    Export audit logs as JSON
 * @access  Private (requires AUDIT_EXPORT permission)
 */
router.get(
  '/export/json',
  requirePermission(PERMISSIONS.AUDIT_EXPORT),
  auditController.exportAuditLogsJson
);

/**
 * @route   GET /api/v1/audit/archive/count
 * @desc    Get count of logs that would be archived (dry run)
 * @access  Private (requires AUDIT_VIEW permission)
 */
router.get(
  '/archive/count',
  requirePermission(PERMISSIONS.AUDIT_VIEW),
  auditController.getArchiveCount
);

export default router;
