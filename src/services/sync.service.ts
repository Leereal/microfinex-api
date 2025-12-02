import { prisma } from '../config/database';
import { SyncStatus, SyncAction, Prisma } from '@prisma/client';

// ===== SYNC SERVICE =====
// Handles offline-first data synchronization

interface SyncPushItem {
  entityType: string;
  entityId: string;
  action: SyncAction;
  payload: Record<string, any>;
  clientVersion?: number;
  deviceId?: string;
  timestamp?: string;
}

interface SyncPullOptions {
  lastSync?: Date;
  entityTypes?: string[];
  limit?: number;
}

interface SyncConflictData {
  syncQueueId: string;
  entityType: string;
  entityId: string;
  clientVersion: number;
  serverVersion: number;
  clientData: Record<string, any>;
  serverData: Record<string, any>;
}

interface SyncResolution {
  conflictId: string;
  resolution: 'CLIENT_WINS' | 'SERVER_WINS' | 'MERGED';
  mergedData?: Record<string, any>;
}

// Supported entity types for sync
const SYNCABLE_ENTITIES = [
  'clients',
  'loans',
  'payments',
  'visits',
  'pledges',
  'assessments',
  'groups',
] as const;

type SyncableEntity = (typeof SYNCABLE_ENTITIES)[number];

export const syncService = {
  /**
   * Push queued changes from offline client
   */
  async pushChanges(
    organizationId: string,
    userId: string,
    changes: SyncPushItem[]
  ): Promise<{
    synced: string[];
    failed: Array<{ id: string; error: string }>;
    conflicts: SyncConflictData[];
  }> {
    const synced: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];
    const conflicts: SyncConflictData[] = [];

    for (const change of changes) {
      try {
        // Validate entity type
        if (!SYNCABLE_ENTITIES.includes(change.entityType as SyncableEntity)) {
          failed.push({
            id: change.entityId,
            error: `Unsupported entity type: ${change.entityType}`,
          });
          continue;
        }

        // Create sync queue entry
        const queueEntry = await prisma.syncQueue.create({
          data: {
            organizationId,
            userId,
            deviceId: change.deviceId,
            entityType: change.entityType,
            entityId: change.entityId,
            action: change.action,
            payload: change.payload,
            version: change.clientVersion || 1,
          },
        });

        // Check for version conflicts
        const entityVersion = await prisma.entityVersion.findUnique({
          where: {
            organizationId_entityType_entityId: {
              organizationId,
              entityType: change.entityType,
              entityId: change.entityId,
            },
          },
        });

        if (
          entityVersion &&
          change.clientVersion &&
          entityVersion.version > change.clientVersion
        ) {
          // Conflict detected
          const serverData = await this.getEntityData(
            organizationId,
            change.entityType,
            change.entityId
          );

          const conflict = await prisma.syncConflict.create({
            data: {
              organizationId,
              syncQueueId: queueEntry.id,
              entityType: change.entityType,
              entityId: change.entityId,
              clientVersion: change.clientVersion,
              serverVersion: entityVersion.version,
              clientData: change.payload,
              serverData: serverData || {},
            },
          });

          conflicts.push({
            syncQueueId: queueEntry.id,
            entityType: change.entityType,
            entityId: change.entityId,
            clientVersion: change.clientVersion,
            serverVersion: entityVersion.version,
            clientData: change.payload,
            serverData: serverData || {},
          });

          // Mark queue entry as conflict
          await prisma.syncQueue.update({
            where: { id: queueEntry.id },
            data: { status: SyncStatus.CONFLICT },
          });

          continue;
        }

        // Apply the change
        await this.applyChange(organizationId, userId, change);

        // Update entity version
        await prisma.entityVersion.upsert({
          where: {
            organizationId_entityType_entityId: {
              organizationId,
              entityType: change.entityType,
              entityId: change.entityId,
            },
          },
          create: {
            organizationId,
            entityType: change.entityType,
            entityId: change.entityId,
            version: (change.clientVersion || 0) + 1,
            updatedBy: userId,
          },
          update: {
            version: { increment: 1 },
            updatedAt: new Date(),
            updatedBy: userId,
          },
        });

        // Mark as synced
        await prisma.syncQueue.update({
          where: { id: queueEntry.id },
          data: {
            status: SyncStatus.SYNCED,
            syncedAt: new Date(),
            processedAt: new Date(),
          },
        });

        synced.push(change.entityId);
      } catch (error: any) {
        console.error('Sync push error:', error);
        failed.push({
          id: change.entityId,
          error: error.message || 'Unknown error',
        });
      }
    }

    return { synced, failed, conflicts };
  },

  /**
   * Pull latest data since last sync
   */
  async pullChanges(
    organizationId: string,
    userId: string,
    options: SyncPullOptions = {}
  ): Promise<{
    changes: Array<{
      entityType: string;
      entityId: string;
      action: SyncAction;
      data: Record<string, any>;
      version: number;
      updatedAt: Date;
    }>;
    lastSync: Date;
    hasMore: boolean;
  }> {
    const { lastSync, entityTypes, limit = 100 } = options;
    const changes: Array<{
      entityType: string;
      entityId: string;
      action: SyncAction;
      data: Record<string, any>;
      version: number;
      updatedAt: Date;
    }> = [];

    // Get entities updated since lastSync
    const types = entityTypes || [...SYNCABLE_ENTITIES];

    for (const entityType of types) {
      const entities = await this.getUpdatedEntities(
        organizationId,
        entityType,
        lastSync,
        Math.floor(limit / types.length)
      );

      for (const entity of entities) {
        const version = await prisma.entityVersion.findUnique({
          where: {
            organizationId_entityType_entityId: {
              organizationId,
              entityType,
              entityId: entity.id,
            },
          },
        });

        changes.push({
          entityType,
          entityId: entity.id,
          action: entity.action || SyncAction.UPDATE,
          data: entity.data,
          version: version?.version || 1,
          updatedAt: entity.updatedAt,
        });
      }
    }

    // Sort by updatedAt
    changes.sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());

    // Check if there are more changes
    const hasMore = changes.length >= limit;

    // Limit results
    const limitedChanges = changes.slice(0, limit);

    return {
      changes: limitedChanges,
      lastSync: new Date(),
      hasMore,
    };
  },

  /**
   * Resolve sync conflicts
   */
  async resolveConflicts(
    organizationId: string,
    userId: string,
    resolutions: SyncResolution[]
  ): Promise<{
    resolved: string[];
    failed: Array<{ id: string; error: string }>;
  }> {
    const resolved: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const resolution of resolutions) {
      try {
        const conflict = await prisma.syncConflict.findFirst({
          where: { id: resolution.conflictId, organizationId },
        });

        if (!conflict) {
          failed.push({
            id: resolution.conflictId,
            error: 'Conflict not found',
          });
          continue;
        }

        let dataToApply: Record<string, any>;

        switch (resolution.resolution) {
          case 'CLIENT_WINS':
            dataToApply = conflict.clientData as Record<string, any>;
            break;
          case 'SERVER_WINS':
            dataToApply = conflict.serverData as Record<string, any>;
            break;
          case 'MERGED':
            if (!resolution.mergedData) {
              failed.push({
                id: resolution.conflictId,
                error: 'Merged data required for MERGED resolution',
              });
              continue;
            }
            dataToApply = resolution.mergedData;
            break;
          default:
            failed.push({
              id: resolution.conflictId,
              error: 'Invalid resolution type',
            });
            continue;
        }

        // Apply the resolved data
        await this.applyChange(organizationId, userId, {
          entityType: conflict.entityType,
          entityId: conflict.entityId,
          action: SyncAction.UPDATE,
          payload: dataToApply,
        });

        // Update entity version
        await prisma.entityVersion.upsert({
          where: {
            organizationId_entityType_entityId: {
              organizationId,
              entityType: conflict.entityType,
              entityId: conflict.entityId,
            },
          },
          create: {
            organizationId,
            entityType: conflict.entityType,
            entityId: conflict.entityId,
            version:
              Math.max(conflict.clientVersion, conflict.serverVersion) + 1,
            updatedBy: userId,
          },
          update: {
            version:
              Math.max(conflict.clientVersion, conflict.serverVersion) + 1,
            updatedAt: new Date(),
            updatedBy: userId,
          },
        });

        // Mark conflict as resolved
        await prisma.syncConflict.update({
          where: { id: resolution.conflictId },
          data: {
            resolution: resolution.resolution,
            resolvedBy: userId,
            resolvedAt: new Date(),
          },
        });

        // Update sync queue entry
        await prisma.syncQueue.update({
          where: { id: conflict.syncQueueId },
          data: {
            status: SyncStatus.SYNCED,
            syncedAt: new Date(),
            processedAt: new Date(),
          },
        });

        resolved.push(resolution.conflictId);
      } catch (error: any) {
        console.error('Conflict resolution error:', error);
        failed.push({
          id: resolution.conflictId,
          error: error.message || 'Unknown error',
        });
      }
    }

    return { resolved, failed };
  },

  /**
   * Get pending conflicts for a user
   */
  async getPendingConflicts(organizationId: string, userId?: string) {
    const where: Prisma.SyncConflictWhereInput = {
      organizationId,
      resolution: null,
    };

    const conflicts = await prisma.syncConflict.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return conflicts;
  },

  /**
   * Get sync status for an entity
   */
  async getEntitySyncStatus(
    organizationId: string,
    entityType: string,
    entityId: string
  ) {
    const version = await prisma.entityVersion.findUnique({
      where: {
        organizationId_entityType_entityId: {
          organizationId,
          entityType,
          entityId,
        },
      },
    });

    const pendingQueue = await prisma.syncQueue.findFirst({
      where: {
        organizationId,
        entityType,
        entityId,
        status: SyncStatus.PENDING,
      },
    });

    const conflict = await prisma.syncConflict.findFirst({
      where: {
        organizationId,
        entityType,
        entityId,
        resolution: null,
      },
    });

    return {
      version: version?.version || 1,
      lastUpdated: version?.updatedAt || null,
      hasPendingChanges: !!pendingQueue,
      hasConflict: !!conflict,
      conflictId: conflict?.id || null,
    };
  },

  // ===== PRIVATE HELPER METHODS =====

  /**
   * Apply a change to the database
   */
  async applyChange(
    organizationId: string,
    userId: string,
    change: SyncPushItem
  ): Promise<void> {
    const { entityType, entityId, action, payload } = change;

    switch (entityType) {
      case 'clients':
        await this.applyClientChange(organizationId, entityId, action, payload);
        break;
      case 'loans':
        await this.applyLoanChange(organizationId, entityId, action, payload);
        break;
      case 'payments':
        await this.applyPaymentChange(
          organizationId,
          entityId,
          action,
          payload
        );
        break;
      case 'visits':
        await this.applyVisitChange(organizationId, entityId, action, payload);
        break;
      case 'pledges':
        await this.applyPledgeChange(organizationId, entityId, action, payload);
        break;
      case 'assessments':
        await this.applyAssessmentChange(
          organizationId,
          entityId,
          action,
          payload
        );
        break;
      default:
        throw new Error(`Unsupported entity type: ${entityType}`);
    }
  },

  async applyClientChange(
    organizationId: string,
    entityId: string,
    action: SyncAction,
    payload: Record<string, any>
  ): Promise<void> {
    switch (action) {
      case SyncAction.CREATE:
        // Validate required fields are present in payload
        if (
          !payload.clientNumber ||
          !payload.phone ||
          !payload.branchId ||
          !payload.createdBy
        ) {
          throw new Error(
            'Missing required fields for client creation: clientNumber, phone, branchId, createdBy'
          );
        }
        await prisma.client.create({
          data: {
            id: entityId,
            organizationId,
            clientNumber: payload.clientNumber,
            phone: payload.phone,
            branchId: payload.branchId,
            createdBy: payload.createdBy,
            ...payload,
          } as any,
        });
        break;
      case SyncAction.UPDATE:
        await prisma.client.update({
          where: { id: entityId },
          data: payload as any,
        });
        break;
      case SyncAction.DELETE:
        await prisma.client.update({
          where: { id: entityId },
          data: { isActive: false },
        });
        break;
    }
  },

  async applyLoanChange(
    organizationId: string,
    entityId: string,
    action: SyncAction,
    payload: Record<string, any>
  ): Promise<void> {
    switch (action) {
      case SyncAction.UPDATE:
        await prisma.loan.update({
          where: { id: entityId },
          data: {
            ...payload,
            syncStatus: SyncStatus.SYNCED,
            syncVersion: { increment: 1 },
          },
        });
        break;
      default:
        throw new Error(`Action ${action} not supported for loans via sync`);
    }
  },

  async applyPaymentChange(
    organizationId: string,
    entityId: string,
    action: SyncAction,
    payload: Record<string, any>
  ): Promise<void> {
    // Payments are typically not modified via sync
    throw new Error('Payments cannot be modified via offline sync');
  },

  async applyVisitChange(
    organizationId: string,
    entityId: string,
    action: SyncAction,
    payload: Record<string, any>
  ): Promise<void> {
    switch (action) {
      case SyncAction.CREATE:
        // Validate required fields
        if (!payload.visitType || !payload.loanId || !payload.visitedById) {
          throw new Error(
            'Missing required fields for visit creation: visitType, loanId, visitedById'
          );
        }
        await prisma.loanVisit.create({
          data: {
            id: entityId,
            visitType: payload.visitType,
            loanId: payload.loanId,
            visitedById: payload.visitedById,
            syncedAt: new Date(),
            ...payload,
          } as any,
        });
        break;
      case SyncAction.UPDATE:
        await prisma.loanVisit.update({
          where: { id: entityId },
          data: {
            ...payload,
            syncedAt: new Date(),
          } as any,
        });
        break;
      default:
        throw new Error(`Action ${action} not supported for visits`);
    }
  },

  async applyPledgeChange(
    organizationId: string,
    entityId: string,
    action: SyncAction,
    payload: Record<string, any>
  ): Promise<void> {
    switch (action) {
      case SyncAction.CREATE:
        // Validate required fields
        if (
          !payload.itemDescription ||
          !payload.estimatedValue ||
          !payload.status ||
          !payload.loanId
        ) {
          throw new Error(
            'Missing required fields for pledge creation: itemDescription, estimatedValue, status, loanId'
          );
        }
        await prisma.securityPledge.create({
          data: {
            id: entityId,
            itemDescription: payload.itemDescription,
            estimatedValue: payload.estimatedValue,
            status: payload.status,
            loanId: payload.loanId,
            ...payload,
          } as any,
        });
        break;
      case SyncAction.UPDATE:
        await prisma.securityPledge.update({
          where: { id: entityId },
          data: payload as any,
        });
        break;
      default:
        throw new Error(`Action ${action} not supported for pledges`);
    }
  },

  async applyAssessmentChange(
    organizationId: string,
    entityId: string,
    action: SyncAction,
    payload: Record<string, any>
  ): Promise<void> {
    switch (action) {
      case SyncAction.CREATE:
        // Validate required fields
        if (!payload.status || !payload.loanId || !payload.assessorId) {
          throw new Error(
            'Missing required fields for assessment creation: status, loanId, assessorId'
          );
        }
        await prisma.loanAssessment.create({
          data: {
            id: entityId,
            status: payload.status,
            loanId: payload.loanId,
            assessorId: payload.assessorId,
            ...payload,
          } as any,
        });
        break;
      case SyncAction.UPDATE:
        await prisma.loanAssessment.update({
          where: { id: entityId },
          data: payload as any,
        });
        break;
      default:
        throw new Error(`Action ${action} not supported for assessments`);
    }
  },

  /**
   * Get entity data by type and ID
   */
  async getEntityData(
    organizationId: string,
    entityType: string,
    entityId: string
  ): Promise<Record<string, any> | null> {
    switch (entityType) {
      case 'clients':
        return prisma.client.findFirst({
          where: { id: entityId, organizationId },
        });
      case 'loans':
        return prisma.loan.findFirst({
          where: { id: entityId, organizationId },
        });
      case 'visits':
        return prisma.loanVisit.findFirst({
          where: { id: entityId, loan: { organizationId } },
        });
      case 'pledges':
        return prisma.securityPledge.findFirst({
          where: { id: entityId, loan: { organizationId } },
        });
      case 'assessments':
        return prisma.loanAssessment.findFirst({
          where: { id: entityId, loan: { organizationId } },
        });
      default:
        return null;
    }
  },

  /**
   * Get updated entities since a timestamp
   */
  async getUpdatedEntities(
    organizationId: string,
    entityType: string,
    since?: Date,
    limit: number = 50
  ): Promise<
    Array<{
      id: string;
      data: Record<string, any>;
      updatedAt: Date;
      action?: SyncAction;
    }>
  > {
    const sinceDate = since || new Date(0);

    switch (entityType) {
      case 'clients': {
        const clients = await prisma.client.findMany({
          where: {
            organizationId,
            updatedAt: { gt: sinceDate },
          },
          take: limit,
          orderBy: { updatedAt: 'asc' },
        });
        return clients.map(c => ({
          id: c.id,
          data: c,
          updatedAt: c.updatedAt,
        }));
      }
      case 'loans': {
        const loans = await prisma.loan.findMany({
          where: {
            organizationId,
            updatedAt: { gt: sinceDate },
          },
          take: limit,
          orderBy: { updatedAt: 'asc' },
        });
        return loans.map(l => ({
          id: l.id,
          data: l,
          updatedAt: l.updatedAt,
        }));
      }
      case 'visits': {
        const visits = await prisma.loanVisit.findMany({
          where: {
            loan: { organizationId },
            updatedAt: { gt: sinceDate },
          },
          take: limit,
          orderBy: { updatedAt: 'asc' },
        });
        return visits.map(v => ({
          id: v.id,
          data: v,
          updatedAt: v.updatedAt,
        }));
      }
      case 'pledges': {
        const pledges = await prisma.securityPledge.findMany({
          where: {
            loan: { organizationId },
            updatedAt: { gt: sinceDate },
          },
          take: limit,
          orderBy: { updatedAt: 'asc' },
        });
        return pledges.map(p => ({
          id: p.id,
          data: p,
          updatedAt: p.updatedAt,
        }));
      }
      case 'assessments': {
        const assessments = await prisma.loanAssessment.findMany({
          where: {
            loan: { organizationId },
            updatedAt: { gt: sinceDate },
          },
          take: limit,
          orderBy: { updatedAt: 'asc' },
        });
        return assessments.map(a => ({
          id: a.id,
          data: a,
          updatedAt: a.updatedAt,
        }));
      }
      default:
        return [];
    }
  },
};

export default syncService;
