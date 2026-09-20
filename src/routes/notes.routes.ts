/**
 * Discussion threads on clients and loans.
 *
 *   POST   /notes/counts                          message counts for a page of records
 *   GET    /notes/:entityType/:entityId           the thread, oldest first
 *   POST   /notes/:entityType/:entityId           post a message (multipart, with files)
 *   POST   /notes/:entityType/:entityId/read      mark the thread read
 *   GET    /notes/:entityType/:entityId/count     one record's counts
 *   PUT    /notes/:noteId                         change your own message
 *   PATCH  /notes/:noteId/toggle-pin              pin or unpin
 *   DELETE /notes/:noteId                         delete (own, or any with notes:delete_any)
 *
 * entityType is CLIENT or LOAN. The organization always comes from the
 * session, and the record is checked to belong to it.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { loadPermissions, requirePermission } from '../middleware/permissions';
import { handleAsync } from '../middleware/validation.middleware';
import { PERMISSIONS } from '../constants/permissions';
import { noteThreadService, type ThreadContext } from '../services/notes/note-thread.service';
import {
  MAX_ATTACHMENTS_PER_NOTE,
  MAX_ATTACHMENT_BYTES,
  MAX_NOTE_LENGTH,
  NOTE_PRIORITIES,
  NoteThreadError,
  THREAD_ENTITY_TYPES,
  type ThreadEntityType,
} from '../services/notes/note-thread.logic';

const router = Router();

router.use(authenticate, loadPermissions);

const now = () => new Date().toISOString();

const upload = multer({
  storage: multer.memoryStorage(),
  // One over the limits, so the service can refuse with a clear message
  // rather than multer cutting the request off mid-stream.
  limits: { fileSize: MAX_ATTACHMENT_BYTES + 1, files: MAX_ATTACHMENTS_PER_NOTE + 1 },
});

/** multer's own refusals, in the same shape as every other error here. */
const acceptFiles = (req: Request, res: Response, next: NextFunction) =>
  upload.array('files', MAX_ATTACHMENTS_PER_NOTE + 1)(req, res, error => {
    if (!error) return next();
    const message =
      error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE'
        ? `An attachment is larger than ${MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB.`
        : error instanceof multer.MulterError && error.code === 'LIMIT_FILE_COUNT'
          ? `A message can carry at most ${MAX_ATTACHMENTS_PER_NOTE} attachments.`
          : 'The attachments could not be read.';
    res.status(400).json({ success: false, message, error: 'INVALID_ATTACHMENT', timestamp: now() });
  });

function contextOf(req: Request, res: Response): ThreadContext | null {
  const user = req.user as unknown as { id?: string; userId?: string; organizationId?: string; permissions?: string[] };
  const userId = user?.id || user?.userId;
  if (!user?.organizationId || !userId) {
    res.status(400).json({
      success: false,
      message: 'Organization context required',
      error: 'MISSING_ORGANIZATION',
      timestamp: now(),
    });
    return null;
  }
  const permissions = new Set(user.permissions ?? []);
  return {
    organizationId: user.organizationId,
    userId,
    canViewPrivate: permissions.has(PERMISSIONS.NOTES_VIEW_PRIVATE),
    canDeleteAny: permissions.has(PERMISSIONS.NOTES_DELETE_ANY),
  };
}

type Handler = (req: Request, res: Response, ctx: ThreadContext) => Promise<unknown>;

const handle = (fn: Handler) =>
  handleAsync(async (req, res) => {
    const ctx = contextOf(req, res);
    if (!ctx) return;
    try {
      await fn(req, res, ctx);
    } catch (error) {
      if (error instanceof NoteThreadError) {
        res.status(error.httpStatus).json({
          success: false,
          message: error.message,
          error: error.code,
          timestamp: now(),
        });
        return;
      }
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          message: error.errors[0]?.message ?? 'Validation failed',
          error: 'VALIDATION_ERROR',
          details: error.errors.map(issue => ({ path: issue.path.join('.'), message: issue.message })),
          timestamp: now(),
        });
        return;
      }
      throw error;
    }
  });

const entityParams = z.object({
  entityType: z.enum(THREAD_ENTITY_TYPES, {
    errorMap: () => ({ message: 'Messages can be added to a CLIENT or a LOAN.' }),
  }),
  entityId: z.string().uuid('That is not a valid record id.'),
});
const noteParams = z.object({ noteId: z.string().uuid('That is not a valid message id.') });

/** Multipart sends everything as text. */
const formBoolean = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform(value => value === true || value === 'true');

const createBody = z.object({
  content: z.string().max(MAX_NOTE_LENGTH).optional(),
  priority: z.enum(NOTE_PRIORITIES).optional(),
  isPrivate: formBoolean.optional(),
});

const updateBody = z
  .object({
    content: z.string().max(MAX_NOTE_LENGTH).optional(),
    priority: z.enum(NOTE_PRIORITIES).optional(),
    isPrivate: z.boolean().optional(),
  })
  .strict();

// Registered before the /:entityType/:entityId routes it would otherwise match.
router.post(
  '/counts',
  requirePermission(PERMISSIONS.NOTES_VIEW),
  handle(async (req, res, ctx) => {
    const body = z
      .object({
        entityType: z.enum(THREAD_ENTITY_TYPES),
        entityIds: z.array(z.string().uuid()).max(500),
      })
      .parse(req.body);
    res.json({
      success: true,
      data: { counts: await noteThreadService.counts(ctx, body.entityType, body.entityIds) },
      timestamp: now(),
    });
  })
);

router.get(
  '/:entityType/:entityId',
  requirePermission(PERMISSIONS.NOTES_VIEW),
  handle(async (req, res, ctx) => {
    const { entityType, entityId } = entityParams.parse(req.params);
    res.json({
      success: true,
      data: await noteThreadService.list(ctx, entityType as ThreadEntityType, entityId),
      timestamp: now(),
    });
  })
);

router.post(
  '/:entityType/:entityId',
  requirePermission(PERMISSIONS.NOTES_CREATE),
  acceptFiles,
  handle(async (req, res, ctx) => {
    const { entityType, entityId } = entityParams.parse(req.params);
    const body = createBody.parse(req.body ?? {});
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    const note = await noteThreadService.create(ctx, entityType, entityId, body, files);
    res.status(201).json({ success: true, message: 'Message sent', data: { note }, timestamp: now() });
  })
);

router.post(
  '/:entityType/:entityId/read',
  requirePermission(PERMISSIONS.NOTES_VIEW),
  handle(async (req, res, ctx) => {
    const { entityType, entityId } = entityParams.parse(req.params);
    await noteThreadService.resolveEntity(ctx.organizationId, entityType, entityId);
    await noteThreadService.markRead(ctx, entityType, entityId);
    res.json({ success: true, timestamp: now() });
  })
);

router.get(
  '/:entityType/:entityId/count',
  requirePermission(PERMISSIONS.NOTES_VIEW),
  handle(async (req, res, ctx) => {
    const { entityType, entityId } = entityParams.parse(req.params);
    const counts = await noteThreadService.counts(ctx, entityType, [entityId]);
    const count = counts[entityId] ?? { total: 0, unread: 0 };
    res.json({ success: true, data: { count: count.total, unread: count.unread }, timestamp: now() });
  })
);

router.put(
  '/:noteId',
  requirePermission(PERMISSIONS.NOTES_UPDATE),
  handle(async (req, res, ctx) => {
    const { noteId } = noteParams.parse(req.params);
    const note = await noteThreadService.update(ctx, noteId, updateBody.parse(req.body ?? {}));
    res.json({ success: true, message: 'Message updated', data: { note }, timestamp: now() });
  })
);

router.patch(
  '/:noteId/toggle-pin',
  requirePermission(PERMISSIONS.NOTES_UPDATE),
  handle(async (req, res, ctx) => {
    const { noteId } = noteParams.parse(req.params);
    const note = await noteThreadService.togglePin(ctx, noteId);
    res.json({
      success: true,
      message: note.isPinned ? 'Message pinned' : 'Message unpinned',
      data: { note },
      timestamp: now(),
    });
  })
);

router.delete(
  '/:noteId',
  requirePermission(PERMISSIONS.NOTES_DELETE),
  handle(async (req, res, ctx) => {
    const { noteId } = noteParams.parse(req.params);
    await noteThreadService.remove(ctx, noteId);
    res.json({ success: true, message: 'Message deleted', timestamp: now() });
  })
);

export default router;
