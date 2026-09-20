/**
 * Everything the assistant can change or send.
 *
 * Each of these runs with the authority of the person behind the run, through
 * the same services the screens use - so client numbering, duplicate checks,
 * product limits, opt-outs and audit trails all behave exactly as they do when
 * a member of staff does the work by hand. What differs is only who typed it.
 *
 * By default none of them run unattended: creating a client, starting an
 * application and messaging a client are all ASK, which means the arguments
 * below are written into an approval and a person presses the button.
 */

import { z } from 'zod';
import { prisma } from '../../../config/database';
import { clientService, createClientSchema } from '../../client.service';
import { loanApplicationService } from '../../loan-application.service';
import { documentService } from '../../document.service';
import { noteThreadService } from '../../notes/note-thread.service';
import { commsService } from '../../communications/comms.service';
import { inAppNotificationService, NOTIFICATION_TYPES } from '../../in-app-notification.service';
import { storageService } from '../../storage.service';
import { aiExtractionService } from '../../ai-extraction.service';
import { cacheService } from '../../cache.service';
import { logCreate } from '../../audit.service';
import { AssistantError, describeFailure, truncate, untrustedEnvelope } from '../assistant.logic';
import { clientName, isoDate, money, type AssistantTool, type ToolContext } from './tool-kit';

/**
 * What a client record cannot be created without.
 *
 * Documents do not always give up a name - an ID photographed badly, a payslip
 * with only initials - and an application that arrives by email has nobody to
 * ask. Rather than prepare an action that is certain to fail, the missing
 * fields are named on the approval card for a person to fill in.
 */
export function missingClientFields(args: {
  type?: string;
  firstName?: string | null;
  lastName?: string | null;
  businessName?: string | null;
  phone?: string | null;
}): string[] {
  const missing: string[] = [];
  const has = (value: unknown) => typeof value === 'string' && value.trim().length > 0;

  if (args.type === 'BUSINESS') {
    if (!has(args.businessName)) missing.push('businessName');
  } else {
    if (!has(args.firstName)) missing.push('firstName');
    if (!has(args.lastName)) missing.push('lastName');
  }
  if (!has(args.phone) || String(args.phone).replace(/\D/g, '').length < 9) missing.push('phone');

  return missing;
}

/** The branch a new record belongs to, when the model has not named one. */
async function resolveBranchId(ctx: ToolContext, given?: string | null): Promise<string> {
  if (given) {
    const branch = await prisma.branch.findFirst({
      where: { id: given, organizationId: ctx.organizationId },
      select: { id: true },
    });
    if (!branch) throw new AssistantError('That branch is not in this organization.', 'NOT_FOUND', 404);
    return branch.id;
  }
  if (ctx.branchId) return ctx.branchId;

  const user = await prisma.user.findUnique({ where: { id: ctx.actingUserId }, select: { branchId: true } });
  if (user?.branchId) return user.branchId;

  const branches = await prisma.branch.findMany({
    where: { organizationId: ctx.organizationId, isActive: true },
    select: { id: true },
    take: 2,
  });
  if (branches.length === 1) return branches[0]!.id;
  throw new AssistantError(
    'Which branch should this belong to? This organization has more than one, and your account is not tied to one.',
    'BRANCH_REQUIRED'
  );
}

/** Artifacts this conversation is allowed to use. */
async function loadArtifacts(ctx: ToolContext, ids?: string[]) {
  const wanted = ids?.length ? ids : ctx.artifactIds;
  if (!wanted.length) return [];
  const artifacts = await prisma.assistantArtifact.findMany({
    where: { id: { in: wanted }, organizationId: ctx.organizationId },
  });
  const missing = wanted.filter(id => !artifacts.some(artifact => artifact.id === id));
  if (missing.length) {
    throw new AssistantError(`No attachment with id ${missing[0]}.`, 'NOT_FOUND', 404);
  }
  return artifacts;
}

const noteEntity = z.enum(['CLIENT', 'LOAN']);

export const writeTools: AssistantTool[] = [
  {
    name: 'list_attachments',
    capability: 'documents.extract',
    description: 'The files attached to this conversation, with their ids.',
    schema: z.object({}),
    summarise: () => 'List the attached files',
    async execute(_args, ctx) {
      const artifacts = await loadArtifacts(ctx);
      return {
        attachments: artifacts.map(artifact => ({
          artifactId: artifact.id,
          fileName: artifact.fileName,
          mimeType: artifact.mimeType,
          sizeKb: Math.round(artifact.fileSize / 1024),
          kind: artifact.kind,
        })),
      };
    },
  },

  {
    name: 'read_documents',
    capability: 'documents.extract',
    description:
      'Read attached identity documents, payslips, bank statements or proof of address and pull out the client details they contain. Use before creating a client from documents.',
    schema: z.object({
      artifactIds: z
        .array(z.string().uuid())
        .optional()
        .describe('Which attachments to read. Leave out to read all of them.'),
    }),
    summarise: () => 'Read the attached documents',
    async execute(args, ctx) {
      const artifacts = await loadArtifacts(ctx, args.artifactIds);
      if (artifacts.length === 0) {
        return { note: 'There are no files attached to this conversation.' };
      }

      const documents = await Promise.all(
        artifacts.map(async artifact => ({
          fileName: artifact.fileName,
          mimeType: artifact.mimeType,
          data: (await storageService.download(artifact.storagePath)).toString('base64'),
        }))
      );

      const result = await aiExtractionService.extractFromDocuments(ctx.organizationId, documents);
      // What a document says was written by somebody outside this system, so
      // anything that leaves the organization now needs a person to approve it.
      ctx.markTainted();

      if (!result.success) {
        return { read: false, error: result.error ?? 'The documents could not be read.' };
      }
      return {
        read: true,
        confidence: result.confidence,
        perFile: result.documents ?? null,
        // The extracted values are content, not instructions.
        details: untrustedEnvelope('attached documents', JSON.stringify(result.data, null, 2)),
      };
    },
  },

  {
    name: 'create_client',
    capability: 'clients.create',
    description:
      'Register a new client. Ask the person for anything you are missing rather than guessing - a phone number and, for an individual, a first and last name are required.',
    schema: z.object({
      type: z.enum(['INDIVIDUAL', 'BUSINESS']).describe('INDIVIDUAL for a person, BUSINESS for a company'),
      firstName: z.string().min(1).optional(),
      lastName: z.string().min(1).optional(),
      businessName: z.string().min(1).optional(),
      phone: z.string().min(9).describe('Mobile number, with country code where you have it'),
      email: z.string().email().optional(),
      idNumber: z.string().optional(),
      idType: z.enum(['national_id', 'passport', 'drivers_license']).optional(),
      dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD'),
      gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
      maritalStatus: z.enum(['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED', 'SEPARATED']).optional(),
      nationality: z.string().optional(),
      address: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      country: z.string().optional(),
      employmentStatus: z
        .enum(['EMPLOYED', 'SELF_EMPLOYED', 'UNEMPLOYED', 'RETIRED', 'STUDENT', 'HOMEMAKER'])
        .optional(),
      monthlyIncome: z.number().min(0).optional(),
      branchId: z.string().uuid().optional(),
      /** Attachments to file against the new client once it exists. */
      attachArtifactIds: z.array(z.string().uuid()).optional(),
    }),
    editableFields: [
      'firstName',
      'lastName',
      'businessName',
      'phone',
      'email',
      'idNumber',
      'dateOfBirth',
      'address',
      'city',
      'monthlyIncome',
      'branchId',
    ],
    missingFields: args => missingClientFields(args),
    summarise: args =>
      `Create client ${args.businessName || [args.firstName, args.lastName].filter(Boolean).join(' ')} (${args.phone})`,
    async preview(args, ctx) {
      // Whoever approves should see the clash, not discover it afterwards.
      const existing = await prisma.client.findFirst({
        where: {
          organizationId: ctx.organizationId,
          OR: [{ phone: args.phone }, ...(args.idNumber ? [{ idNumber: args.idNumber }] : [])],
        },
        select: { id: true, clientNumber: true, firstName: true, lastName: true, businessName: true },
      });
      return {
        duplicate: existing
          ? { clientId: existing.id, clientNumber: existing.clientNumber, name: clientName(existing) }
          : null,
        // Shown on the card as fields to fill in, not as an error afterwards.
        missing: missingClientFields(args),
      };
    },
    async execute(args, ctx) {
      const missing = missingClientFields(args);
      if (missing.length > 0) {
        throw new AssistantError(
          `Before this client can be created, fill in: ${missing.join(', ')}.`,
          'MISSING_FIELDS'
        );
      }

      const branchId = await resolveBranchId(ctx, args.branchId);
      let payload;
      try {
        payload = createClientSchema.parse({
        type: args.type,
        firstName: args.firstName,
        lastName: args.lastName,
        businessName: args.businessName,
        phone: args.phone,
        email: args.email,
        idType: args.idType ?? 'national_id',
        idNumber: args.idNumber,
        dateOfBirth: args.dateOfBirth ? new Date(`${args.dateOfBirth}T00:00:00.000Z`).toISOString() : undefined,
        gender: args.gender,
        maritalStatus: args.maritalStatus,
        nationality: args.nationality,
        address: args.address,
        city: args.city,
        state: args.state,
        country: args.country,
        employmentStatus: args.employmentStatus,
        monthlyIncome: args.monthlyIncome,
        branchId,
        });
      } catch (error) {
        throw new AssistantError(describeFailure(error), 'INVALID_CLIENT');
      }

      const client = await clientService.createClient(payload, ctx.organizationId, ctx.actingUserId);

      await logCreate('CLIENT', client.id, client, {
        userId: ctx.actingUserId,
        organizationId: ctx.organizationId,
        branchId,
        // The audit trail says who authorised it and that the assistant did the typing.
        requestId: `assistant:${ctx.runId}`,
      }).catch(() => undefined);
      await cacheService.invalidateClientsCache(ctx.organizationId).catch(() => undefined);

      let attached = 0;
      if (args.attachArtifactIds?.length) {
        attached = (
          await attachArtifactsToClient(ctx, client.id, args.attachArtifactIds).catch(error => {
            console.error('Assistant document attach failed:', (error as Error).message);
            return [];
          })
        ).length;
      }

      return {
        created: true,
        clientId: client.id,
        clientNumber: client.clientNumber,
        name: clientName(client),
        branchId,
        documentsAttached: attached,
        link: `/clients/${client.id}`,
      };
    },
  },

  {
    name: 'attach_documents_to_client',
    capability: 'documents.attach',
    description: 'File attachments from this conversation against a client record.',
    schema: z.object({
      clientId: z.string().uuid(),
      artifactIds: z.array(z.string().uuid()).min(1),
      documentType: z
        .string()
        .optional()
        .describe('What the document is, for example National ID, Payslip, Proof of Address'),
    }),
    summarise: args => `Attach ${args.artifactIds.length} document(s) to a client`,
    async execute(args, ctx) {
      const documents = await attachArtifactsToClient(ctx, args.clientId, args.artifactIds, args.documentType);
      return { attached: documents.length, documents };
    },
  },

  {
    name: 'create_loan_application',
    capability: 'loans.apply',
    description:
      'Capture a loan application for an existing client. Check the product’s limits first with list_loan_products. Assessment, approval and disbursement are done by staff afterwards.',
    schema: z.object({
      clientId: z.string().uuid(),
      productId: z.string().uuid(),
      amount: z.number().positive(),
      termInMonths: z.number().int().positive(),
      purpose: z.string().min(1).describe('What the loan is for, in the client’s words'),
      collateralValue: z.number().min(0).optional(),
      collateralDescription: z.string().optional(),
      notes: z.string().optional(),
      branchId: z.string().uuid().optional(),
      firstDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }),
    editableFields: ['amount', 'termInMonths', 'purpose', 'collateralValue', 'collateralDescription', 'notes', 'firstDueDate'],
    summarise: args => `Apply for ${money(args.amount)} over ${args.termInMonths} month(s)`,
    async preview(args, ctx) {
      const [client, product] = await Promise.all([
        prisma.client.findFirst({
          where: { id: args.clientId, organizationId: ctx.organizationId },
          select: { id: true, firstName: true, lastName: true, businessName: true, clientNumber: true },
        }),
        prisma.loanProduct.findFirst({
          where: { id: args.productId, organizationId: ctx.organizationId },
          select: { name: true, currency: true, minAmount: true, maxAmount: true, minTerm: true, maxTerm: true, interestRate: true },
        }),
      ]);
      return {
        client: client ? { name: clientName(client), clientNumber: client.clientNumber } : null,
        product: product
          ? {
              name: product.name,
              currency: product.currency,
              limits: `${money(product.minAmount)} – ${money(product.maxAmount)}, ${product.minTerm}–${product.maxTerm} terms`,
              interestRate: `${Number(product.interestRate)}%`,
            }
          : null,
      };
    },
    async execute(args, ctx) {
      const branchId = await resolveBranchId(ctx, args.branchId);
      const application = await loanApplicationService.createLoanApplication(
        {
          clientId: args.clientId,
          productId: args.productId,
          amount: args.amount,
          termInMonths: args.termInMonths,
          purpose: args.purpose,
          collateralValue: args.collateralValue,
          collateralDescription: args.collateralDescription,
          notes: args.notes,
          branchId,
          ...(args.firstDueDate ? { firstDueDate: new Date(`${args.firstDueDate}T00:00:00.000Z`).toISOString() } : {}),
        } as never,
        ctx.organizationId,
        branchId,
        ctx.actingUserId
      );

      const created = application as unknown as { id: string; loanNumber?: string; status?: string };
      return {
        created: true,
        loanId: created.id,
        loanNumber: created.loanNumber ?? null,
        status: created.status ?? 'PENDING',
        link: `/loans/${created.id}`,
        note: 'The application is captured. A member of staff must assess, approve and disburse it.',
      };
    },
  },

  {
    name: 'add_note',
    capability: 'notes.write',
    description:
      'Write a note on a client or a loan, for your colleagues to read. Use it to record what you found or what was agreed.',
    schema: z.object({
      entityType: noteEntity,
      entityId: z.string().uuid(),
      content: z.string().min(1).max(5000),
    }),
    summarise: args => `Add a note to the ${args.entityType.toLowerCase()}`,
    async execute(args, ctx) {
      const note = await noteThreadService.create(
        {
          organizationId: ctx.organizationId,
          userId: ctx.actingUserId,
          canViewPrivate: ctx.permissions.has('notes:view_private'),
          canDeleteAny: ctx.permissions.has('notes:delete_any'),
        },
        args.entityType,
        args.entityId,
        // Signed, so nobody has to guess where a note came from.
        { content: `${args.content}\n\n— added by the Agentic Assistant` }
      );
      return { added: true, noteId: (note as { id: string }).id };
    },
  },

  {
    name: 'send_client_message',
    capability: 'messages.send',
    description:
      'Send one message to a client by email, SMS or WhatsApp. Keep it short, polite and specific. WhatsApp free-form replies are only possible within 24 hours of the client writing to you.',
    schema: z.object({
      clientId: z.string().uuid(),
      channel: z.enum(['EMAIL', 'SMS', 'WHATSAPP']),
      subject: z.string().max(300).optional().describe('Email only'),
      body: z.string().min(1).max(4000),
      loanId: z.string().uuid().optional().describe('The loan this is about, if any'),
    }),
    editableFields: ['subject', 'body', 'channel'],
    summarise: args => `Send a ${args.channel.toLowerCase()} message to a client`,
    async preview(args, ctx) {
      const options = await commsService.contactOptions(
        { organizationId: ctx.organizationId, userId: ctx.actingUserId },
        args.clientId
      );
      return { recipient: options, body: truncate(args.body, 1000) };
    },
    async execute(args, ctx) {
      const message = await commsService.sendToClient(
        { organizationId: ctx.organizationId, userId: ctx.actingUserId },
        args.clientId,
        {
          channel: args.channel,
          subject: args.subject ?? null,
          body: args.body,
          loanId: args.loanId ?? null,
        }
      );
      const sent = message as unknown as { id: string; status: string; toAddress: string };
      return { messageId: sent.id, status: sent.status, to: sent.toAddress };
    },
  },

  {
    name: 'send_reminder_batch',
    capability: 'messages.send',
    description:
      'Send the same reminder to a list of clients about their own instalment. Used by the payment-reminder automation; prefer send_client_message for a single client.',
    schema: z.object({
      subject: z.string().max(300).optional(),
      body: z.string().min(1).max(1000).describe('May use {{firstName}}, {{loanNumber}}, {{nextDueDate}}, {{nextDueAmount}}, {{organizationName}}'),
      items: z
        .array(
          z.object({
            clientId: z.string().uuid(),
            loanId: z.string().uuid(),
            channel: z.enum(['EMAIL', 'SMS']),
            /** Stops the same instalment being reminded about twice. */
            dedupeKey: z.string().max(200).optional(),
          })
        )
        .min(1)
        .max(200),
    }),
    editableFields: ['body', 'subject'],
    summarise: args => `Send ${args.items.length} payment reminder(s)`,
    async preview(args, ctx) {
      const clients = await prisma.client.findMany({
        where: { id: { in: args.items.slice(0, 10).map((item: { clientId: string }) => item.clientId) }, organizationId: ctx.organizationId },
        select: { id: true, firstName: true, lastName: true, businessName: true, clientNumber: true },
      });
      return {
        total: args.items.length,
        body: args.body,
        first: clients.map(client => ({ name: clientName(client), clientNumber: client.clientNumber })),
      };
    },
    async execute(args, ctx) {
      let sent = 0;
      let failed = 0;
      const failures: string[] = [];

      for (const item of args.items) {
        // Written down before sending: a crash halfway through must not send
        // the whole batch again on the next run.
        if (item.dedupeKey) {
          const claimed = await prisma.assistantOutreach
            .create({
              data: {
                organizationId: ctx.organizationId,
                loanId: item.loanId,
                clientId: item.clientId,
                channel: item.channel,
                dedupeKey: item.dedupeKey,
              },
            })
            .catch(() => null);
          if (!claimed) continue;
        }

        try {
          const message = await commsService.sendToClient(
            { organizationId: ctx.organizationId, userId: ctx.actingUserId },
            item.clientId,
            {
              channel: item.channel,
              subject: item.channel === 'EMAIL' ? (args.subject ?? 'Payment reminder') : null,
              body: args.body,
              loanId: item.loanId,
            }
          );
          const result = message as unknown as { id: string; status: string };
          if (item.dedupeKey) {
            await prisma.assistantOutreach
              .update({ where: { dedupeKey: item.dedupeKey }, data: { messageId: result.id } })
              .catch(() => undefined);
          }
          if (['FAILED', 'CANCELLED'].includes(result.status)) {
            failed += 1;
            failures.push(`${item.clientId}: ${result.status}`);
          } else {
            sent += 1;
          }
        } catch (error) {
          failed += 1;
          failures.push(`${item.clientId}: ${(error as Error).message}`);
        }
      }

      return { sent, failed, failures: failures.slice(0, 10) };
    },
  },

  {
    name: 'notify_staff',
    capability: 'staff.notify',
    description:
      'Put a notification in a colleague’s inbox inside the system - to flag work, an exception or something you have prepared.',
    schema: z.object({
      title: z.string().min(1).max(160),
      body: z.string().min(1).max(600),
      link: z.string().max(300).optional().describe('A path inside the system, for example /clients/<id>'),
      userIds: z.array(z.string().uuid()).optional().describe('Specific colleagues'),
      permission: z
        .string()
        .optional()
        .describe('Instead of naming people, notify everyone who holds this permission, e.g. loans:approve'),
      branchId: z.string().uuid().optional(),
    }),
    summarise: args => `Notify staff: ${args.title}`,
    async execute(args, ctx) {
      if (!args.userIds?.length && !args.permission) {
        throw new AssistantError('Say who to notify: either userIds or a permission.', 'INVALID_ARGUMENTS');
      }

      const link = args.link && args.link.startsWith('/') ? args.link : undefined;
      let sent = 0;

      if (args.userIds?.length) {
        const recipients = await prisma.user.findMany({
          where: { id: { in: args.userIds }, organizationId: ctx.organizationId, isActive: true },
          select: { id: true },
        });
        for (const recipient of recipients) {
          await inAppNotificationService.notify({
            organizationId: ctx.organizationId,
            recipientId: recipient.id,
            type: NOTIFICATION_TYPES.ASSISTANT_MESSAGE,
            title: args.title,
            body: args.body,
            link,
            resource: 'assistant_run',
            resourceId: ctx.runId,
          });
          sent += 1;
        }
      }

      if (args.permission) {
        sent += await inAppNotificationService.notifyPermissionHolders({
          organizationId: ctx.organizationId,
          permission: args.permission,
          type: NOTIFICATION_TYPES.ASSISTANT_MESSAGE,
          title: args.title,
          body: args.body,
          link,
          branchId: args.branchId ?? ctx.branchId,
          resource: 'assistant_run',
          resourceId: ctx.runId,
        });
      }

      return { notified: sent };
    },
  },

  {
    name: 'remember',
    capability: 'memory.write',
    description:
      'Remember a house rule or preference for later conversations - for example which branch to default to, or how reminders should be worded.',
    schema: z.object({
      content: z.string().min(3).max(500),
      scope: z.enum(['ORG', 'USER']).optional().describe('ORG for everyone, USER for just this person. Defaults to USER.'),
    }),
    summarise: args => `Remember: ${truncate(args.content, 80)}`,
    async execute(args, ctx) {
      if (!ctx.settings.memoryEnabled) {
        throw new AssistantError('Memory is switched off for this organization.', 'MEMORY_DISABLED');
      }
      const scope = args.scope ?? 'USER';
      const memory = await prisma.assistantMemory.create({
        data: {
          organizationId: ctx.organizationId,
          scope,
          userId: scope === 'USER' ? ctx.actingUserId : null,
          content: args.content,
          source: 'ASSISTANT',
          createdById: ctx.actingUserId,
        },
      });
      return { remembered: true, memoryId: memory.id, scope };
    },
  },
];

/**
 * File conversation attachments against a client.
 *
 * Shared by the attach tool and by client creation, which attaches whatever
 * was used to create the client in the same breath.
 */
export async function attachArtifactsToClient(
  ctx: ToolContext,
  clientId: string,
  artifactIds: string[],
  documentTypeName?: string
) {
  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (!client) throw new AssistantError('No client with that id in this organization.', 'NOT_FOUND', 404);

  const artifacts = await loadArtifacts(ctx, artifactIds);
  const types = await prisma.documentType.findMany({
    where: { organizationId: ctx.organizationId, isActive: true },
    select: { id: true, code: true, name: true },
  });
  if (types.length === 0) {
    throw new AssistantError(
      'This organization has no document types set up, so documents cannot be filed yet.',
      'NO_DOCUMENT_TYPES'
    );
  }

  const wanted = (documentTypeName ?? '').trim().toLowerCase();
  const matched =
    types.find(type => type.name.toLowerCase() === wanted || type.code.toLowerCase() === wanted) ??
    types.find(type => wanted && type.name.toLowerCase().includes(wanted)) ??
    types.find(type => type.code === 'OTHER') ??
    types[0]!;

  const filed: Array<{ documentId: string; fileName: string; type: string }> = [];
  for (const artifact of artifacts) {
    const file = await storageService.download(artifact.storagePath);
    const document = await documentService.uploadDocument(ctx.organizationId, {
      clientId,
      documentTypeId: matched.id,
      file,
      fileName: artifact.fileName,
      mimeType: artifact.mimeType,
      fileSize: file.length,
      notes: 'Filed by the Agentic Assistant',
    });
    filed.push({
      documentId: (document as { id: string }).id,
      fileName: artifact.fileName,
      type: matched.name,
    });
  }
  return filed;
}

/** Details of a client for a message the assistant is drafting. */
export function describeClientForMessage(client: {
  firstName?: string | null;
  lastName?: string | null;
  businessName?: string | null;
  nextDueDate?: Date | null;
}) {
  return { name: clientName(client), nextDueDate: isoDate(client.nextDueDate ?? null) };
}
