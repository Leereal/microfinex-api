/**
 * The accounts an organization has connected - mailboxes, and later whatever
 * else Composio supports.
 *
 * Nothing secret is stored here: Composio holds the tokens, and this table
 * holds only which account was connected, by whom, and whether it still works.
 * Disconnecting removes it at Composio as well, so a lender who changes their
 * mind is not left with a live grant they cannot see.
 */

import crypto from 'crypto';
import { prisma } from '../../../config/database';
import { createAuditLog } from '../../audit.service';
import { AssistantError } from '../assistant.logic';
import {
  MAIL_TOOLKITS,
  SUPPORTED_TOOLKITS,
  composioClient,
  isComposioConfigured,
  publicBaseUrl,
} from './composio.client';

export interface ConnectionContext {
  organizationId: string;
  userId: string;
}

/** Where the person is sent once they have signed in at Google or Microsoft. */
function returnUrl(connectionId: string): string {
  const app = (process.env.APP_PUBLIC_URL || 'http://localhost:3000').replace(/\/+$/, '');
  return `${app}/settings/assistant?tab=connections&connection=${connectionId}`;
}

/** New mail arriving is pushed here, when Composio can push. */
export function webhookUrl(): string {
  return `${publicBaseUrl()}/api/v1/public/assistant/composio`;
}

const PUBLIC_FIELDS = {
  id: true,
  toolkit: true,
  label: true,
  accountLabel: true,
  status: true,
  triggerId: true,
  lastSyncAt: true,
  lastError: true,
  connectedById: true,
  createdAt: true,
  updatedAt: true,
} as const;

class AssistantConnectionService {
  /** What can be connected, and what already is. */
  async list(ctx: ConnectionContext) {
    const connections = await prisma.assistantConnection.findMany({
      where: { organizationId: ctx.organizationId },
      select: PUBLIC_FIELDS,
      orderBy: { createdAt: 'asc' },
    });
    return {
      configured: isComposioConfigured(),
      webhookUrl: webhookUrl(),
      toolkits: SUPPORTED_TOOLKITS,
      connections,
    };
  }

  /**
   * Begin connecting an account.
   *
   * A row is written before the person leaves, so the account that comes back
   * can be matched to the lender who asked for it - Composio only knows the
   * user id we invent here.
   */
  async start(ctx: ConnectionContext, input: { toolkit: string; label?: string }) {
    if (!isComposioConfigured()) {
      throw new AssistantError(
        'Composio is not set up on this server, so accounts cannot be connected yet.',
        'COMPOSIO_NOT_CONFIGURED',
        503
      );
    }
    const toolkit = SUPPORTED_TOOLKITS.find(entry => entry.slug === input.toolkit);
    if (!toolkit) throw new AssistantError('That kind of account cannot be connected.', 'UNSUPPORTED_TOOLKIT');

    const composioUserId = `mfx_${ctx.organizationId.replace(/-/g, '').slice(0, 12)}_${crypto.randomBytes(6).toString('hex')}`;
    const authConfigId = await composioClient.ensureAuthConfig(toolkit.slug);

    const connection = await prisma.assistantConnection.create({
      data: {
        organizationId: ctx.organizationId,
        toolkit: toolkit.slug,
        label: input.label?.slice(0, 120) ?? toolkit.name,
        composioUserId,
        composioAuthConfigId: authConfigId,
        status: 'INITIATED',
        connectedById: ctx.userId,
      },
    });

    try {
      const link = await composioClient.createConnectLink({
        authConfigId,
        composioUserId,
        callbackUrl: returnUrl(connection.id),
      });

      await prisma.assistantConnection.update({
        where: { id: connection.id },
        data: { composioAccountId: link.connectedAccountId },
      });

      await createAuditLog({
        action: 'CREATE',
        resource: 'ASSISTANT_CONNECTION',
        resourceId: connection.id,
        userId: ctx.userId,
        organizationId: ctx.organizationId,
        newValue: { toolkit: toolkit.slug },
      }).catch(() => undefined);

      return { connectionId: connection.id, redirectUrl: link.redirectUrl, expiresAt: link.expiresAt };
    } catch (error) {
      await prisma.assistantConnection.delete({ where: { id: connection.id } }).catch(() => undefined);
      throw error;
    }
  }

  /** Ask Composio whether the account is live yet, and remember the answer. */
  async refresh(ctx: ConnectionContext, id: string) {
    const connection = await this.require(ctx, id);

    const account = connection.composioAccountId
      ? await composioClient.getAccount(connection.composioAccountId)
      : (await composioClient.listAccounts(connection.composioUserId))[0] ?? null;

    if (!account) {
      await prisma.assistantConnection.update({
        where: { id },
        data: { status: 'FAILED', lastError: 'Composio has no record of this account.' },
      });
      return this.get(ctx, id);
    }

    const status = ['ACTIVE', 'INITIALIZING', 'INITIATED', 'EXPIRED', 'FAILED', 'INACTIVE'].includes(account.status)
      ? account.status
      : 'INITIATED';

    const updated = await prisma.assistantConnection.update({
      where: { id },
      data: {
        composioAccountId: account.id || connection.composioAccountId,
        accountLabel: account.label ?? connection.accountLabel,
        status: status === 'INITIALIZING' ? 'INITIATED' : status,
        lastError: status === 'ACTIVE' ? null : connection.lastError,
      },
      select: PUBLIC_FIELDS,
    });

    // A live mailbox is asked to push new mail at us; failure is not fatal
    // because the automations also poll.
    if (updated.status === 'ACTIVE' && MAIL_TOOLKITS.includes(connection.toolkit) && !connection.triggerId) {
      const slug = connection.toolkit === 'gmail' ? 'GMAIL_NEW_GMAIL_MESSAGE' : 'OUTLOOK_NEW_MESSAGE';
      const triggerId = await composioClient.upsertTrigger({
        slug,
        connectedAccountId: account.id,
        config: connection.toolkit === 'gmail' ? { interval: 5, labelIds: ['INBOX'], userId: 'me' } : { interval: 5 },
      });
      if (triggerId) {
        await prisma.assistantConnection.update({ where: { id }, data: { triggerId } });
      }
    }

    return this.get(ctx, id);
  }

  async get(ctx: ConnectionContext, id: string) {
    const connection = await prisma.assistantConnection.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: PUBLIC_FIELDS,
    });
    if (!connection) throw new AssistantError('No such connection.', 'NOT_FOUND', 404);
    return connection;
  }

  private async require(ctx: ConnectionContext, id: string) {
    const connection = await prisma.assistantConnection.findFirst({
      where: { id, organizationId: ctx.organizationId },
    });
    if (!connection) throw new AssistantError('No such connection.', 'NOT_FOUND', 404);
    return connection;
  }

  async remove(ctx: ConnectionContext, id: string) {
    const connection = await this.require(ctx, id);

    if (connection.triggerId) await composioClient.deleteTrigger(connection.triggerId);
    if (connection.composioAccountId) await composioClient.deleteAccount(connection.composioAccountId);

    // Automations pointed at this mailbox would fail on every run; they are
    // switched off rather than left to raise errors nobody asked for.
    await prisma.assistantAutomation.updateMany({
      where: { organizationId: ctx.organizationId, config: { path: ['connectionId'], equals: id } },
      data: { enabled: false, lastError: 'The mailbox this used was disconnected.' },
    });

    await prisma.assistantConnection.delete({ where: { id } });

    await createAuditLog({
      action: 'DELETE',
      resource: 'ASSISTANT_CONNECTION',
      resourceId: id,
      userId: ctx.userId,
      organizationId: ctx.organizationId,
      previousValue: { toolkit: connection.toolkit, accountLabel: connection.accountLabel },
    }).catch(() => undefined);

    return { removed: true };
  }

  /** The mailbox an automation or tool should use, if any. */
  async activeMailbox(organizationId: string, connectionId?: string | null) {
    return prisma.assistantConnection.findFirst({
      where: {
        organizationId,
        status: 'ACTIVE',
        toolkit: { in: MAIL_TOOLKITS },
        ...(connectionId ? { id: connectionId } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Find the connection a webhook belongs to. */
  async byComposioUser(composioUserId: string) {
    return prisma.assistantConnection.findUnique({ where: { composioUserId } });
  }
}

export const assistantConnectionService = new AssistantConnectionService();
