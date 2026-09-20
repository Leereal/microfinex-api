/**
 * Answering clients who write on WhatsApp.
 *
 * A client messages the lender's number and gets an immediate, accurate answer
 * about their own account - what is due, when, and how much is left - instead
 * of waiting for somebody to open the system. Three things keep that safe:
 *
 *   Scope        the run is bound to the one client whose number wrote in, and
 *                every tool is filtered to their own records. There is no way
 *                to ask about anybody else.
 *   Verification a phone can be borrowed, lost or sold, so account details are
 *                only shared after the caller confirms something only the
 *                client would know. Until then the assistant will greet them
 *                and nothing more.
 *   Handover     anything it cannot do, any sign of upset, and any request for
 *                a person stops the assistant and calls a colleague in.
 *
 * It never promises anything: no approvals, no waivers, no new due dates. The
 * system prompt says so, and the tools it is given make none of them possible.
 */

import { z } from 'zod';
import { prisma } from '../../../config/database';
import { commsSettingsService } from '../../communications/comms-settings.service';
import { sendWhatsApp } from '../../communications/comms.providers';
import { inAppNotificationService, NOTIFICATION_TYPES } from '../../in-app-notification.service';
import { asksForAPerson, identityAnswerMatches, truncate } from '../assistant.logic';
import { assistantSettingsService } from '../assistant.settings.service';
import { registerExternalTools } from '../tools';
import type { AssistantTool } from '../tools/tool-kit';
import { executeRun } from '../assistant.runtime';

/** Replies the assistant may send one client in an hour, before it goes quiet. */
async function repliesInLastHour(organizationId: string, clientId: string): Promise<number> {
  return prisma.clientMessage.count({
    where: {
      organizationId,
      clientId,
      direction: 'OUTBOUND',
      // The assistant's own replies: nobody typed them, and they belong to no
      // broadcast. A broadcast that happens to reach this client is not the
      // assistant talking.
      sentById: null,
      broadcastId: null,
      createdAt: { gte: new Date(Date.now() - 3600_000) },
    },
  });
}

/** The thread this client is having with the assistant. */
async function conversationFor(organizationId: string, clientId: string) {
  const existing = await prisma.assistantConversation.findFirst({
    where: { organizationId, clientId, channel: 'WHATSAPP' },
    orderBy: { lastMessageAt: 'desc' },
  });
  if (existing) return existing;
  return prisma.assistantConversation.create({
    data: { organizationId, clientId, channel: 'WHATSAPP', title: 'WhatsApp' },
  });
}

/**
 * Who the assistant acts for on a client thread.
 *
 * It still acts on somebody's authority - the client's own loan officer where
 * there is one, otherwise whoever may message clients - so the reads it makes
 * are the reads that person could make, and the audit trail names them.
 */
async function actingUserFor(organizationId: string, clientId: string): Promise<string | null> {
  const loan = await prisma.loan.findFirst({
    where: { organizationId, clientId },
    orderBy: { createdAt: 'desc' },
    select: { loanOfficerId: true },
  });
  if (loan?.loanOfficerId) {
    const officer = await prisma.user.findFirst({
      where: { id: loan.loanOfficerId, isActive: true },
      select: { id: true },
    });
    if (officer) return officer.id;
  }

  const fallback = await prisma.user.findFirst({
    where: { organizationId, isActive: true, role: { in: ['ORG_ADMIN', 'ADMIN', 'MANAGER'] } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  return fallback?.id ?? null;
}

async function sendReply(organizationId: string, clientId: string, phone: string, body: string) {
  const config = await commsSettingsService.resolve(organizationId);
  if (!config.whatsapp || !config.whatsappEnabled) return null;

  const message = await prisma.clientMessage.create({
    data: {
      organizationId,
      clientId,
      channel: 'WHATSAPP',
      provider: 'WHATSAPP_CLOUD',
      direction: 'OUTBOUND',
      toAddress: phone,
      fromAddress: config.whatsapp.phoneNumberId,
      body,
      status: 'SENDING',
      attempts: 1,
      // No sentById: nobody typed it. That is also how the hourly limit
      // recognises the assistant's own replies.
      sentById: null,
    },
  });

  const outcome = await sendWhatsApp(config.whatsapp, { kind: 'text', to: phone, body });
  await prisma.clientMessage.update({
    where: { id: message.id },
    data: outcome.ok
      ? { status: outcome.status, providerMessageId: outcome.providerMessageId, sentAt: new Date() }
      : { status: 'FAILED', failedAt: new Date(), errorCode: outcome.errorCode, errorMessage: outcome.errorMessage },
  });
  return message.id;
}

async function handOver(input: {
  organizationId: string;
  clientId: string;
  clientName: string;
  phone: string;
  text: string;
  reason: string;
}) {
  const settings = await assistantSettingsService.resolve(input.organizationId);
  const conversation = await conversationFor(input.organizationId, input.clientId);

  await prisma.assistantConversation.update({
    where: { id: conversation.id },
    data: { handoffUntil: new Date(Date.now() + settings.whatsapp.handoffHours * 3600_000) },
  });

  const officer = await actingUserFor(input.organizationId, input.clientId);
  if (officer) {
    await inAppNotificationService
      .notify({
        organizationId: input.organizationId,
        recipientId: officer,
        type: NOTIFICATION_TYPES.ASSISTANT_HANDOFF,
        title: `${input.clientName} asked for a person on WhatsApp`,
        body: truncate(input.text, 180),
        link: `/clients/${input.clientId}?tab=messages`,
        resource: 'client',
        resourceId: input.clientId,
      })
      .catch(() => undefined);
  } else {
    await inAppNotificationService
      .notifyPermissionHolders({
        organizationId: input.organizationId,
        permission: 'communications:send',
        type: NOTIFICATION_TYPES.ASSISTANT_HANDOFF,
        title: `${input.clientName} asked for a person on WhatsApp`,
        body: truncate(input.text, 180),
        link: `/clients/${input.clientId}?tab=messages`,
        resource: 'client',
        resourceId: input.clientId,
      })
      .catch(() => undefined);
  }

  await sendReply(
    input.organizationId,
    input.clientId,
    input.phone,
    'Thank you - I am passing this to a colleague, who will come back to you shortly.'
  );
}

/** The two tools only a client conversation has. */
export function registerWhatsAppTools() {
  registerExternalTools(async ctx => {
    if (!ctx.clientScopeId) return [];
    const clientId = ctx.clientScopeId;

    const tools: AssistantTool[] = [
      {
        name: 'verify_identity',
        capability: 'clients.read',
        clientFacing: true,
        description:
          'Check what the client gave you against their record - the last four digits of their ID number, or their date of birth. Call this before discussing their account.',
        schema: z.object({ answer: z.string().min(2).max(40) }),
        summarise: () => 'Check the caller’s identity',
        async execute(args) {
          const client = await prisma.client.findUnique({
            where: { id: clientId },
            select: { idNumber: true, dateOfBirth: true },
          });
          if (!client) return { verified: false };

          const verified = identityAnswerMatches(args.answer, client);
          if (verified) {
            await prisma.assistantConversation.updateMany({
              where: { organizationId: ctx.organizationId, clientId, channel: 'WHATSAPP' },
              // Verified for a day, so a client is not interrogated on every
              // message, and not forever either.
              data: { verifiedUntil: new Date(Date.now() + 24 * 3600_000) },
            });
          }
          return {
            verified,
            note: verified
              ? 'You may now discuss this client’s own account.'
              : 'That did not match. Ask once more, and if it still does not match, hand over to a colleague.',
          };
        },
      },
      {
        name: 'handoff_to_staff',
        capability: 'staff.notify',
        clientFacing: true,
        description:
          'Hand this conversation to a person. Use it whenever you cannot help, the client is unhappy, or they ask for somebody.',
        schema: z.object({ reason: z.string().max(300) }),
        summarise: () => 'Hand over to a colleague',
        async execute(args) {
          const client = await prisma.client.findUnique({
            where: { id: clientId },
            select: { firstName: true, lastName: true, businessName: true, phone: true },
          });
          await handOver({
            organizationId: ctx.organizationId,
            clientId,
            clientName:
              [client?.firstName, client?.lastName].filter(Boolean).join(' ') || client?.businessName || 'A client',
            phone: client?.phone ?? '',
            text: args.reason,
            reason: args.reason,
          });
          return { handedOver: true, note: 'A colleague has been told. Tell the client somebody will be in touch.' };
        },
      },
    ];

    return tools;
  });
}

/**
 * A client has written in.
 *
 * Called from the WhatsApp webhook once the message has been recorded and
 * matched to a client. Everything here is best-effort: a failure must never
 * stop the webhook, because WhatsApp retries what it thinks did not arrive.
 */
export async function onClientWhatsAppMessage(input: {
  organizationId: string;
  clientId: string;
  text: string;
  phone: string;
  clientName: string;
}): Promise<void> {
  const settings = await assistantSettingsService.resolve(input.organizationId);
  if (!settings.enabled || !settings.whatsappEnabled) return;
  if (!input.text.trim()) return;

  const conversation = await conversationFor(input.organizationId, input.clientId);

  // A conversation a person has taken over stays theirs.
  if (conversation.handoffUntil && conversation.handoffUntil > new Date()) return;

  if (asksForAPerson(input.text)) {
    await handOver({ ...input, text: input.text, reason: 'The client asked for a person.' });
    return;
  }

  if ((await repliesInLastHour(input.organizationId, input.clientId)) >= settings.whatsapp.hourlyReplyLimit) {
    // Rather than going quiet, the conversation goes to a person.
    await handOver({ ...input, text: input.text, reason: 'Too many messages in a short time.' });
    return;
  }

  const actingUserId = await actingUserFor(input.organizationId, input.clientId);
  if (!actingUserId) return;

  await prisma.assistantMessage.create({
    data: {
      conversationId: conversation.id,
      organizationId: input.organizationId,
      role: 'user',
      content: truncate(input.text, 2000),
    },
  });

  const run = await prisma.assistantRun.create({
    data: {
      organizationId: input.organizationId,
      conversationId: conversation.id,
      trigger: 'WHATSAPP',
      actingUserId,
      input: { prompt: truncate(input.text, 2000) } as never,
      status: 'RUNNING',
      startedAt: new Date(),
      heartbeatAt: new Date(),
    },
  });

  try {
    // Run it here rather than queueing: somebody is waiting on their phone.
    const outcome = await executeRun(run.id);
    const reply = (outcome.summary ?? '').trim();
    if (reply) {
      await sendReply(input.organizationId, input.clientId, input.phone, truncate(reply, 900));
    }
  } catch (error) {
    console.error('WhatsApp assistant failed:', (error as Error).message);
    await handOver({ ...input, text: input.text, reason: 'The assistant could not answer.' });
  }
}
