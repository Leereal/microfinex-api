import { prisma } from '../config/database';
import { loadUserPermissions } from '../middleware/permissions';

/**
 * Staff-facing, in-app notifications - the bell in the header.
 *
 * Deliberately separate from `notification.service`, which delivers SMS and
 * email outward to clients. This one is about work waiting for someone inside
 * the organization: a client deletion needing approval, and whatever comes
 * after it.
 */

/** Notification kinds. The frontend routes and labels on these. */
export const NOTIFICATION_TYPES = {
  CLIENT_DELETION_REQUESTED: 'CLIENT_DELETION_REQUESTED',
  CLIENT_DELETION_APPROVED: 'CLIENT_DELETION_APPROVED',
  CLIENT_DELETION_REJECTED: 'CLIENT_DELETION_REJECTED',
  LOAN_AWAITING_ASSESSMENT: 'LOAN_AWAITING_ASSESSMENT',
  LOAN_AWAITING_DISBURSEMENT: 'LOAN_AWAITING_DISBURSEMENT',
  LOAN_REVERSAL_REQUESTED: 'LOAN_REVERSAL_REQUESTED',
  LOAN_REVERSAL_COMPLETED: 'LOAN_REVERSAL_COMPLETED',
  BANK_STATEMENT_ANALYSIS_COMPLETED: 'BANK_STATEMENT_ANALYSIS_COMPLETED',
  BANK_STATEMENT_ANALYSIS_FAILED: 'BANK_STATEMENT_ANALYSIS_FAILED',
  NOTE_ADDED: 'NOTE_ADDED',
  CLIENT_MESSAGE_RECEIVED: 'CLIENT_MESSAGE_RECEIVED',
  /** The Agentic Assistant: work it has prepared, finished or handed over. */
  ASSISTANT_APPROVAL_REQUESTED: 'ASSISTANT_APPROVAL_REQUESTED',
  ASSISTANT_RUN_COMPLETED: 'ASSISTANT_RUN_COMPLETED',
  ASSISTANT_AUTOMATION_COMPLETED: 'ASSISTANT_AUTOMATION_COMPLETED',
  ASSISTANT_AUTOMATION_FAILED: 'ASSISTANT_AUTOMATION_FAILED',
  ASSISTANT_BRIEFING: 'ASSISTANT_BRIEFING',
  ASSISTANT_HANDOFF: 'ASSISTANT_HANDOFF',
  ASSISTANT_MESSAGE: 'ASSISTANT_MESSAGE',
} as const;

export type NotificationTypeCode =
  (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

export interface CreateNotificationInput {
  organizationId: string;
  recipientId: string;
  type: NotificationTypeCode;
  title: string;
  body: string;
  /** Where clicking it should take the recipient. */
  link?: string;
  /** What it is about, so it can be cleared once resolved. */
  resource?: string;
  resourceId?: string;
}

class InAppNotificationService {
  /** Address one notification to one person. */
  async notify(input: CreateNotificationInput) {
    return prisma.notification.create({
      data: {
        organizationId: input.organizationId,
        recipientId: input.recipientId,
        type: input.type,
        title: input.title,
        body: input.body,
        link: input.link ?? null,
        resource: input.resource ?? null,
        resourceId: input.resourceId ?? null,
      },
    });
  }

  /**
   * Address the same notification to everyone who holds a permission.
   *
   * Permissions come from roles and per-user grants, so there is no single
   * column to filter on - the organization's active users are resolved and
   * then checked individually. The result is cached by the permission
   * middleware, so this is a handful of queries, not one per user per request.
   *
   * `branchId` prefers staff at the branch the work belongs to, plus anyone not
   * tied to a branch (head office). If that leaves nobody it falls back to
   * every holder in the organization: a notification nobody receives is worse
   * than one that travels a little further than intended.
   *
   * Note there is no exclusion for the person who acted. A small branch may
   * have one person who can both raise and approve, and excluding them made the
   * request invisible to everyone.
   */
  async notifyPermissionHolders(
    input: Omit<CreateNotificationInput, 'recipientId'> & {
      permission: string;
      /** The branch the work belongs to, when it belongs to one. */
      branchId?: string | null;
    }
  ): Promise<number> {
    const candidates = await prisma.user.findMany({
      where: {
        organizationId: input.organizationId,
        isActive: true,
      },
      select: { id: true, branchId: true },
    });

    const holders: Array<{ id: string; branchId: string | null }> = [];
    for (const user of candidates) {
      const permissions = await loadUserPermissions(user.id);
      if (permissions.has(input.permission)) holders.push(user);
    }

    const atBranch = input.branchId
      ? holders.filter(
          user => user.branchId === input.branchId || user.branchId === null
        )
      : holders;

    const recipients = (atBranch.length > 0 ? atBranch : holders).map(
      user => user.id
    );

    if (recipients.length === 0) return 0;

    const result = await prisma.notification.createMany({
      data: recipients.map(recipientId => ({
        organizationId: input.organizationId,
        recipientId,
        type: input.type,
        title: input.title,
        body: input.body,
        link: input.link ?? null,
        resource: input.resource ?? null,
        resourceId: input.resourceId ?? null,
      })),
    });

    return result.count;
  }

  /** One person's inbox, newest first. */
  async list(
    recipientId: string,
    options: { unreadOnly?: boolean; limit?: number; before?: Date } = {}
  ) {
    const limit = Math.min(options.limit ?? 20, 100);

    const notifications = await prisma.notification.findMany({
      where: {
        recipientId,
        ...(options.unreadOnly ? { readAt: null } : {}),
        ...(options.before ? { createdAt: { lt: options.before } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const unreadCount = await this.unreadCount(recipientId);
    return { notifications, unreadCount };
  }

  async unreadCount(recipientId: string): Promise<number> {
    return prisma.notification.count({ where: { recipientId, readAt: null } });
  }

  /** Mark one notification read. Scoped to the recipient so ids cannot be probed. */
  async markRead(id: string, recipientId: string) {
    const result = await prisma.notification.updateMany({
      where: { id, recipientId, readAt: null },
      data: { readAt: new Date() },
    });
    return result.count > 0;
  }

  async markAllRead(recipientId: string): Promise<number> {
    const result = await prisma.notification.updateMany({
      where: { recipientId, readAt: null },
      data: { readAt: new Date() },
    });
    return result.count;
  }

  /**
   * Clear everyone's notifications about one thing.
   *
   * Once a deletion request is approved or rejected, the prompts asking other
   * approvers to look at it are stale - leaving them would send colleagues to a
   * request that no longer needs them.
   */
  async clearForResource(resource: string, resourceId: string): Promise<number> {
    const result = await prisma.notification.deleteMany({
      where: { resource, resourceId },
    });
    return result.count;
  }
}

export const inAppNotificationService = new InAppNotificationService();
