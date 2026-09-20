/**
 * What the assistant does with a connected mailbox, on a schedule.
 *
 * Two jobs, both deliberately written as ordinary code rather than as prompts:
 *
 *   Intake      - an application arrives by email with documents attached. The
 *                 documents are saved, read, and either matched to a client who
 *                 already exists or turned into a request to create one.
 *   Capture     - mail to and from a client's own address is filed against
 *                 their record, so the correspondence lives with the loan
 *                 instead of in one person's inbox.
 *
 * Matching an address to a client, deciding what is a duplicate and filing a
 * message are all decisions with right answers, and a model is the wrong tool
 * for them: it would be slower, cost money per email, and could be talked into
 * filing an email against the wrong client by the email itself. The model is
 * used only where judgement is genuinely needed - reading a document.
 */

import { prisma } from '../../../config/database';
import { aiExtractionService } from '../../ai-extraction.service';
import { storageService } from '../../storage.service';
import { noteThreadService } from '../../notes/note-thread.service';
import { inAppNotificationService, NOTIFICATION_TYPES } from '../../in-app-notification.service';
import { truncate } from '../assistant.logic';
import { actAs } from '../assistant.execute';
import { emailAdapter, type MailConnection, type MailMessage } from './email.adapter';
import { requireMailbox } from './email.tools';

export interface AutomationRunContext {
  automationId: string;
  organizationId: string;
  ownerId: string;
  branchId: string | null;
  dryRun: boolean;
  config: Record<string, unknown>;
}

export interface AutomationResult {
  summary: string;
  stats: Record<string, unknown>;
}

const PROVIDER_FOR = (toolkit: string) => (toolkit === 'gmail' ? 'COMPOSIO_GMAIL' : 'COMPOSIO_OUTLOOK');

/** The client whose address this is, if the organization has one. */
async function clientForAddress(organizationId: string, address: string | null | undefined) {
  if (!address) return null;
  const email = address.toLowerCase();
  return prisma.client.findFirst({
    where: {
      organizationId,
      OR: [
        { email: { equals: email, mode: 'insensitive' } },
        { contacts: { some: { contactValue: { equals: email, mode: 'insensitive' } } } },
      ],
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      businessName: true,
      clientNumber: true,
      branchId: true,
      loans: {
        select: { id: true, loanOfficerId: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });
}

async function alreadyHandled(connectionId: string, purpose: string, messageId: string) {
  const existing = await prisma.assistantProcessedEmail.findUnique({
    where: {
      connectionId_purpose_providerMessageId: {
        connectionId,
        purpose,
        providerMessageId: messageId,
      },
    },
    select: { id: true },
  });
  return Boolean(existing);
}

async function markHandled(input: {
  organizationId: string;
  connectionId: string;
  purpose: string;
  messageId: string;
  outcome: string;
  clientId?: string | null;
}) {
  await prisma.assistantProcessedEmail
    .create({
      data: {
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        purpose: input.purpose,
        providerMessageId: input.messageId,
        outcome: input.outcome,
        clientId: input.clientId ?? null,
      },
    })
    .catch(() => undefined);
}

/** Save an email's attachments where the rest of the assistant can reach them. */
async function saveAttachments(
  connection: MailConnection,
  message: MailMessage,
  organizationId: string,
  limit = 6
) {
  const saved: Array<{ id: string; fileName: string; mimeType: string; buffer: Buffer }> = [];
  for (const attachment of message.attachments.slice(0, limit)) {
    try {
      const bytes = await emailAdapter.downloadAttachment(connection, message.id, attachment);
      const upload = await storageService.upload(bytes, attachment.fileName, attachment.mimeType, bytes.length, {
        organizationId,
        entityType: 'organizations',
        entityId: organizationId,
        fileType: 'NOTE_ATTACHMENT',
        subEntityId: 'email-intake',
      });
      const artifact = await prisma.assistantArtifact.create({
        data: {
          organizationId,
          kind: 'EMAIL_ATTACHMENT',
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          fileSize: bytes.length,
          storagePath: upload.path,
          metadata: { emailMessageId: message.id, from: message.from?.address ?? null } as never,
        },
      });
      saved.push({ id: artifact.id, fileName: attachment.fileName, mimeType: attachment.mimeType, buffer: bytes });
    } catch (error) {
      console.error('Assistant could not save an attachment:', (error as Error).message);
    }
  }
  return saved;
}

/**
 * Applications arriving by email.
 *
 * An email that matches a client already on file has its documents filed and
 * their officer told. One that does not becomes a request to create a client,
 * pre-filled from whatever the documents say - which a person checks before
 * anything is created, because a document read by a model is not evidence.
 */
export async function runEmailIntake(ctx: AutomationRunContext): Promise<AutomationResult> {
  const connection = await requireMailbox(ctx.organizationId, ctx.config.connectionId as string | undefined);
  const lookbackDays = Number(ctx.config.lookbackDays ?? 3);
  const maxPerRun = Math.min(Number(ctx.config.maxPerRun ?? 10), 25);
  const query = String(ctx.config.query ?? 'loan application');

  const messages = await emailAdapter.search(connection, {
    query,
    since: new Date(Date.now() - lookbackDays * 86_400_000),
    onlyWithAttachments: ctx.config.requireAttachments !== false,
    maxResults: maxPerRun,
  });

  const stats = {
    scanned: messages.length,
    prepared: 0,
    matched: 0,
    skipped: 0,
    alreadyHandled: 0,
    failed: 0,
    query,
  };
  const lines: string[] = [];

  for (const message of messages) {
    if (message.isOutbound) {
      stats.skipped += 1;
      continue;
    }
    if (await alreadyHandled(connection.id, 'INTAKE', message.id)) {
      stats.skipped += 1;
      stats.alreadyHandled += 1;
      continue;
    }

    const sender = message.from?.address ?? null;
    const existing = await clientForAddress(ctx.organizationId, sender);

    if (ctx.dryRun) {
      lines.push(
        `Would ${existing ? 'file documents against' : 'prepare a new client from'} “${truncate(message.subject, 60)}” from ${sender ?? 'unknown'}`
      );
      stats.prepared += 1;
      continue;
    }

    try {
      const attachments = await saveAttachments(connection, message, ctx.organizationId);

      if (existing) {
        if (attachments.length > 0) {
          const action = await actAs(
            { organizationId: ctx.organizationId, userId: ctx.ownerId, branchId: ctx.branchId },
            {
              toolName: 'attach_documents_to_client',
              args: { clientId: existing.id, artifactIds: attachments.map(file => file.id) },
              idempotencyKey: `intake:${connection.id}:${message.id}`,
              title: `File ${attachments.length} document(s) emailed by ${sender}`,
              automationId: ctx.automationId,
            }
          );
          lines.push(
            `${action.outcome === 'done' ? 'Filed' : action.outcome === 'pending' ? 'Waiting for approval to file' : 'Could not file'} ${attachments.length} document(s) for ${existing.clientNumber}`
          );
        }
        await markHandled({
          organizationId: ctx.organizationId,
          connectionId: connection.id,
          purpose: 'INTAKE',
          messageId: message.id,
          outcome: 'EXISTING_CLIENT',
          clientId: existing.id,
        });
        stats.matched += 1;
        continue;
      }

      // Nobody on file: read what was sent and prepare a client for approval.
      let details: Record<string, unknown> = {};
      if (attachments.length > 0) {
        const extraction = await aiExtractionService.extractFromDocuments(
          ctx.organizationId,
          attachments.map(file => ({
            fileName: file.fileName,
            mimeType: file.mimeType,
            data: file.buffer.toString('base64'),
          }))
        );
        if (extraction.success && extraction.data) details = extraction.data as unknown as Record<string, unknown>;
      }

      const phone = String(details.phone ?? details.mobileNumber ?? '').trim();

      // Documents do not always carry a name. The sender's own display name is
      // a reasonable suggestion - it is theirs, after all - and the approver
      // sees it as an editable field rather than as fact.
      const senderName = (message.from?.name ?? '').replace(/["']/g, '').trim();
      const [senderFirst, ...senderRest] = senderName.split(/\s+/).filter(Boolean);
      const args: Record<string, unknown> = {
        type: 'INDIVIDUAL',
        firstName: (details.firstName as string) || senderFirst || undefined,
        lastName: (details.lastName as string) || (senderRest.length ? senderRest.join(' ') : undefined),
        phone: phone || undefined,
        email: sender ?? undefined,
        idNumber: (details.idNumber as string) || undefined,
        dateOfBirth: typeof details.dateOfBirth === 'string' ? details.dateOfBirth.slice(0, 10) : undefined,
        address: (details.address as string) || undefined,
        city: (details.city as string) || undefined,
        monthlyIncome: typeof details.monthlyIncome === 'number' ? details.monthlyIncome : undefined,
        ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
        attachArtifactIds: attachments.map(file => file.id),
      };

      const action = await actAs(
        { organizationId: ctx.organizationId, userId: ctx.ownerId, branchId: ctx.branchId },
        {
          toolName: 'create_client',
          args,
          idempotencyKey: `intake:${connection.id}:${message.id}`,
          title: `New application by email from ${sender ?? 'an unknown sender'}${args.firstName ? `: ${args.firstName} ${args.lastName ?? ''}`.trim() : ''}`,
          automationId: ctx.automationId,
          // A stranger's email is the least trustworthy input there is, so a
          // person always looks at this one - even where creating clients is
          // otherwise allowed unattended.
          alwaysAsk: true,
        }
      );

      await markHandled({
        organizationId: ctx.organizationId,
        connectionId: connection.id,
        purpose: 'INTAKE',
        messageId: message.id,
        outcome: action.outcome === 'pending' ? 'AWAITING_APPROVAL' : action.outcome.toUpperCase(),
      });

      if (action.outcome === 'pending') {
        stats.prepared += 1;
        lines.push(`Prepared a new client from ${sender ?? 'an unknown sender'} - waiting for approval`);
      } else {
        stats.failed += 1;
        lines.push(`Could not prepare a client from ${sender ?? 'unknown'}: ${action.reason ?? 'unknown reason'}`);
      }
    } catch (error) {
      stats.failed += 1;
      lines.push(`Failed on “${truncate(message.subject, 50)}”: ${(error as Error).message}`);
    }
  }

  // What it looked for matters as much as what it found: an intake that
  // quietly matches nothing looks identical to an empty mailbox.
  const looked = `matching ${query}`;
  const nothing =
    stats.scanned === 0
      ? `No mail ${looked} in the last ${lookbackDays} day(s).`
      : stats.alreadyHandled === stats.scanned
        ? `Checked ${stats.scanned} email(s) ${looked}; all had already been dealt with.`
        : `Checked ${stats.scanned} email(s) ${looked}; nothing new to bring in.`;

  return {
    summary: lines.length > 0 ? lines.slice(0, 20).join('\n') : nothing,
    stats,
  };
}

/**
 * Correspondence with clients, filed against their records.
 *
 * Both directions are captured, so a reply somebody sent from their own
 * mailbox is on the client's record too. Only mail whose other party is
 * recognisably a client is touched; everything else is left alone and never
 * copied into the system.
 */
export async function runEmailCapture(ctx: AutomationRunContext): Promise<AutomationResult> {
  const connection = await requireMailbox(ctx.organizationId, ctx.config.connectionId as string | undefined);
  const lookbackHours = Number(ctx.config.lookbackHours ?? 24);
  const maxPerRun = Math.min(Number(ctx.config.maxPerRun ?? 40), 50);
  const addNote = ctx.config.addNote === true;
  const notifyOfficer = ctx.config.notifyOfficer !== false;

  const messages = await emailAdapter.search(connection, {
    since: new Date(Date.now() - lookbackHours * 3600_000),
    includeSent: ctx.config.includeSent !== false,
    maxResults: maxPerRun,
  });

  const stats = { scanned: messages.length, filed: 0, unmatched: 0, skipped: 0 };
  const lines: string[] = [];

  for (const message of messages) {
    if (await alreadyHandled(connection.id, 'CAPTURE', message.id)) {
      stats.skipped += 1;
      continue;
    }

    const counterpart = message.isOutbound ? message.to[0]?.address : message.from?.address;
    const client = await clientForAddress(ctx.organizationId, counterpart);

    if (!client) {
      stats.unmatched += 1;
      if (!ctx.dryRun) {
        await markHandled({
          organizationId: ctx.organizationId,
          connectionId: connection.id,
          purpose: 'CAPTURE',
          messageId: message.id,
          outcome: 'NO_CLIENT',
        });
      }
      continue;
    }

    const name = [client.firstName, client.lastName].filter(Boolean).join(' ') || client.businessName || client.clientNumber;

    if (ctx.dryRun) {
      lines.push(`Would file “${truncate(message.subject, 60)}” against ${name}`);
      stats.filed += 1;
      continue;
    }

    const duplicate = await prisma.clientMessage.findFirst({
      where: {
        organizationId: ctx.organizationId,
        provider: PROVIDER_FOR(connection.toolkit),
        providerMessageId: message.id,
      },
      select: { id: true },
    });

    if (!duplicate) {
      await prisma.clientMessage.create({
        data: {
          organizationId: ctx.organizationId,
          clientId: client.id,
          loanId: client.loans[0]?.id ?? null,
          channel: 'EMAIL',
          provider: PROVIDER_FOR(connection.toolkit),
          direction: message.isOutbound ? 'OUTBOUND' : 'INBOUND',
          toAddress: message.isOutbound ? (message.to[0]?.address ?? '') : (message.to[0]?.address ?? ''),
          fromAddress: message.from?.address ?? null,
          subject: truncate(message.subject, 300),
          body: truncate(message.bodyText || '(no text)', 8000),
          status: message.isOutbound ? 'SENT' : 'RECEIVED',
          providerMessageId: message.id,
          sentAt: message.date ?? new Date(),
        },
      });
    }

    if (addNote) {
      await noteThreadService
        .create(
          {
            organizationId: ctx.organizationId,
            userId: ctx.ownerId,
            canViewPrivate: false,
            canDeleteAny: false,
          },
          'CLIENT',
          client.id,
          {
            content: `Email ${message.isOutbound ? 'sent to' : 'received from'} ${counterpart}: ${truncate(
              message.subject,
              120
            )}\n\n${truncate(message.bodyText, 1500)}\n\n— filed by the Agentic Assistant`,
          }
        )
        .catch(error => console.error('Assistant note failed:', (error as Error).message));
    }

    if (notifyOfficer && !message.isOutbound && client.loans[0]?.loanOfficerId) {
      await inAppNotificationService
        .notify({
          organizationId: ctx.organizationId,
          recipientId: client.loans[0]!.loanOfficerId,
          type: NOTIFICATION_TYPES.CLIENT_MESSAGE_RECEIVED,
          title: `${name} emailed you`,
          body: truncate(message.subject || message.bodyText, 140),
          link: `/clients/${client.id}?tab=messages`,
          resource: 'client',
          resourceId: client.id,
        })
        .catch(() => undefined);
    }

    await markHandled({
      organizationId: ctx.organizationId,
      connectionId: connection.id,
      purpose: 'CAPTURE',
      messageId: message.id,
      outcome: 'FILED',
      clientId: client.id,
    });
    stats.filed += 1;
    lines.push(`Filed “${truncate(message.subject, 60)}” against ${name}`);
  }

  return {
    summary:
      stats.filed > 0
        ? `${ctx.dryRun ? 'Would file' : 'Filed'} ${stats.filed} email(s); ${stats.unmatched} from addresses that match no client.`
        : `Checked ${stats.scanned} email(s); nothing to file.`,
    stats,
  };
}
