/**
 * Work the assistant does without being asked.
 *
 * Four kinds, plus a free-form one:
 *
 *   Due-soon reminders   the instalments falling due in a few days, and a
 *                        message to each of those clients
 *   Branch briefing      what a branch manager needs to know first thing
 *   Email intake         applications arriving by email
 *   Email capture        client correspondence filed against their records
 *   Custom               a standing instruction, run as a normal assistant run
 *
 * Every automation belongs to a person. It can do exactly what that person
 * could do, under the same capability settings, so an automation cannot be
 * used to get around what the assistant is allowed to do in conversation.
 * New automations start in dry-run: they report what they would have done and
 * change nothing, until somebody turns that off.
 */

import { prisma } from '../../config/database';
import { commsSettingsService } from '../communications/comms-settings.service';
import { inAppNotificationService, NOTIFICATION_TYPES } from '../in-app-notification.service';
import { resolveAssistantModel } from './assistant.models';
import {
  AssistantError,
  nextRunAt,
  parseSchedule,
  truncate,
  withinWorkingHours,
  type AutomationSchedule,
  type WorkingHours,
} from './assistant.logic';
import { assistantSettingsService } from './assistant.settings.service';
import { actAs } from './assistant.execute';
import { runEmailCapture, runEmailIntake, type AutomationRunContext, type AutomationResult } from './composio/email.automations';

export const AUTOMATION_TYPES = [
  'DUE_SOON_REMINDERS',
  'BRANCH_BRIEFING',
  'EMAIL_APPLICATION_INTAKE',
  'EMAIL_CORRESPONDENCE_CAPTURE',
  'CUSTOM_PROMPT',
] as const;

export type AutomationType = (typeof AUTOMATION_TYPES)[number];

export const AUTOMATION_CATALOGUE: Array<{
  type: AutomationType;
  name: string;
  description: string;
  capabilities: string[];
  defaultSchedule: AutomationSchedule;
  defaultConfig: Record<string, unknown>;
  needsMailbox?: boolean;
}> = [
  {
    type: 'DUE_SOON_REMINDERS',
    name: 'Payment reminders',
    description:
      'Every working morning, find the instalments falling due in a few days and send each client a short reminder.',
    capabilities: ['loans.read', 'messages.send'],
    defaultSchedule: { kind: 'WEEKDAYS', time: '08:30' },
    defaultConfig: {
      daysAhead: 3,
      channel: 'AUTO',
      maxPerRun: 100,
      body:
        'Hello {{firstName}}, a payment of {{nextDueAmount}} on loan {{loanNumber}} is due on {{nextDueDate}}. Thank you, {{organizationName}}.',
      subject: 'Payment reminder',
    },
  },
  {
    type: 'BRANCH_BRIEFING',
    name: 'Branch manager briefing',
    description:
      'A short summary each morning for every branch: what is due, what is late, what came in yesterday and what is waiting for a decision.',
    capabilities: ['portfolio.read', 'staff.notify'],
    defaultSchedule: { kind: 'WEEKDAYS', time: '07:30' },
    defaultConfig: { includeNarrative: false, daysAhead: 3 },
  },
  {
    type: 'EMAIL_APPLICATION_INTAKE',
    name: 'Applications by email',
    description:
      'Watch a connected mailbox for applications, save what is attached, read it, and prepare the client for approval.',
    capabilities: ['email.read', 'documents.extract', 'clients.create'],
    defaultSchedule: { kind: 'INTERVAL', everyMinutes: 30 },
    defaultConfig: {
      query: 'loan application apply applying finance credit',
      lookbackDays: 3,
      maxPerRun: 10,
      requireAttachments: true,
    },
    needsMailbox: true,
  },
  {
    type: 'EMAIL_CORRESPONDENCE_CAPTURE',
    name: 'File client emails',
    description:
      'File email to and from your clients against their records, so correspondence lives with the loan rather than in one inbox.',
    capabilities: ['email.read', 'messages.read'],
    defaultSchedule: { kind: 'INTERVAL', everyMinutes: 15 },
    defaultConfig: { lookbackHours: 24, includeSent: true, addNote: false, notifyOfficer: true, maxPerRun: 40 },
    needsMailbox: true,
  },
  {
    type: 'CUSTOM_PROMPT',
    name: 'Standing instruction',
    description:
      'Anything else you would ask the assistant, on a schedule - written once and run every day or week.',
    capabilities: [],
    defaultSchedule: { kind: 'WEEKDAYS', time: '09:00' },
    defaultConfig: { prompt: '' },
  },
];

export interface AutomationContext {
  organizationId: string;
  userId: string;
}

const PUBLIC_FIELDS = {
  id: true,
  type: true,
  name: true,
  enabled: true,
  schedule: true,
  timezone: true,
  config: true,
  dryRun: true,
  ownerId: true,
  branchId: true,
  nextRunAt: true,
  lastRunAt: true,
  lastStatus: true,
  lastError: true,
  createdAt: true,
  updatedAt: true,
} as const;

// -------------------------------------------------------------- the schedule

/**
 * Run whatever has come due.
 *
 * Automations are claimed with SKIP LOCKED, so two API instances never run the
 * same one, and a lock older than ten minutes is treated as abandoned.
 */
export async function runDueAutomations(): Promise<number> {
  const claimed = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "assistant_automations"
       SET "lockedAt" = now(), "updatedAt" = now()
     WHERE "id" IN (
       SELECT "id" FROM "assistant_automations"
        WHERE "enabled" = true
          AND "nextRunAt" IS NOT NULL
          AND "nextRunAt" <= now()
          AND ("lockedAt" IS NULL OR "lockedAt" < now() - interval '10 minutes')
        ORDER BY "nextRunAt" ASC
        LIMIT 5
        FOR UPDATE SKIP LOCKED
     )
     RETURNING "id"`;

  for (const row of claimed) {
    await runAutomation(row.id, 'SCHEDULE').catch(error =>
      console.error(`Assistant automation ${row.id} failed:`, (error as Error).message)
    );
  }
  return claimed.length;
}

/** Run one automation now, whatever its schedule says. */
export async function runAutomation(
  automationId: string,
  trigger: 'SCHEDULE' | 'MANUAL' | 'WEBHOOK',
  options: { dryRun?: boolean } = {}
) {
  const automation = await prisma.assistantAutomation.findUnique({ where: { id: automationId } });
  if (!automation) throw new AssistantError('No such automation.', 'NOT_FOUND', 404);

  const settings = await assistantSettingsService.resolve(automation.organizationId);
  const schedule = parseSchedule(automation.schedule);
  const dryRun = options.dryRun ?? automation.dryRun;

  const reschedule = async (from: Date = new Date()) => {
    await prisma.assistantAutomation.update({
      where: { id: automationId },
      data: {
        lockedAt: null,
        lastRunAt: new Date(),
        nextRunAt: automation.enabled ? nextRunAt(schedule, automation.timezone, from) : null,
      },
    });
  };

  if (!settings.enabled) {
    await prisma.assistantAutomation.update({
      where: { id: automationId },
      data: { lockedAt: null, lastStatus: 'SKIPPED', lastError: 'The assistant is switched off.' },
    });
    await reschedule();
    return { status: 'SKIPPED', summary: 'The assistant is switched off for this organization.' };
  }

  const record = await prisma.assistantAutomationRun.create({
    data: {
      automationId,
      organizationId: automation.organizationId,
      trigger,
      status: 'RUNNING',
      dryRun,
    },
  });

  const ctx: AutomationRunContext = {
    automationId,
    organizationId: automation.organizationId,
    ownerId: automation.ownerId,
    branchId: automation.branchId,
    dryRun,
    config: (automation.config ?? {}) as Record<string, unknown>,
  };

  try {
    let result: AutomationResult;
    switch (automation.type as AutomationType) {
      case 'DUE_SOON_REMINDERS':
        result = await runDueSoonReminders(ctx, settings.timezone, settings.workingHours);
        break;
      case 'BRANCH_BRIEFING':
        result = await runBranchBriefing(ctx);
        break;
      case 'EMAIL_APPLICATION_INTAKE':
        result = await runEmailIntake(ctx);
        break;
      case 'EMAIL_CORRESPONDENCE_CAPTURE':
        result = await runEmailCapture(ctx);
        break;
      case 'CUSTOM_PROMPT':
        result = await runCustomPrompt(ctx, automation.name);
        break;
      default:
        throw new AssistantError(`${automation.type} is not a kind of automation this system runs.`, 'UNKNOWN_TYPE');
    }

    await prisma.assistantAutomationRun.update({
      where: { id: record.id },
      data: {
        status: 'COMPLETED',
        summary: truncate(result.summary, 4000),
        stats: result.stats as never,
        completedAt: new Date(),
      },
    });
    await prisma.assistantAutomation.update({
      where: { id: automationId },
      data: { lastStatus: 'COMPLETED', lastError: null },
    });
    await reschedule();

    return { status: 'COMPLETED', summary: result.summary, stats: result.stats, automationRunId: record.id };
  } catch (error) {
    const message = (error as Error).message;
    await prisma.assistantAutomationRun.update({
      where: { id: record.id },
      data: { status: 'FAILED', error: truncate(message, 2000), completedAt: new Date() },
    });
    await prisma.assistantAutomation.update({
      where: { id: automationId },
      data: { lastStatus: 'FAILED', lastError: truncate(message, 1000) },
    });
    await reschedule();

    // The owner is told once per failure rather than left to discover a
    // reminder run that has been quietly failing for a week.
    await inAppNotificationService
      .notify({
        organizationId: automation.organizationId,
        recipientId: automation.ownerId,
        type: NOTIFICATION_TYPES.ASSISTANT_AUTOMATION_FAILED,
        title: `${automation.name} could not run`,
        body: truncate(message, 200),
        link: `/assistant/automations?automation=${automationId}`,
        resource: 'assistant_automation',
        resourceId: automationId,
      })
      .catch(() => undefined);

    return { status: 'FAILED', summary: message, automationRunId: record.id };
  }
}

// ------------------------------------------------------------- the reminders

/**
 * Remind clients about instalments falling due.
 *
 * Only the instalment due on the day being aimed at - not everything in the
 * next three days - so a client is reminded once per instalment rather than
 * three times. Opt-outs are honoured, and a client with no usable address is
 * skipped and counted rather than failing the run.
 */
export async function runDueSoonReminders(
  ctx: AutomationRunContext,
  timezone: string,
  workingHours: WorkingHours | null
): Promise<AutomationResult> {
  const daysAhead = Math.max(0, Math.min(Number(ctx.config.daysAhead ?? 3), 30));
  const maxPerRun = Math.min(Number(ctx.config.maxPerRun ?? 100), 200);
  const channelChoice = String(ctx.config.channel ?? 'AUTO').toUpperCase();
  const body = String(
    ctx.config.body ??
      'Hello {{firstName}}, a payment of {{nextDueAmount}} on loan {{loanNumber}} is due on {{nextDueDate}}. Thank you, {{organizationName}}.'
  );
  const subject = String(ctx.config.subject ?? 'Payment reminder');

  const target = new Date();
  target.setHours(0, 0, 0, 0);
  target.setDate(target.getDate() + daysAhead);
  const dayEnd = new Date(target);
  dayEnd.setHours(23, 59, 59, 999);

  const instalments = await prisma.repaymentSchedule.findMany({
    where: {
      dueDate: { gte: target, lte: dayEnd },
      status: { notIn: ['COMPLETED', 'CANCELLED', 'REVERSED', 'REFUNDED'] },
      outstandingAmount: { gt: 0 },
      loan: {
        organizationId: ctx.organizationId,
        status: { in: ['ACTIVE', 'OVERDUE'] },
        ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
      },
    },
    select: {
      id: true,
      dueDate: true,
      outstandingAmount: true,
      loan: {
        select: {
          id: true,
          loanNumber: true,
          currency: true,
          client: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              businessName: true,
              phone: true,
              email: true,
              communicationPreference: true,
            },
          },
        },
      },
    },
    orderBy: { dueDate: 'asc' },
    take: maxPerRun,
  });

  const stats = { due: instalments.length, prepared: 0, sent: 0, skipped: 0, awaitingApproval: 0, failed: 0 };
  const skippedReasons: Record<string, number> = {};
  const note = (reason: string) => {
    skippedReasons[reason] = (skippedReasons[reason] ?? 0) + 1;
    stats.skipped += 1;
  };

  if (instalments.length === 0) {
    return { summary: `No instalments fall due in ${daysAhead} day(s).`, stats };
  }

  // Messages wait for working hours; the reading and the counting do not.
  if (!ctx.dryRun && !withinWorkingHours(new Date(), workingHours, timezone)) {
    return {
      summary: `${instalments.length} reminder(s) are due but it is outside your working hours. They will go out at the next run inside them.`,
      stats: { ...stats, held: instalments.length },
    };
  }

  const comms = await commsSettingsService.resolve(ctx.organizationId).catch(() => null);
  const emailReady = Boolean(comms?.emailEnabled && comms?.email);
  const smsReady = Boolean(comms?.smsEnabled && comms?.sms);

  const items: Array<{ clientId: string; loanId: string; channel: 'SMS' | 'EMAIL'; scheduleId: string; label: string }> = [];

  for (const instalment of instalments) {
    const client = instalment.loan.client;
    const preference = client.communicationPreference;

    const alreadySent = await prisma.assistantOutreach.findUnique({
      where: { dedupeKey: `reminder:${ctx.automationId}:${instalment.id}` },
      select: { id: true },
    });
    if (alreadySent) {
      note('already reminded');
      continue;
    }

    const canSms = Boolean(client.phone) && smsReady && !preference?.smsOptOut;
    const canEmail = Boolean(client.email) && emailReady && !preference?.emailOptOut;

    const channel: 'SMS' | 'EMAIL' | null =
      channelChoice === 'SMS'
        ? canSms
          ? 'SMS'
          : null
        : channelChoice === 'EMAIL'
          ? canEmail
            ? 'EMAIL'
            : null
          : canSms
            ? 'SMS'
            : canEmail
              ? 'EMAIL'
              : null;

    if (!channel) {
      note(
        preference?.smsOptOut || preference?.emailOptOut
          ? 'opted out'
          : !smsReady && !emailReady
            ? 'no channel is set up'
            : 'no usable address'
      );
      continue;
    }

    items.push({
      clientId: client.id,
      loanId: instalment.loan.id,
      channel,
      scheduleId: instalment.id,
      label: `${[client.firstName, client.lastName].filter(Boolean).join(' ') || client.businessName || 'client'} · ${instalment.loan.loanNumber}`,
    });
  }

  if (items.length === 0) {
    return {
      summary: `Nothing to send: ${Object.entries(skippedReasons)
        .map(([reason, count]) => `${count} ${reason}`)
        .join(', ') || 'no eligible clients'}.`,
      stats,
    };
  }

  if (ctx.dryRun) {
    stats.prepared = items.length;
    return {
      summary: [
        `Would send ${items.length} reminder(s) for instalments due on ${target.toISOString().slice(0, 10)}:`,
        ...items.slice(0, 15).map(item => `· ${item.label} (${item.channel})`),
        items.length > 15 ? `…and ${items.length - 15} more` : '',
        Object.keys(skippedReasons).length
          ? `Skipped: ${Object.entries(skippedReasons).map(([reason, count]) => `${count} ${reason}`).join(', ')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
      stats,
    };
  }

  // One action for the whole batch: a person approving fifty reminders should
  // press one button, not fifty.
  const action = await actAs(
    { organizationId: ctx.organizationId, userId: ctx.ownerId, branchId: ctx.branchId },
    {
      toolName: 'send_reminder_batch',
      args: {
        subject,
        body,
        items: items.map(item => ({
          clientId: item.clientId,
          loanId: item.loanId,
          channel: item.channel,
          dedupeKey: `reminder:${ctx.automationId}:${item.scheduleId}`,
        })),
      },
      idempotencyKey: `reminders:${ctx.automationId}:${target.toISOString().slice(0, 10)}`,
      title: `Send ${items.length} payment reminder(s) for ${target.toISOString().slice(0, 10)}`,
      automationId: ctx.automationId,
    }
  );

  if (action.outcome === 'pending') {
    stats.awaitingApproval = items.length;
    return {
      summary: `${items.length} reminder(s) are ready and waiting for approval.`,
      stats,
    };
  }
  if (action.outcome === 'refused') {
    stats.failed = items.length;
    return { summary: `The reminders could not be sent: ${action.reason}`, stats };
  }

  const sent = (action.result as { sent?: number; failed?: number } | undefined) ?? {};
  stats.sent = sent.sent ?? 0;
  stats.failed = sent.failed ?? 0;
  return {
    summary: `Sent ${stats.sent} reminder(s)${stats.failed ? `, ${stats.failed} could not be delivered` : ''}.`,
    stats,
  };
}

// -------------------------------------------------------------- the briefing

/** The morning summary for each branch. */
export async function runBranchBriefing(ctx: AutomationRunContext): Promise<AutomationResult> {
  const daysAhead = Math.max(1, Math.min(Number(ctx.config.daysAhead ?? 3), 14));
  const branches = await prisma.branch.findMany({
    where: {
      organizationId: ctx.organizationId,
      isActive: true,
      ...(ctx.branchId ? { id: ctx.branchId } : {}),
    },
    select: { id: true, name: true, managerId: true },
  });

  if (branches.length === 0) return { summary: 'This organization has no active branches.', stats: { branches: 0 } };

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setHours(23, 59, 59, 999);
  const horizon = new Date(startOfToday);
  horizon.setDate(horizon.getDate() + daysAhead);
  horizon.setHours(23, 59, 59, 999);
  const yesterday = new Date(startOfToday);
  yesterday.setDate(yesterday.getDate() - 1);

  const stats: Record<string, unknown> = { branches: branches.length, delivered: 0 };
  const summaries: string[] = [];

  for (const branch of branches) {
    const unpaid = { status: { notIn: ['COMPLETED', 'CANCELLED', 'REVERSED', 'REFUNDED'] as string[] }, outstandingAmount: { gt: 0 } };
    const loanScope = { organizationId: ctx.organizationId, branchId: branch.id, status: { in: ['ACTIVE', 'OVERDUE'] as string[] } };

    const [dueToday, dueSoon, overdue, collectedYesterday, disbursedYesterday, awaitingAssessment, awaitingDisbursement] =
      await Promise.all([
        prisma.repaymentSchedule.aggregate({
          where: { ...unpaid, dueDate: { gte: startOfToday, lte: endOfToday }, loan: loanScope } as never,
          _count: true,
          _sum: { outstandingAmount: true },
        }),
        prisma.repaymentSchedule.aggregate({
          where: { ...unpaid, dueDate: { gt: endOfToday, lte: horizon }, loan: loanScope } as never,
          _count: true,
          _sum: { outstandingAmount: true },
        }),
        prisma.repaymentSchedule.aggregate({
          where: { ...unpaid, dueDate: { lt: startOfToday }, loan: loanScope } as never,
          _count: true,
          _sum: { outstandingAmount: true },
        }),
        prisma.payment.aggregate({
          where: {
            loan: { organizationId: ctx.organizationId, branchId: branch.id },
            paymentDate: { gte: yesterday, lt: startOfToday },
            status: { notIn: ['REVERSED', 'CANCELLED', 'FAILED'] },
          },
          _count: true,
          _sum: { amount: true },
        }),
        prisma.loan.aggregate({
          where: { organizationId: ctx.organizationId, branchId: branch.id, disbursedDate: { gte: yesterday, lt: startOfToday } },
          _count: true,
          _sum: { amount: true },
        }),
        prisma.loan.count({
          where: { organizationId: ctx.organizationId, branchId: branch.id, status: 'PENDING' },
        }),
        prisma.loan.count({
          where: { organizationId: ctx.organizationId, branchId: branch.id, status: 'APPROVED' },
        }),
      ]);

    const amount = (value: unknown) => Number(value ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const lines = [
      `${branch.name} — ${new Date().toISOString().slice(0, 10)}`,
      `Due today: ${dueToday._count} instalment(s), ${amount(dueToday._sum.outstandingAmount)}`,
      `Due in the next ${daysAhead} day(s): ${dueSoon._count}, ${amount(dueSoon._sum.outstandingAmount)}`,
      `In arrears: ${overdue._count} instalment(s), ${amount(overdue._sum.outstandingAmount)}`,
      `Collected yesterday: ${collectedYesterday._count} payment(s), ${amount(collectedYesterday._sum.amount)}`,
      `Disbursed yesterday: ${disbursedYesterday._count} loan(s), ${amount(disbursedYesterday._sum.amount)}`,
      `Waiting for assessment: ${awaitingAssessment} · waiting for disbursement: ${awaitingDisbursement}`,
    ];

    let narrative = '';
    if (ctx.config.includeNarrative === true) {
      narrative = await briefingNarrative(ctx.organizationId, lines.join('\n')).catch(() => '');
    }

    const text = [...lines, narrative].filter(Boolean).join('\n');
    summaries.push(text);

    if (ctx.dryRun) continue;

    const recipients = new Set<string>(
      [
        ...(Array.isArray(ctx.config.recipientIds) ? (ctx.config.recipientIds as string[]) : []),
        ...(branch.managerId ? [branch.managerId] : []),
      ].filter(Boolean)
    );

    if (recipients.size === 0) {
      // Nobody manages this branch: fall back to whoever may read reports.
      const delivered = await inAppNotificationService
        .notifyPermissionHolders({
          organizationId: ctx.organizationId,
          permission: 'reports:view',
          branchId: branch.id,
          type: NOTIFICATION_TYPES.ASSISTANT_BRIEFING,
          title: `Morning briefing — ${branch.name}`,
          body: truncate(text, 600),
          link: `/assistant/automations?automation=${ctx.automationId}`,
          resource: 'assistant_automation',
          resourceId: ctx.automationId,
        })
        .catch(() => 0);
      stats.delivered = (stats.delivered as number) + delivered;
      continue;
    }

    for (const recipientId of recipients) {
      await inAppNotificationService
        .notify({
          organizationId: ctx.organizationId,
          recipientId,
          type: NOTIFICATION_TYPES.ASSISTANT_BRIEFING,
          title: `Morning briefing — ${branch.name}`,
          body: truncate(text, 600),
          link: `/assistant/automations?automation=${ctx.automationId}`,
          resource: 'assistant_automation',
          resourceId: ctx.automationId,
        })
        .catch(() => undefined);
      stats.delivered = (stats.delivered as number) + 1;
    }
  }

  return { summary: summaries.join('\n\n'), stats };
}

/**
 * Two or three sentences over the figures.
 *
 * Optional, and never allowed to invent anything: the model is given the same
 * lines the briefing already contains and asked only to point out what stands
 * out. If it is unavailable the briefing goes out without it.
 */
async function briefingNarrative(organizationId: string, figures: string): Promise<string> {
  const settings = await assistantSettingsService.resolve(organizationId);
  const adapter = await resolveAssistantModel(organizationId, {
    providerName: settings.providerName,
    modelName: settings.modelName,
  });
  const reply = await adapter.complete({
    system:
      'You write two short sentences for a branch manager, about the figures you are given. Use only those figures. Do not invent anything, do not give advice about individual clients, and do not use markdown.',
    turns: [{ role: 'user', content: figures }],
    tools: [],
    maxTokens: 200,
  });
  await assistantSettingsService
    .recordUsage({
      organizationId,
      provider: adapter.provider,
      model: adapter.model,
      inputTokens: reply.usage.inputTokens,
      outputTokens: reply.usage.outputTokens,
    })
    .catch(() => undefined);
  return reply.text.trim();
}

// ---------------------------------------------------------- standing prompts

/** A standing instruction: queued as an ordinary run, worked by the worker. */
async function runCustomPrompt(ctx: AutomationRunContext, name: string): Promise<AutomationResult> {
  const prompt = String(ctx.config.prompt ?? '').trim();
  if (!prompt) throw new AssistantError('This automation has no instruction to follow.', 'NO_PROMPT');

  if (ctx.dryRun) {
    return { summary: `Would run: “${truncate(prompt, 200)}”`, stats: { prompt: truncate(prompt, 200) } };
  }

  const conversation = await prisma.assistantConversation.create({
    data: {
      organizationId: ctx.organizationId,
      userId: ctx.ownerId,
      channel: 'AUTOMATION',
      title: name,
      context: { automationId: ctx.automationId } as never,
    },
  });

  await prisma.assistantMessage.create({
    data: {
      conversationId: conversation.id,
      organizationId: ctx.organizationId,
      role: 'user',
      content: prompt,
    },
  });

  const run = await prisma.assistantRun.create({
    data: {
      organizationId: ctx.organizationId,
      conversationId: conversation.id,
      trigger: 'AUTOMATION',
      actingUserId: ctx.ownerId,
      automationId: ctx.automationId,
      input: { prompt } as never,
      status: 'QUEUED',
    },
  });

  return {
    summary: `Started. The assistant is working on it; you will be told when it finishes.`,
    stats: { runId: run.id, conversationId: conversation.id },
  };
}

// ------------------------------------------------------------------ the CRUD

class AssistantAutomationService {
  async list(ctx: AutomationContext) {
    const automations = await prisma.assistantAutomation.findMany({
      where: { organizationId: ctx.organizationId },
      select: PUBLIC_FIELDS,
      orderBy: { createdAt: 'asc' },
    });
    return { catalogue: AUTOMATION_CATALOGUE, automations };
  }

  async get(ctx: AutomationContext, id: string) {
    const automation = await prisma.assistantAutomation.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: PUBLIC_FIELDS,
    });
    if (!automation) throw new AssistantError('No such automation.', 'NOT_FOUND', 404);
    const runs = await prisma.assistantAutomationRun.findMany({
      where: { automationId: id },
      orderBy: { startedAt: 'desc' },
      take: 20,
    });
    return { automation, runs };
  }

  async create(
    ctx: AutomationContext,
    input: {
      type: string;
      name?: string;
      schedule?: unknown;
      timezone?: string;
      config?: Record<string, unknown>;
      branchId?: string | null;
      enabled?: boolean;
      dryRun?: boolean;
    }
  ) {
    const definition = AUTOMATION_CATALOGUE.find(entry => entry.type === input.type);
    if (!definition) throw new AssistantError('That kind of automation does not exist.', 'UNKNOWN_TYPE');

    const settings = await assistantSettingsService.resolve(ctx.organizationId);
    const schedule = parseSchedule(input.schedule ?? definition.defaultSchedule);
    const timezone = input.timezone || settings.timezone;
    const config = { ...definition.defaultConfig, ...(input.config ?? {}) };

    if (definition.type === 'CUSTOM_PROMPT' && !String(config.prompt ?? '').trim()) {
      throw new AssistantError('Write the instruction this should follow.', 'NO_PROMPT');
    }
    if (definition.needsMailbox && !config.connectionId) {
      const mailbox = await prisma.assistantConnection.findFirst({
        where: { organizationId: ctx.organizationId, status: 'ACTIVE', toolkit: { in: ['gmail', 'outlook'] } },
        select: { id: true },
      });
      if (!mailbox) {
        throw new AssistantError(
          'Connect a mailbox first - this automation has nothing to read otherwise.',
          'NO_MAILBOX'
        );
      }
      config.connectionId = mailbox.id;
    }

    const enabled = input.enabled ?? false;
    const automation = await prisma.assistantAutomation.create({
      data: {
        organizationId: ctx.organizationId,
        type: definition.type,
        name: input.name?.slice(0, 120) || definition.name,
        enabled,
        schedule: schedule as never,
        timezone,
        config: config as never,
        // New automations watch before they act.
        dryRun: input.dryRun ?? true,
        ownerId: ctx.userId,
        branchId: input.branchId ?? null,
        createdById: ctx.userId,
        nextRunAt: enabled ? nextRunAt(schedule, timezone) : null,
      },
      select: PUBLIC_FIELDS,
    });
    return automation;
  }

  async update(
    ctx: AutomationContext,
    id: string,
    input: {
      name?: string;
      schedule?: unknown;
      timezone?: string;
      config?: Record<string, unknown>;
      branchId?: string | null;
      enabled?: boolean;
      dryRun?: boolean;
      ownerId?: string;
    }
  ) {
    const existing = await prisma.assistantAutomation.findFirst({
      where: { id, organizationId: ctx.organizationId },
    });
    if (!existing) throw new AssistantError('No such automation.', 'NOT_FOUND', 404);

    const schedule = input.schedule ? parseSchedule(input.schedule) : parseSchedule(existing.schedule);
    const timezone = input.timezone || existing.timezone;
    const enabled = input.enabled ?? existing.enabled;

    if (input.ownerId) {
      const owner = await prisma.user.findFirst({
        where: { id: input.ownerId, organizationId: ctx.organizationId, isActive: true },
        select: { id: true },
      });
      if (!owner) throw new AssistantError('That person is not in this organization.', 'NOT_FOUND', 404);
    }

    return prisma.assistantAutomation.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.slice(0, 120) } : {}),
        ...(input.config !== undefined
          ? { config: { ...((existing.config ?? {}) as Record<string, unknown>), ...input.config } as never }
          : {}),
        ...(input.branchId !== undefined ? { branchId: input.branchId } : {}),
        ...(input.dryRun !== undefined ? { dryRun: input.dryRun } : {}),
        ...(input.ownerId ? { ownerId: input.ownerId } : {}),
        schedule: schedule as never,
        timezone,
        enabled,
        nextRunAt: enabled ? nextRunAt(schedule, timezone) : null,
      },
      select: PUBLIC_FIELDS,
    });
  }

  async remove(ctx: AutomationContext, id: string) {
    const existing = await prisma.assistantAutomation.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: { id: true },
    });
    if (!existing) throw new AssistantError('No such automation.', 'NOT_FOUND', 404);
    await prisma.assistantAutomation.delete({ where: { id } });
    return { removed: true };
  }

  /** Run it now - by default as a dry run, so "try it" is always safe. */
  async runNow(ctx: AutomationContext, id: string, options: { dryRun?: boolean } = {}) {
    const automation = await prisma.assistantAutomation.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: { id: true },
    });
    if (!automation) throw new AssistantError('No such automation.', 'NOT_FOUND', 404);
    return runAutomation(id, 'MANUAL', { dryRun: options.dryRun ?? true });
  }

  async runs(ctx: AutomationContext, id: string, limit = 20) {
    const automation = await prisma.assistantAutomation.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: { id: true },
    });
    if (!automation) throw new AssistantError('No such automation.', 'NOT_FOUND', 404);
    return prisma.assistantAutomationRun.findMany({
      where: { automationId: id },
      orderBy: { startedAt: 'desc' },
      take: Math.min(limit, 100),
    });
  }
}

export const assistantAutomationService = new AssistantAutomationService();
