/**
 * The signed-in user's notification inbox - what the bell in the header shows.
 *
 * Every route is scoped to the caller: there is no way to read or clear someone
 * else's notifications, and no permission gates them, because a notification is
 * only ever addressed to the person reading it.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';

import { authenticate } from '../middleware/auth-supabase';
import { validateQuery } from '../middleware/validation';
import { inAppNotificationService } from '../services/in-app-notification.service';

const router = Router();

router.use(authenticate);

const listQuerySchema = z.object({
  unreadOnly: z
    .string()
    .transform(value => value === 'true')
    .optional(),
  limit: z
    .string()
    .transform(value => Math.min(parseInt(value) || 20, 100))
    .optional(),
  before: z.string().datetime().optional(),
});

const requireUser = (req: Request, res: Response): string | null => {
  const userId = req.userContext?.id;
  if (!userId) {
    res.status(401).json({
      success: false,
      message: 'Authentication required',
      error: 'UNAUTHORIZED',
      timestamp: new Date().toISOString(),
    });
    return null;
  }
  return userId;
};

const fail = (res: Response, error: unknown) => {
  console.error('[Inbox]', error);
  return res.status(500).json({
    success: false,
    message: 'Could not load notifications',
    error: 'INTERNAL_ERROR',
    timestamp: new Date().toISOString(),
  });
};

/**
 * GET /api/v1/inbox/notifications
 */
router.get(
  '/notifications',
  validateQuery(listQuerySchema),
  async (req: Request, res: Response) => {
    const userId = requireUser(req, res);
    if (!userId) return;

    try {
      const query = req.query as unknown as {
        unreadOnly?: boolean;
        limit?: number;
        before?: string;
      };

      const result = await inAppNotificationService.list(userId, {
        unreadOnly: query.unreadOnly,
        limit: query.limit,
        before: query.before ? new Date(query.before) : undefined,
      });

      return res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return fail(res, error);
    }
  }
);

/**
 * GET /api/v1/inbox/notifications/unread-count
 * Polled by the bell, so it stays deliberately cheap.
 */
router.get('/notifications/unread-count', async (req: Request, res: Response) => {
  const userId = requireUser(req, res);
  if (!userId) return;

  try {
    const unreadCount = await inAppNotificationService.unreadCount(userId);
    return res.json({
      success: true,
      data: { unreadCount },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return fail(res, error);
  }
});

/**
 * POST /api/v1/inbox/notifications/:id/read
 */
router.post('/notifications/:id/read', async (req: Request, res: Response) => {
  const userId = requireUser(req, res);
  if (!userId) return;

  try {
    const updated = await inAppNotificationService.markRead(
      req.params.id as string,
      userId
    );

    return res.json({
      success: true,
      // Already-read is not a failure - the bell may fire this twice.
      data: { updated },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return fail(res, error);
  }
});

/**
 * POST /api/v1/inbox/notifications/read-all
 */
router.post('/notifications/read-all', async (req: Request, res: Response) => {
  const userId = requireUser(req, res);
  if (!userId) return;

  try {
    const count = await inAppNotificationService.markAllRead(userId);
    return res.json({
      success: true,
      data: { count },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return fail(res, error);
  }
});

export default router;
