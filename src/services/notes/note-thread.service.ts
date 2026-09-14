/**
 * Discussion threads on clients and loans.
 *
 * Staff discuss a client or a loan in one thread per record: messages in the
 * order they were written, with attachments, pins, edits marked as edits and
 * deletions that leave a trace. List screens show how many messages each
 * record has and how many the viewer has not read.
 *
 * The rules live in note-thread.logic.ts; this file talks to the database,
 * storage and notifications.
 */

import { randomUUID } from 'crypto';
import { NoteEntityType, NotePriority, Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { storageService } from '../storage.service';
import { createAuditLog } from '../audit.service';
import {
  inAppNotificationService,
  NOTIFICATION_TYPES,
} from '../in-app-notification.service';
import {
  NoteThreadError,
  normaliseContent,
  notificationRecipients,
  presentNote,
  previewText,
  safeFileName,
  validateAttachments,
  visibleTo,
  type StoredNote,
  type ThreadEntityType,
  type Viewer,
} from './note-thread.logic';

export interface ThreadContext extends Viewer {
  organizationId: string;
}

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface ThreadEntity {
  label: string;
  link: string;
  /** People the record belongs to, told about new messages. */
  ownerIds: string[];
  storageFolder: 'clients' | 'loans';
}

const NOTE_INCLUDE = {
  creator: { select: { id: true, firstName: true, lastName: true, avatar: true } },
  attachments: {
    select: {
      id: true,
      fileName: true,
      fileSize: true,
      mimeType: true,
      uploadedAt: true,
      storagePath: true,
    },
    orderBy: { uploadedAt: 'asc' as const },
  },
} satisfies Prisma.NoteInclude;

type LoadedNote = Prisma.NoteGetPayload<{ include: typeof NOTE_INCLUDE }>;

/** Links in a thread are short-lived; the thread is re-read to renew them. */
const ATTACHMENT_URL_SECONDS = 60 * 60;

const personName = (first?: string | null, last?: string | null) =>
  [first, last].filter(Boolean).join(' ').trim();

export class NoteThreadService {
  /**
   * The record a thread belongs to - which must exist in the caller's
   * organization. A client or loan in another organization is "not found",
   * never revealed.
   */
  async resolveEntity(
    organizationId: string,
    entityType: ThreadEntityType,
    entityId: string
  ): Promise<ThreadEntity> {
    if (entityType === 'CLIENT') {
      const client = await prisma.client.findFirst({
        where: { id: entityId, organizationId },
        select: {
          id: true,
          clientNumber: true,
          firstName: true,
          lastName: true,
          businessName: true,
          createdBy: true,
        },
      });
      if (!client) throw new NoteThreadError('Client not found.', 'NOT_FOUND', 404);
      const name =
        client.businessName || personName(client.firstName, client.lastName) || 'Client';
      return {
        label: `${name} (${client.clientNumber})`,
        link: `/clients/${client.id}?tab=notes`,
        ownerIds: [client.createdBy],
        storageFolder: 'clients',
      };
    }

    const loan = await prisma.loan.findFirst({
      where: { id: entityId, organizationId },
      select: {
        id: true,
        loanNumber: true,
        loanOfficerId: true,
        client: { select: { firstName: true, lastName: true, businessName: true } },
      },
    });
    if (!loan) throw new NoteThreadError('Loan not found.', 'NOT_FOUND', 404);
    const clientName =
      loan.client?.businessName || personName(loan.client?.firstName, loan.client?.lastName);
    return {
      label: `Loan ${loan.loanNumber}${clientName ? ` · ${clientName}` : ''}`,
      link: `/loans/${loan.id}?notes=open`,
      ownerIds: [loan.loanOfficerId],
      storageFolder: 'loans',
    };
  }

  private async signAttachments(notes: LoadedNote[]) {
    const urls = new Map<string, { url: string | null; downloadUrl: string | null }>();
    const all = notes.flatMap(note => note.attachments);
    await Promise.all(
      all.map(async attachment => {
        try {
          const [url, downloadUrl] = await Promise.all([
            storageService.getSignedUrl(attachment.storagePath, ATTACHMENT_URL_SECONDS),
            storageService.getSignedUrl(
              attachment.storagePath,
              ATTACHMENT_URL_SECONDS,
              attachment.fileName
            ),
          ]);
          urls.set(attachment.id, { url, downloadUrl });
        } catch (error) {
          // The thread still reads without the file; the file shows as unavailable.
          console.error('Note attachment link failed:', (error as Error).message);
          urls.set(attachment.id, { url: null, downloadUrl: null });
        }
      })
    );
    return urls;
  }

  private async present(ctx: ThreadContext, notes: LoadedNote[]) {
    const urls = await this.signAttachments(notes.filter(note => !note.deletedAt));
    return notes.map(note => presentNote(note, ctx, urls));
  }

  /** The thread, oldest first, as a conversation reads. */
  async list(ctx: ThreadContext, entityType: ThreadEntityType, entityId: string) {
    const entity = await this.resolveEntity(ctx.organizationId, entityType, entityId);

    const [notes, marker] = await Promise.all([
      prisma.note.findMany({
        where: {
          organizationId: ctx.organizationId,
          entityType: entityType as NoteEntityType,
          entityId,
          ...visibleTo(ctx),
        },
        include: NOTE_INCLUDE,
        orderBy: { createdAt: 'asc' },
      }),
      prisma.noteReadMarker.findUnique({
        where: {
          userId_entityType_entityId: {
            userId: ctx.userId,
            entityType: entityType as NoteEntityType,
            entityId,
          },
        },
        select: { lastReadAt: true },
      }),
    ]);

    return {
      entity: { type: entityType, id: entityId, label: entity.label },
      lastReadAt: marker?.lastReadAt ?? null,
      notes: await this.present(ctx, notes),
    };
  }

  async create(
    ctx: ThreadContext,
    entityType: ThreadEntityType,
    entityId: string,
    input: { content?: string; priority?: NotePriority; isPrivate?: boolean },
    files: UploadedFile[] = []
  ) {
    validateAttachments(files);
    const content = normaliseContent(input.content, files.length);
    const entity = await this.resolveEntity(ctx.organizationId, entityType, entityId);

    // Files go to storage first, under the message's id; if saving the
    // message then fails, they are removed again rather than left orphaned.
    const noteId = randomUUID();
    const uploaded: Array<{ fileName: string; fileSize: number; mimeType: string; storagePath: string }> = [];
    try {
      for (const file of files) {
        const result = await storageService.upload(
          file.buffer,
          file.originalname,
          file.mimetype,
          file.size,
          {
            organizationId: ctx.organizationId,
            entityType: entity.storageFolder,
            entityId,
            fileType: 'NOTE_ATTACHMENT',
            subEntityId: noteId,
          }
        );
        uploaded.push({
          fileName: safeFileName(file.originalname),
          fileSize: file.size,
          mimeType: file.mimetype,
          storagePath: result.path,
        });
      }
    } catch (error) {
      await storageService.deleteMany(uploaded.map(item => item.storagePath)).catch(() => undefined);
      console.error('Note attachment upload failed:', (error as Error).message);
      throw new NoteThreadError(
        'The attachment could not be uploaded. Try again shortly.',
        'UPLOAD_FAILED',
        502
      );
    }

    let note;
    try {
      note = await prisma.note.create({
        data: {
          id: noteId,
          organizationId: ctx.organizationId,
          entityType: entityType as NoteEntityType,
          entityId,
          content,
          priority: input.priority ?? 'NORMAL',
          isPrivate: input.isPrivate ?? false,
          createdBy: ctx.userId,
          attachments: {
            create: uploaded.map(item => ({ ...item, uploadedBy: ctx.userId })),
          },
        },
        include: NOTE_INCLUDE,
      });
    } catch (error) {
      await storageService.deleteMany(uploaded.map(item => item.storagePath)).catch(() => undefined);
      throw error;
    }

    // The author has read their own message.
    await this.markRead(ctx, entityType, entityId, note.createdAt).catch(() => undefined);

    void this.notify(ctx, entityType, entityId, entity, note).catch(error =>
      console.error('Note notification failed:', (error as Error).message)
    );

    const [presented] = await this.present(ctx, [note]);
    return presented!;
  }

  private async notify(
    ctx: ThreadContext,
    entityType: ThreadEntityType,
    entityId: string,
    entity: ThreadEntity,
    note: StoredNote
  ) {
    const participants = await prisma.note.findMany({
      where: {
        organizationId: ctx.organizationId,
        entityType: entityType as NoteEntityType,
        entityId,
        deletedAt: null,
        isPrivate: false,
      },
      distinct: ['createdBy'],
      select: { createdBy: true },
    });

    const recipients = notificationRecipients({
      authorId: ctx.userId,
      isPrivate: note.isPrivate,
      participantIds: participants.map(row => row.createdBy),
      ownerIds: entity.ownerIds,
    });
    if (recipients.length === 0) return;

    // Only active people in this organization are told.
    const active = await prisma.user.findMany({
      where: { id: { in: recipients }, organizationId: ctx.organizationId, isActive: true },
      select: { id: true },
    });

    const author = personName(note.creator.firstName, note.creator.lastName) || 'A colleague';
    await Promise.all(
      active.map(user =>
        inAppNotificationService.notify({
          organizationId: ctx.organizationId,
          recipientId: user.id,
          type: NOTIFICATION_TYPES.NOTE_ADDED,
          title: `${author} on ${entity.label}`,
          body: previewText(note.content, note.attachments.length),
          link: entity.link,
          resource: entityType === 'LOAN' ? 'loan' : 'client',
          resourceId: entityId,
        })
      )
    );
  }

  private async findVisible(ctx: ThreadContext, noteId: string) {
    const note = await prisma.note.findFirst({
      where: { id: noteId, organizationId: ctx.organizationId, ...visibleTo(ctx) },
      include: NOTE_INCLUDE,
    });
    if (!note) throw new NoteThreadError('Message not found.', 'NOT_FOUND', 404);
    return note;
  }

  /**
   * Change a message's words or flags. Only its author can change the words:
   * a thread where one person can rewrite what another said is not a record.
   */
  async update(
    ctx: ThreadContext,
    noteId: string,
    input: { content?: string; priority?: NotePriority; isPrivate?: boolean }
  ) {
    const note = await this.findVisible(ctx, noteId);
    if (note.deletedAt) {
      throw new NoteThreadError('A deleted message cannot be changed.', 'NOTE_DELETED', 409);
    }
    if (note.createdBy !== ctx.userId) {
      throw new NoteThreadError('You can only change your own messages.', 'FORBIDDEN', 403);
    }

    const data: Prisma.NoteUpdateInput = {};
    if (input.content !== undefined) {
      const content = normaliseContent(input.content, note.attachments.length);
      if (content !== note.content) {
        data.content = content;
        data.editedAt = new Date();
      }
    }
    if (input.priority !== undefined) data.priority = input.priority;
    if (input.isPrivate !== undefined) data.isPrivate = input.isPrivate;

    const updated = await prisma.note.update({
      where: { id: note.id },
      data,
      include: NOTE_INCLUDE,
    });

    if (data.content !== undefined) {
      await createAuditLog({
        action: 'UPDATE',
        resource: 'note',
        resourceId: note.id,
        userId: ctx.userId,
        organizationId: ctx.organizationId,
        previousValue: { content: note.content },
        newValue: { content: updated.content },
      }).catch(() => undefined);
    }

    const [presented] = await this.present(ctx, [updated]);
    return presented!;
  }

  /** Pin a message to the top of the thread, or unpin it. */
  async togglePin(ctx: ThreadContext, noteId: string) {
    const note = await this.findVisible(ctx, noteId);
    if (note.deletedAt) {
      throw new NoteThreadError('A deleted message cannot be pinned.', 'NOTE_DELETED', 409);
    }
    const updated = await prisma.note.update({
      where: { id: note.id },
      data: { isPinned: !note.isPinned },
      include: NOTE_INCLUDE,
    });
    const [presented] = await this.present(ctx, [updated]);
    return presented!;
  }

  /**
   * Delete a message: hidden from the thread, kept on record, its files
   * removed from storage.
   */
  async remove(ctx: ThreadContext, noteId: string) {
    const note = await this.findVisible(ctx, noteId);
    if (note.deletedAt) return;
    if (note.createdBy !== ctx.userId && !ctx.canDeleteAny) {
      throw new NoteThreadError('You can only delete your own messages.', 'FORBIDDEN', 403);
    }

    await prisma.$transaction([
      prisma.note.update({
        where: { id: note.id },
        data: { deletedAt: new Date(), deletedBy: ctx.userId, isPinned: false },
      }),
      prisma.noteAttachment.deleteMany({ where: { noteId: note.id } }),
    ]);

    await storageService
      .deleteMany(note.attachments.map(attachment => attachment.storagePath))
      .catch(error =>
        console.error('Note attachment removal failed:', (error as Error).message)
      );

    await createAuditLog({
      action: 'DELETE',
      resource: 'note',
      resourceId: note.id,
      userId: ctx.userId,
      organizationId: ctx.organizationId,
      previousValue: {
        entityType: note.entityType,
        entityId: note.entityId,
        author: note.createdBy,
        content: note.content,
        attachments: note.attachments.map(attachment => attachment.fileName),
      },
    }).catch(() => undefined);
  }

  /** Record that the viewer has read the thread up to now. */
  async markRead(
    ctx: ThreadContext,
    entityType: ThreadEntityType,
    entityId: string,
    at: Date = new Date()
  ) {
    await prisma.noteReadMarker.upsert({
      where: {
        userId_entityType_entityId: {
          userId: ctx.userId,
          entityType: entityType as NoteEntityType,
          entityId,
        },
      },
      create: {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        entityType: entityType as NoteEntityType,
        entityId,
        lastReadAt: at,
      },
      update: { lastReadAt: at },
    });
  }

  /**
   * Message counts for a page of records, in one query.
   *
   * `total` is every message the viewer may see; `unread` is those written by
   * someone else since the viewer last opened the thread. Records with no
   * messages are simply absent.
   */
  async counts(ctx: ThreadContext, entityType: ThreadEntityType, entityIds: string[]) {
    const ids = [...new Set(entityIds)];
    if (ids.length === 0) return {};

    const rows = await prisma.$queryRaw<Array<{ entityId: string; total: number; unread: number }>>`
      SELECT n."entityId",
             COUNT(*)::int AS total,
             COUNT(*) FILTER (
               WHERE n."createdBy" <> ${ctx.userId}
                 AND (m."lastReadAt" IS NULL OR n."createdAt" > m."lastReadAt")
             )::int AS unread
        FROM "notes" n
        LEFT JOIN "note_read_markers" m
               ON m."userId" = ${ctx.userId}
              AND m."entityType" = n."entityType"
              AND m."entityId" = n."entityId"
       WHERE n."organizationId" = ${ctx.organizationId}
         AND n."entityType" = ${entityType}::"NoteEntityType"
         AND n."entityId" = ANY(${ids})
         AND n."deletedAt" IS NULL
         AND (n."isPrivate" = false OR n."createdBy" = ${ctx.userId} OR ${ctx.canViewPrivate})
       GROUP BY n."entityId"`;

    return Object.fromEntries(
      rows.map(row => [row.entityId, { total: Number(row.total), unread: Number(row.unread) }])
    ) as Record<string, { total: number; unread: number }>;
  }
}

export const noteThreadService = new NoteThreadService();
