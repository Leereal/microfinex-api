/**
 * The background loop that actually runs the assistant.
 *
 * Runs are rows in a queue, claimed with FOR UPDATE SKIP LOCKED, so several
 * API instances can share the work without any of them doing the same run
 * twice and without needing Redis. The same tick sweeps up automations that
 * have come due, expires approvals nobody decided on, and fails runs abandoned
 * by a restart.
 *
 * An interrupted run is failed rather than retried. A run has already done
 * real things - filed a document, sent a message - and there is no safe way to
 * work out where it got to, so the person is told it stopped and can ask again.
 */

import { prisma } from '../../config/database';
import { executeRun } from './assistant.runtime';
import { assistantApprovalService } from './assistant.approvals';
import { runDueAutomations } from './assistant.automations';

const BUSY_INTERVAL_MS = 500;
const IDLE_INTERVAL_MS = 5_000;
const HOUSEKEEPING_INTERVAL_MS = 60_000;
/** A run whose heartbeat stops for this long was interrupted. */
const STALE_RUN_MINUTES = 15;
/** How many runs this instance works on at once. */
const CONCURRENCY = Number(process.env.ASSISTANT_CONCURRENCY || 2);

class AssistantWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = true;
  private lastHousekeeping = 0;

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(3_000);
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Work now rather than at the next tick - somebody is waiting. */
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
      if (Date.now() - this.lastHousekeeping > HOUSEKEEPING_INTERVAL_MS) {
        this.lastHousekeeping = Date.now();
        await this.housekeeping();
      }
      busy = (await this.claimAndRun()) > 0;
    } catch (error) {
      console.error('Assistant worker error:', (error as Error).message);
    } finally {
      this.running = false;
      this.schedule(busy ? BUSY_INTERVAL_MS : IDLE_INTERVAL_MS);
    }
  }

  private async housekeeping() {
    await this.recoverAbandoned();
    await assistantApprovalService.expireOverdue().catch(() => 0);
    await runDueAutomations().catch(error =>
      console.error('Assistant automations error:', (error as Error).message)
    );
  }

  private async recoverAbandoned() {
    const cutoff = new Date(Date.now() - STALE_RUN_MINUTES * 60_000);
    const abandoned = await prisma.assistantRun.updateMany({
      where: {
        status: 'RUNNING',
        OR: [{ heartbeatAt: { lt: cutoff } }, { heartbeatAt: null, startedAt: { lt: cutoff } }],
      },
      data: {
        status: 'FAILED',
        error: 'This run was interrupted before it finished. Nothing further was done; ask again if it is still needed.',
        completedAt: new Date(),
        lockedAt: null,
      },
    });
    if (abandoned.count > 0) {
      console.warn(`Assistant: failed ${abandoned.count} interrupted run(s)`);
    }
  }

  /** Claim up to CONCURRENCY queued runs and work them. */
  async claimAndRun(): Promise<number> {
    const claimed = await prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "assistant_runs"
         SET "status" = 'RUNNING', "lockedAt" = now(), "heartbeatAt" = now(), "updatedAt" = now()
       WHERE "id" IN (
         SELECT "id" FROM "assistant_runs"
          WHERE "status" = 'QUEUED'
          ORDER BY "createdAt" ASC
          LIMIT ${CONCURRENCY}
          FOR UPDATE SKIP LOCKED
       )
       RETURNING "id"`;

    if (claimed.length === 0) return 0;

    await Promise.all(
      claimed.map(async row => {
        try {
          await executeRun(row.id);
        } catch (error) {
          console.error(`Assistant run ${row.id} failed:`, (error as Error).message);
          await prisma.assistantRun
            .update({
              where: { id: row.id },
              data: {
                status: 'FAILED',
                error: (error as Error).message,
                completedAt: new Date(),
                lockedAt: null,
              },
            })
            .catch(() => undefined);
        }
      })
    );

    return claimed.length;
  }
}

export const assistantWorker = new AssistantWorker();
