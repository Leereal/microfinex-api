import cron, { ScheduledTask } from 'node-cron';
import { prisma } from '../config/database';
import { scheduledJobs } from './notification.jobs';
import {
  runLoanEngineJob,
  runDueDateReminderJob,
  runOverdueNotificationJob,
  runDailySummaryJob,
} from './loan-engine.jobs';

/**
 * Background job scheduler.
 *
 * The job functions and their cron expressions already existed but nothing
 * ever invoked them, so loans never transitioned to OVERDUE or DEFAULTED,
 * penalties never accrued and no reminder was ever sent - arrears management
 * was entirely manual. This module is what actually runs them.
 *
 * Enable with ENABLE_SCHEDULER=true. Leave it off for additional web instances
 * if you would rather run jobs from a dedicated worker process; the advisory
 * lock below makes it safe either way.
 */

interface JobRegistration {
  name: string;
  schedule: string;
  description: string;
  run: () => Promise<unknown>;
}

/**
 * Jobs owned by the loan engine. The notification module already exports its
 * own schedule list; these are registered alongside it.
 */
const loanEngineJobs: JobRegistration[] = [
  {
    name: 'loanEngine',
    schedule: '0 1 * * *', // 01:00 daily, before staff arrive
    description:
      'Recalculate interest, apply status transitions and post charges',
    run: runLoanEngineJob,
  },
  {
    name: 'dueDateReminders',
    schedule: '0 8 * * *', // 08:00 daily
    description: 'Notify borrowers of instalments falling due in 3 days',
    run: () => runDueDateReminderJob(3),
  },
  {
    name: 'overdueNotifications',
    schedule: '30 9 * * *', // 09:30 daily
    description: 'Notify borrowers and officers about overdue instalments',
    run: runOverdueNotificationJob,
  },
  {
    name: 'dailySummary',
    schedule: '0 18 * * *', // 18:00 daily
    description: 'Produce the end-of-day portfolio summary',
    run: runDailySummaryJob,
  },
];

/**
 * Stable 64-bit key for a job name, used as the Postgres advisory lock id.
 */
function lockKeyFor(jobName: string): bigint {
  let hash = BigInt(0);
  for (const char of jobName) {
    // FNV-1a style mix, truncated to a signed 64-bit range.
    hash = (hash * BigInt(31) + BigInt(char.charCodeAt(0))) % BigInt(2) ** BigInt(62);
  }
  return hash;
}

/**
 * Run a job while holding a Postgres advisory lock.
 *
 * Several API instances behind a load balancer would otherwise each fire the
 * same cron tick, applying penalties two or three times over. The lock is
 * session-scoped and taken with try_ semantics, so a second instance simply
 * skips the run rather than queuing behind it.
 */
async function runExclusively(
  jobName: string,
  run: () => Promise<unknown>
): Promise<void> {
  const key = lockKeyFor(jobName);
  let acquired = false;

  try {
    const rows = await prisma.$queryRaw<
      Array<{ locked: boolean }>
    >`SELECT pg_try_advisory_lock(${key}::bigint) AS locked`;

    acquired = rows[0]?.locked === true;

    if (!acquired) {
      console.log(
        `[scheduler] ${jobName} is already running on another instance, skipping`
      );
      return;
    }

    const started = Date.now();
    console.log(`[scheduler] ${jobName} started`);
    await run();
    console.log(`[scheduler] ${jobName} finished in ${Date.now() - started}ms`);
  } catch (error) {
    // A failing job must never take the process down - log and wait for the
    // next tick.
    console.error(`[scheduler] ${jobName} failed:`, error);
  } finally {
    if (acquired) {
      try {
        await prisma.$queryRaw`SELECT pg_advisory_unlock(${key}::bigint)`;
      } catch (error) {
        console.error(`[scheduler] failed to release lock for ${jobName}:`, error);
      }
    }
  }
}

const tasks: ScheduledTask[] = [];

/**
 * Register and start every scheduled job. Returns the number started.
 */
export function startScheduler(): number {
  if (tasks.length > 0) {
    console.warn('[scheduler] already started, ignoring duplicate call');
    return tasks.length;
  }

  const timezone = process.env.SCHEDULER_TIMEZONE || 'UTC';

  const registrations: JobRegistration[] = [
    ...loanEngineJobs,
    ...scheduledJobs.map(job => ({
      name: job.name,
      schedule: job.schedule,
      description: job.description,
      run: job.run as () => Promise<unknown>,
    })),
  ];

  for (const job of registrations) {
    if (!cron.validate(job.schedule)) {
      console.error(
        `[scheduler] invalid cron expression for ${job.name}: ${job.schedule} - not scheduled`
      );
      continue;
    }

    const task = cron.schedule(
      job.schedule,
      () => {
        void runExclusively(job.name, job.run);
      },
      { timezone }
    );

    tasks.push(task);
    console.log(
      `[scheduler] registered ${job.name} (${job.schedule} ${timezone}) - ${job.description}`
    );
  }

  console.log(`[scheduler] ${tasks.length} job(s) scheduled`);
  return tasks.length;
}

/**
 * Stop every scheduled job. Called during graceful shutdown so in-flight
 * ticks are not orphaned.
 */
export async function stopScheduler(): Promise<void> {
  for (const task of tasks) {
    await task.stop();
  }
  tasks.length = 0;
}

/** Names and schedules of everything registered, for the admin API. */
export function listScheduledJobs(): Array<{
  name: string;
  schedule: string;
  description: string;
}> {
  return [
    ...loanEngineJobs.map(({ name, schedule, description }) => ({
      name,
      schedule,
      description,
    })),
    ...scheduledJobs.map(({ name, schedule, description }) => ({
      name,
      schedule,
      description,
    })),
  ];
}
