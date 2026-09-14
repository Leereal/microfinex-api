/**
 * Sends queued messages in the background.
 *
 * Broadcasts are written to the database as QUEUED rows; this loop claims a
 * batch at a time with FOR UPDATE SKIP LOCKED, so several API instances can
 * run it without sending anything twice, and without needing Redis or the
 * optional scheduler. Temporary failures are retried with backoff; a message
 * left SENDING by a crash is picked up again; and SMS delivery reports are
 * fetched for recent messages, since BulkSMS reports delivery after sending.
 */

import { prisma } from '../../config/database';
import {
  MAX_SEND_ATTEMPTS,
  SENDING_LOCK_MINUTES,
  retryDelayMs,
  BULKSMS_FAILURE_TEXT,
  type MessageStatus,
} from './comms.logic';
import { commsSettingsService, type ResolvedCommsConfig } from './comms-settings.service';
import { commsService } from './comms.service';
import { getSmsStatus } from './comms.providers';

const BATCH_SIZE = 20;
const BUSY_INTERVAL_MS = 1_000;
const IDLE_INTERVAL_MS = 10_000;
const SMS_STATUS_INTERVAL_MS = 10 * 60_000;

class CommsDispatcher {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = true;
  private lastSmsRefresh = 0;

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(2_000);
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Send now rather than waiting for the next tick. */
  kick() {
    if (this.stopped) return;
    if (!this.running) this.schedule(0);
  }

  private schedule(delay: number) {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), delay);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    let busy = false;
    try {
      await this.recoverAbandoned();
      busy = (await this.dispatchBatch()) > 0;
      if (Date.now() - this.lastSmsRefresh > SMS_STATUS_INTERVAL_MS) {
        this.lastSmsRefresh = Date.now();
        await this.refreshSmsStatuses();
      }
    } catch (error) {
      console.error('Communications dispatcher error:', (error as Error).message);
    } finally {
      this.running = false;
      this.schedule(busy ? BUSY_INTERVAL_MS : IDLE_INTERVAL_MS);
    }
  }

  /**
   * Messages left SENDING by a restart. A broadcast message goes back to the
   * queue; a one-to-one message was being sent while someone waited, so it is
   * marked failed - they were already told it did not complete.
   */
  private async recoverAbandoned() {
    const cutoff = new Date(Date.now() - SENDING_LOCK_MINUTES * 60_000);
    await prisma.clientMessage.updateMany({
      where: { status: 'SENDING', lockedAt: { lt: cutoff }, broadcastId: { not: null } },
      data: { status: 'QUEUED', lockedAt: null },
    });
    await prisma.clientMessage.updateMany({
      where: { status: 'SENDING', lockedAt: { lt: cutoff }, broadcastId: null },
      data: { status: 'FAILED', lockedAt: null, failedAt: new Date(), errorCode: 'INTERRUPTED', errorMessage: 'Sending was interrupted. Check with the client before sending again.' },
    });
  }

  async dispatchBatch(): Promise<number> {
    const claimed = await prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "client_messages"
         SET "status" = 'SENDING', "lockedAt" = now(), "attempts" = "attempts" + 1, "updatedAt" = now()
       WHERE "id" IN (
         SELECT "id" FROM "client_messages"
          WHERE "status" = 'QUEUED' AND "nextAttemptAt" <= now()
          ORDER BY "queuedAt" ASC
          LIMIT ${BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
       )
       RETURNING "id"`;
    if (claimed.length === 0) return 0;

    const messages = await prisma.clientMessage.findMany({
      where: { id: { in: claimed.map(row => row.id) } },
      include: { broadcast: { select: { id: true, status: true } } },
      orderBy: { queuedAt: 'asc' },
    });

    const configs = new Map<string, ResolvedCommsConfig | null>();
    const touchedBroadcasts = new Set<string>();

    for (const message of messages) {
      if (message.broadcastId) touchedBroadcasts.add(message.broadcastId);

      if (message.broadcast?.status === 'CANCELLED') {
        await prisma.clientMessage.update({
          where: { id: message.id },
          data: { status: 'CANCELLED', lockedAt: null, failedAt: new Date(), errorCode: 'CANCELLED', errorMessage: 'The broadcast was cancelled before this was sent.' },
        });
        continue;
      }
      if (message.broadcast?.status === 'QUEUED') {
        await prisma.messageBroadcast.update({ where: { id: message.broadcast.id }, data: { status: 'SENDING' } });
        message.broadcast.status = 'SENDING';
      }

      if (!configs.has(message.organizationId)) {
        configs.set(message.organizationId, await commsSettingsService.resolve(message.organizationId).catch(() => null));
      }
      const config = configs.get(message.organizationId);
      if (!config) {
        await this.fail(message.id, 'CONFIG_UNAVAILABLE', 'The organization’s communication settings could not be read.');
        continue;
      }

      const outcome = await commsService.deliver(config, message);
      const now = new Date();
      if (outcome.ok) {
        await prisma.clientMessage.update({
          where: { id: message.id },
          data: {
            status: outcome.status,
            providerMessageId: outcome.providerMessageId,
            errorCode: null,
            errorMessage: null,
            lockedAt: null,
            sentAt: now,
            ...(outcome.status === 'DELIVERED' && { deliveredAt: now }),
          },
        });
      } else if (outcome.retryable && message.attempts < MAX_SEND_ATTEMPTS) {
        await prisma.clientMessage.update({
          where: { id: message.id },
          data: {
            status: 'QUEUED',
            lockedAt: null,
            errorCode: outcome.errorCode,
            errorMessage: outcome.errorMessage,
            nextAttemptAt: new Date(Date.now() + retryDelayMs(message.attempts)),
          },
        });
      } else {
        await this.fail(message.id, outcome.errorCode ?? 'SEND_FAILED', outcome.errorMessage ?? 'The message could not be sent.', outcome.providerMessageId);
      }
    }

    for (const broadcastId of touchedBroadcasts) await this.completeIfDone(broadcastId);
    return messages.length;
  }

  private async fail(id: string, errorCode: string, errorMessage: string, providerMessageId?: string | null) {
    await prisma.clientMessage.update({
      where: { id },
      data: { status: 'FAILED', lockedAt: null, failedAt: new Date(), errorCode, errorMessage, ...(providerMessageId && { providerMessageId }) },
    });
  }

  private async completeIfDone(broadcastId: string) {
    const pending = await prisma.clientMessage.count({ where: { broadcastId, status: { in: ['QUEUED', 'SENDING'] } } });
    if (pending > 0) return;
    await prisma.messageBroadcast.updateMany({
      where: { id: broadcastId, status: { in: ['QUEUED', 'SENDING'] } },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
  }

  /**
   * Delivery reports for SMS sent in the last two days that have not reached a
   * final state. A number that has blocked the sender is opted out of SMS, so
   * broadcasts stop trying it.
   */
  async refreshSmsStatuses() {
    const since = new Date(Date.now() - 48 * 3600_000);
    const staleBefore = new Date(Date.now() - 5 * 60_000);
    const messages = await prisma.clientMessage.findMany({
      where: { provider: 'BULKSMS', status: 'SENT', sentAt: { gte: since }, updatedAt: { lt: staleBefore }, providerMessageId: { not: null } },
      select: { id: true, organizationId: true, clientId: true, providerMessageId: true },
      take: 100,
      orderBy: { sentAt: 'asc' },
    });
    const configs = new Map<string, ResolvedCommsConfig | null>();
    for (const message of messages) {
      if (!configs.has(message.organizationId)) {
        configs.set(message.organizationId, await commsSettingsService.resolve(message.organizationId).catch(() => null));
      }
      const config = configs.get(message.organizationId);
      if (!config?.sms) continue;
      const report = await getSmsStatus(config.sms, message.providerMessageId!);
      if (!report) continue;
      const next: MessageStatus = report.status;
      const now = new Date();
      await prisma.clientMessage.update({
        where: { id: message.id },
        data:
          next === 'DELIVERED'
            ? { status: 'DELIVERED', deliveredAt: now }
            : next === 'FAILED'
              ? { status: 'FAILED', failedAt: now, errorCode: `BULKSMS_${report.subtype ?? 'FAILED'}`, errorMessage: BULKSMS_FAILURE_TEXT[report.subtype ?? ''] ?? 'The SMS could not be delivered.' }
              : { updatedAt: now },
      });
      if (next === 'FAILED' && report.subtype === 'BLOCKED' && message.clientId) {
        await prisma.clientCommunicationPreference.upsert({
          where: { clientId: message.clientId },
          create: { organizationId: message.organizationId, clientId: message.clientId, smsOptOut: true, source: 'SMS_BLOCKED' },
          update: { smsOptOut: true, source: 'SMS_BLOCKED' },
        });
      }
    }
  }
}

export const commsDispatcher = new CommsDispatcher();
