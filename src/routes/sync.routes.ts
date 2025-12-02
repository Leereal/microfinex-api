import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth-supabase';
import { validateRequest } from '../middleware/validation';
import { UserRole } from '../types';
import { syncService } from '../services/sync.service';
import { SyncAction } from '@prisma/client';

const router = Router();

// ===== SYNC ROUTES =====
// Offline-first data synchronization endpoints

// Push changes schema
const pushChangesSchema = z.object({
  changes: z.array(
    z.object({
      entityType: z.string(),
      entityId: z.string().uuid(),
      action: z.enum(['CREATE', 'UPDATE', 'DELETE']),
      payload: z.record(z.any()),
      clientVersion: z.number().int().optional(),
      deviceId: z.string().optional(),
      timestamp: z.string().datetime().optional(),
    })
  ),
});

// Pull changes query schema
const pullChangesSchema = z.object({
  lastSync: z.string().datetime().optional(),
  entityTypes: z.string().optional(), // comma-separated
  limit: z.string().regex(/^\d+$/).optional(),
});

// Resolve conflicts schema
const resolveConflictsSchema = z.object({
  resolutions: z.array(
    z.object({
      conflictId: z.string().uuid(),
      resolution: z.enum(['CLIENT_WINS', 'SERVER_WINS', 'MERGED']),
      mergedData: z.record(z.any()).optional(),
    })
  ),
});

/**
 * @swagger
 * /api/v1/sync/push:
 *   post:
 *     summary: Push offline changes to server
 *     description: Upload queued changes from offline client
 *     tags: [Sync]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/push',
  authenticate,
  validateRequest(pushChangesSchema),
  async (req: Request, res: Response) => {
    try {
      const organizationId = req.user?.organizationId;
      const userId = (req.user as any)?.userId || (req.user as any)?.id;

      if (!organizationId || !userId) {
        return res.status(403).json({
          success: false,
          message: 'Organization and user context required',
          error: 'FORBIDDEN',
          timestamp: new Date().toISOString(),
        });
      }

      const { changes } = req.body;

      // Transform action strings to enum values
      const transformedChanges = changes.map((change: any) => ({
        ...change,
        action: change.action as SyncAction,
      }));

      const result = await syncService.pushChanges(
        organizationId,
        userId,
        transformedChanges
      );

      res.json({
        success: true,
        message: `Synced ${result.synced.length} changes`,
        data: {
          synced: result.synced,
          failed: result.failed,
          conflicts: result.conflicts,
          summary: {
            total: changes.length,
            synced: result.synced.length,
            failed: result.failed.length,
            conflicts: result.conflicts.length,
          },
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Sync push error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Sync push failed',
        error: 'SYNC_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/sync/pull:
 *   get:
 *     summary: Pull latest changes from server
 *     description: Download incremental changes since last sync
 *     tags: [Sync]
 *     security:
 *       - bearerAuth: []
 */
router.get('/pull', authenticate, async (req: Request, res: Response) => {
  try {
    const organizationId = req.user?.organizationId;
    const userId = (req.user as any)?.userId || (req.user as any)?.id;

    if (!organizationId || !userId) {
      return res.status(403).json({
        success: false,
        message: 'Organization and user context required',
        error: 'FORBIDDEN',
        timestamp: new Date().toISOString(),
      });
    }

    const { lastSync, entityTypes, limit } = req.query;

    const result = await syncService.pullChanges(organizationId, userId, {
      lastSync: lastSync ? new Date(lastSync as string) : undefined,
      entityTypes: entityTypes ? (entityTypes as string).split(',') : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
    });

    res.json({
      success: true,
      message: `Retrieved ${result.changes.length} changes`,
      data: {
        changes: result.changes,
        lastSync: result.lastSync.toISOString(),
        hasMore: result.hasMore,
        summary: {
          total: result.changes.length,
          byType: result.changes.reduce(
            (acc, change) => {
              acc[change.entityType] = (acc[change.entityType] || 0) + 1;
              return acc;
            },
            {} as Record<string, number>
          ),
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Sync pull error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Sync pull failed',
      error: 'SYNC_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @swagger
 * /api/v1/sync/resolve:
 *   post:
 *     summary: Resolve sync conflicts
 *     description: Manually resolve conflicts with CLIENT_WINS, SERVER_WINS, or MERGED
 *     tags: [Sync]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/resolve',
  authenticate,
  validateRequest(resolveConflictsSchema),
  async (req: Request, res: Response) => {
    try {
      const organizationId = req.user?.organizationId;
      const userId = (req.user as any)?.userId || (req.user as any)?.id;

      if (!organizationId || !userId) {
        return res.status(403).json({
          success: false,
          message: 'Organization and user context required',
          error: 'FORBIDDEN',
          timestamp: new Date().toISOString(),
        });
      }

      const { resolutions } = req.body;

      const result = await syncService.resolveConflicts(
        organizationId,
        userId,
        resolutions
      );

      res.json({
        success: true,
        message: `Resolved ${result.resolved.length} conflicts`,
        data: {
          resolved: result.resolved,
          failed: result.failed,
          summary: {
            total: resolutions.length,
            resolved: result.resolved.length,
            failed: result.failed.length,
          },
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Conflict resolution error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Conflict resolution failed',
        error: 'RESOLUTION_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/sync/conflicts:
 *   get:
 *     summary: Get pending sync conflicts
 *     tags: [Sync]
 *     security:
 *       - bearerAuth: []
 */
router.get('/conflicts', authenticate, async (req: Request, res: Response) => {
  try {
    const organizationId = req.user?.organizationId;
    const userId = (req.user as any)?.userId || (req.user as any)?.id;

    if (!organizationId || !userId) {
      return res.status(403).json({
        success: false,
        message: 'Organization and user context required',
        error: 'FORBIDDEN',
        timestamp: new Date().toISOString(),
      });
    }

    const conflicts = await syncService.getPendingConflicts(
      organizationId,
      userId
    );

    res.json({
      success: true,
      message: `Found ${conflicts.length} pending conflicts`,
      data: { conflicts },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Get conflicts error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get conflicts',
      error: 'CONFLICT_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @swagger
 * /api/v1/sync/status/{entityType}/{entityId}:
 *   get:
 *     summary: Get sync status for a specific entity
 *     tags: [Sync]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/status/:entityType/:entityId',
  authenticate,
  async (req: Request, res: Response) => {
    try {
      const orgId = req.user?.organizationId;
      const { entityType: entityTypeParam, entityId: entityIdParam } =
        req.params;

      if (!orgId || !entityTypeParam || !entityIdParam) {
        return res.status(403).json({
          success: false,
          message: 'Organization context and entity details required',
          error: 'FORBIDDEN',
          timestamp: new Date().toISOString(),
        });
      }
      const organizationId: string = orgId;
      const entityType: string = entityTypeParam;
      const entityId: string = entityIdParam;

      const status = await syncService.getEntitySyncStatus(
        organizationId,
        entityType,
        entityId
      );

      res.json({
        success: true,
        message: 'Sync status retrieved',
        data: { status },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Get sync status error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to get sync status',
        error: 'STATUS_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/sync/info:
 *   get:
 *     summary: Get sync system information
 *     description: Returns supported entity types and sync configuration
 *     tags: [Sync]
 *     security:
 *       - bearerAuth: []
 */
router.get('/info', authenticate, async (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      message: 'Sync info retrieved',
      data: {
        supportedEntityTypes: [
          'clients',
          'loans',
          'payments',
          'visits',
          'pledges',
          'assessments',
          'groups',
        ],
        supportedActions: ['CREATE', 'UPDATE', 'DELETE'],
        conflictResolutions: ['CLIENT_WINS', 'SERVER_WINS', 'MERGED'],
        pullLimit: 100,
        instructions: {
          push: 'POST /sync/push with changes array. Returns synced, failed, and conflicts.',
          pull: 'GET /sync/pull?lastSync=ISO8601&entityTypes=clients,loans&limit=50',
          resolve: 'POST /sync/resolve with resolutions array for conflicts.',
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Get sync info error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get sync info',
      error: 'INFO_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
