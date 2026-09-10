import { z } from 'zod';

import { prisma } from '../config/database';
import { PERMISSIONS } from '../constants/permissions';
import { createAuditLog, logCreate, logUpdate } from './audit.service';
import {
  NOTIFICATION_TYPES,
  inAppNotificationService,
} from './in-app-notification.service';

/**
 * Client deletion requests.
 *
 * Deleting a client destroys records other people rely on, so asking and doing
 * are separate acts here: anyone who maintains clients may raise a request
 * (clients:delete:request), and only a holder of clients:delete may approve
 * one. Approvers hear about it through the in-app notification inbox.
 *
 * Approving performs a genuine delete - the row leaves the database - but only
 * for a client who has no loans and belongs to no groups. Those two relations
 * have no cascade, and cascading them would destroy financial history that
 * reporting and reconciliation depend on. When they exist the request stays
 * pending and the approver is told exactly what is in the way.
 */

export const REQUEST_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
} as const;

export type RequestStatus =
  (typeof REQUEST_STATUS)[keyof typeof REQUEST_STATUS];

export const createDeletionRequestSchema = z.object({
  reason: z.string().trim().min(1).max(1000).optional(),
});

export const reviewDeletionRequestSchema = z.object({
  reviewNotes: z.string().trim().max(1000).optional(),
});

/** Everything that stops a client being deleted outright. */
export interface DeletionBlockers {
  loans: number;
  groupMemberships: number;
}

export class DeletionBlockedError extends Error {
  constructor(
    message: string,
    public readonly blockers: DeletionBlockers
  ) {
    super(message);
    this.name = 'DeletionBlockedError';
  }
}

export class DeletionRequestError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = 'DeletionRequestError';
  }
}

interface ActorContext {
  userId: string;
  organizationId: string;
  ipAddress?: string;
  userAgent?: string;
}

const clientLabel = (client: {
  firstName?: string | null;
  lastName?: string | null;
  businessName?: string | null;
  clientNumber?: string | null;
}) => {
  const name =
    [client.firstName, client.lastName].filter(Boolean).join(' ').trim() ||
    client.businessName ||
    'this client';
  return client.clientNumber ? `${name} (${client.clientNumber})` : name;
};

const requestInclude = {
  client: {
    select: {
      id: true,
      clientNumber: true,
      firstName: true,
      lastName: true,
      businessName: true,
      phone: true,
      idNumber: true,
      isActive: true,
      branch: { select: { id: true, name: true } },
    },
  },
  requestedBy: {
    select: { id: true, firstName: true, lastName: true, email: true },
  },
  reviewedBy: {
    select: { id: true, firstName: true, lastName: true, email: true },
  },
} as const;

class ClientDeletionRequestService {
  /** What would stop this client being deleted. */
  async findBlockers(clientId: string): Promise<DeletionBlockers> {
    const [loans, groupMemberships] = await Promise.all([
      prisma.loan.count({ where: { clientId } }),
      prisma.groupMember.count({ where: { clientId } }),
    ]);
    return { loans, groupMemberships };
  }

  /** A sentence naming what is in the way, or null when nothing is. */
  describeBlockers(blockers: DeletionBlockers): string | null {
    const parts: string[] = [];
    if (blockers.loans > 0) {
      parts.push(`${blockers.loans} loan${blockers.loans === 1 ? '' : 's'}`);
    }
    if (blockers.groupMemberships > 0) {
      parts.push(
        `${blockers.groupMemberships} group membership${
          blockers.groupMemberships === 1 ? '' : 's'
        }`
      );
    }
    if (parts.length === 0) return null;

    return `This client cannot be deleted while they still have ${parts.join(
      ' and '
    )}. Close or reassign those first, then approve this request again.`;
  }

  /**
   * Raise a request to delete a client.
   *
   * A client already awaiting review is not queued twice - the existing
   * request is returned, so a second click does not spam every approver.
   */
  async create(
    clientId: string,
    reason: string | undefined,
    actor: ActorContext
  ) {
    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId: actor.organizationId },
      select: {
        id: true,
        clientNumber: true,
        firstName: true,
        lastName: true,
        businessName: true,
      },
    });

    if (!client) {
      throw new DeletionRequestError('Client not found', 'CLIENT_NOT_FOUND');
    }

    const existing = await prisma.clientDeletionRequest.findFirst({
      where: { clientId, status: REQUEST_STATUS.PENDING },
      include: requestInclude,
    });
    if (existing) return { request: existing, alreadyPending: true };

    const request = await prisma.clientDeletionRequest.create({
      data: {
        organizationId: actor.organizationId,
        clientId,
        requestedById: actor.userId,
        reason: reason ?? null,
        status: REQUEST_STATUS.PENDING,
      },
      include: requestInclude,
    });

    const requester = await prisma.user.findUnique({
      where: { id: actor.userId },
      select: { firstName: true, lastName: true },
    });
    const requesterName =
      [requester?.firstName, requester?.lastName].filter(Boolean).join(' ') ||
      'A colleague';

    await inAppNotificationService.notifyPermissionHolders({
      organizationId: actor.organizationId,
      permission: PERMISSIONS.CLIENTS_DELETE,
      type: NOTIFICATION_TYPES.CLIENT_DELETION_REQUESTED,
      title: 'Client deletion requested',
      body: `${requesterName} asked for ${clientLabel(client)} to be deleted.${
        reason ? ` Reason: ${reason}` : ''
      }`,
      link: `/clients/deletion-requests?request=${request.id}`,
      resource: 'ClientDeletionRequest',
      resourceId: request.id,
      excludeUserId: actor.userId,
    });

    await logCreate('ClientDeletionRequest', request.id, request, {
      userId: actor.userId,
      organizationId: actor.organizationId,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return { request, alreadyPending: false };
  }

  /** Requests in an organization, newest first. */
  async list(
    organizationId: string,
    filters: { status?: RequestStatus; page?: number; limit?: number } = {}
  ) {
    const page = Math.max(filters.page ?? 1, 1);
    const limit = Math.min(filters.limit ?? 20, 100);

    const where = {
      organizationId,
      ...(filters.status ? { status: filters.status } : {}),
    };

    const [requests, total, pendingCount] = await Promise.all([
      prisma.clientDeletionRequest.findMany({
        where,
        include: requestInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.clientDeletionRequest.count({ where }),
      prisma.clientDeletionRequest.count({
        where: { organizationId, status: REQUEST_STATUS.PENDING },
      }),
    ]);

    return {
      requests,
      pendingCount,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async findById(id: string, organizationId: string) {
    return prisma.clientDeletionRequest.findFirst({
      where: { id, organizationId },
      include: requestInclude,
    });
  }

  /**
   * Approve a request and delete the client.
   *
   * The client's record is snapshotted into the audit log before it goes, so
   * "deleted completely from the database" does not mean the deletion itself
   * becomes untraceable.
   */
  async approve(id: string, actor: ActorContext) {
    const request = await this.requirePending(id, actor.organizationId);

    const blockers = await this.findBlockers(request.clientId);
    const blocked = this.describeBlockers(blockers);
    if (blocked) {
      throw new DeletionBlockedError(blocked, blockers);
    }

    const client = await prisma.client.findFirst({
      where: { id: request.clientId, organizationId: actor.organizationId },
      include: {
        contacts: true,
        addresses: true,
        documents: { select: { id: true, fileName: true } },
        collaterals: { select: { id: true, description: true } },
      },
    });

    if (!client) {
      throw new DeletionRequestError('Client not found', 'CLIENT_NOT_FOUND');
    }

    // The audit entry is written before the delete: if the delete then fails,
    // an extra audit row is a far better outcome than a client that vanished
    // without one.
    await createAuditLog({
      action: 'DELETE',
      resource: 'Client',
      resourceId: client.id,
      previousValue: client,
      newValue: null,
      userId: actor.userId,
      organizationId: actor.organizationId,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      changes: null,
    } as any);

    // The request row carries a cascade on clientId, so it would be deleted
    // along with the client. Record the outcome on it first, then read it back
    // for the response before the delete removes it.
    const approved = await prisma.clientDeletionRequest.update({
      where: { id },
      data: {
        status: REQUEST_STATUS.APPROVED,
        reviewedById: actor.userId,
        reviewedAt: new Date(),
        clientSnapshot: client as any,
      },
      include: requestInclude,
    });

    await prisma.client.delete({ where: { id: client.id } });

    await inAppNotificationService.clearForResource(
      'ClientDeletionRequest',
      id
    );

    const reviewer = await prisma.user.findUnique({
      where: { id: actor.userId },
      select: { firstName: true, lastName: true },
    });
    const reviewerName =
      [reviewer?.firstName, reviewer?.lastName].filter(Boolean).join(' ') ||
      'An approver';

    if (request.requestedById !== actor.userId) {
      await inAppNotificationService.notify({
        organizationId: actor.organizationId,
        recipientId: request.requestedById,
        type: NOTIFICATION_TYPES.CLIENT_DELETION_APPROVED,
        title: 'Client deletion approved',
        body: `${reviewerName} approved your request to delete ${clientLabel(
          client
        )}. The record has been removed.`,
        link: '/clients/deletion-requests',
      });
    }

    return approved;
  }

  /** Turn a request down, leaving the client untouched. */
  async reject(id: string, reviewNotes: string | undefined, actor: ActorContext) {
    const request = await this.requirePending(id, actor.organizationId);

    const rejected = await prisma.clientDeletionRequest.update({
      where: { id },
      data: {
        status: REQUEST_STATUS.REJECTED,
        reviewedById: actor.userId,
        reviewedAt: new Date(),
        reviewNotes: reviewNotes ?? null,
      },
      include: requestInclude,
    });

    await inAppNotificationService.clearForResource(
      'ClientDeletionRequest',
      id
    );

    if (request.requestedById !== actor.userId) {
      await inAppNotificationService.notify({
        organizationId: actor.organizationId,
        recipientId: request.requestedById,
        type: NOTIFICATION_TYPES.CLIENT_DELETION_REJECTED,
        title: 'Client deletion declined',
        body: `Your request to delete ${clientLabel(
          rejected.client
        )} was declined.${reviewNotes ? ` Note: ${reviewNotes}` : ''}`,
        link: '/clients/deletion-requests',
      });
    }

    await logUpdate('ClientDeletionRequest', id, request, rejected, {
      userId: actor.userId,
      organizationId: actor.organizationId,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return rejected;
  }

  /** Withdraw your own request. */
  async cancel(id: string, actor: ActorContext) {
    const request = await this.requirePending(id, actor.organizationId);

    if (request.requestedById !== actor.userId) {
      throw new DeletionRequestError(
        'Only the person who raised a request can withdraw it',
        'NOT_REQUESTER'
      );
    }

    const cancelled = await prisma.clientDeletionRequest.update({
      where: { id },
      data: {
        status: REQUEST_STATUS.CANCELLED,
        reviewedAt: new Date(),
      },
      include: requestInclude,
    });

    await inAppNotificationService.clearForResource(
      'ClientDeletionRequest',
      id
    );

    return cancelled;
  }

  private async requirePending(id: string, organizationId: string) {
    const request = await prisma.clientDeletionRequest.findFirst({
      where: { id, organizationId },
    });

    if (!request) {
      throw new DeletionRequestError(
        'Deletion request not found',
        'REQUEST_NOT_FOUND'
      );
    }
    if (request.status !== REQUEST_STATUS.PENDING) {
      throw new DeletionRequestError(
        `This request has already been ${request.status.toLowerCase()}`,
        'REQUEST_NOT_PENDING'
      );
    }

    return request;
  }
}

export const clientDeletionRequestService = new ClientDeletionRequestService();
