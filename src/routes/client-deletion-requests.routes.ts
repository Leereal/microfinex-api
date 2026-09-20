/**
 * Client deletion request routes.
 *
 * Raising a request and approving one are different permissions on purpose:
 * `clients:delete:request` asks, `clients:delete` carries it out.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';

import { authenticate } from '../middleware/auth-supabase';
import { requirePermission } from '../middleware/permissions';
import { validateRequest, validateQuery } from '../middleware/validation';
import {
  DeletionBlockedError,
  DeletionRequestError,
  REQUEST_STATUS,
  clientDeletionRequestService,
  createDeletionRequestSchema,
  reviewDeletionRequestSchema,
  type RequestStatus,
} from '../services/client-deletion-request.service';

const router = Router();

router.use(authenticate);

const listQuerySchema = z.object({
  status: z
    .enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'])
    .optional(),
  page: z
    .string()
    .transform(value => parseInt(value) || 1)
    .optional(),
  limit: z
    .string()
    .transform(value => Math.min(parseInt(value) || 20, 100))
    .optional(),
});

const idParamSchema = z.string().uuid();

/** Everything a handler needs about who is acting. */
const actorFrom = (req: Request) => ({
  userId: req.userContext?.id as string,
  organizationId: req.userContext?.organizationId as string,
  ipAddress: req.ip,
  userAgent: req.get('user-agent') ?? undefined,
});

const requireOrganization = (
  req: Request,
  res: Response
): { userId: string; organizationId: string } | null => {
  const actor = actorFrom(req);
  if (!actor.organizationId || !actor.userId) {
    res.status(400).json({
      success: false,
      message: 'Organization context required',
      error: 'MISSING_ORGANIZATION',
      timestamp: new Date().toISOString(),
    });
    return null;
  }
  return actor as { userId: string; organizationId: string };
};

/** Map a service error onto a response the frontend can act on. */
const sendServiceError = (res: Response, error: unknown) => {
  if (error instanceof DeletionBlockedError) {
    return res.status(409).json({
      success: false,
      message: error.message,
      error: 'DELETION_BLOCKED',
      blockers: error.blockers,
      timestamp: new Date().toISOString(),
    });
  }

  if (error instanceof DeletionRequestError) {
    const status = error.code.endsWith('NOT_FOUND')
      ? 404
      : error.code === 'NOT_REQUESTER'
        ? 403
        : 409;
    return res.status(status).json({
      success: false,
      message: error.message,
      error: error.code,
      timestamp: new Date().toISOString(),
    });
  }

  console.error('[ClientDeletionRequests]', error);
  return res.status(500).json({
    success: false,
    message: 'Something went wrong handling the deletion request',
    error: 'INTERNAL_ERROR',
    timestamp: new Date().toISOString(),
  });
};

/**
 * GET /api/v1/client-deletion-requests
 * Visible to anyone who can raise or approve one, so a requester can follow
 * what happened to theirs.
 */
router.get(
  '/',
  requirePermission('clients:view'),
  validateQuery(listQuerySchema),
  async (req: Request, res: Response) => {
    const actor = requireOrganization(req, res);
    if (!actor) return;

    try {
      const query = req.query as unknown as {
        status?: RequestStatus;
        page?: number;
        limit?: number;
      };
      const result = await clientDeletionRequestService.list(
        actor.organizationId,
        query
      );

      return res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return sendServiceError(res, error);
    }
  }
);

/**
 * GET /api/v1/client-deletion-requests/pending-count
 * Drives the badge next to the Deletion Requests link.
 */
router.get(
  '/pending-count',
  requirePermission('clients:view'),
  async (req: Request, res: Response) => {
    const actor = requireOrganization(req, res);
    if (!actor) return;

    try {
      const { pendingCount } = await clientDeletionRequestService.list(
        actor.organizationId,
        { status: REQUEST_STATUS.PENDING, limit: 1 }
      );

      return res.json({
        success: true,
        data: { pendingCount },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return sendServiceError(res, error);
    }
  }
);

/**
 * POST /api/v1/client-deletion-requests/clients/:clientId
 * Ask for a client to be deleted.
 */
router.post(
  '/clients/:clientId',
  requirePermission('clients:delete:request'),
  validateRequest(createDeletionRequestSchema),
  async (req: Request, res: Response) => {
    const actor = requireOrganization(req, res);
    if (!actor) return;

    const clientId = idParamSchema.safeParse(req.params.clientId);
    if (!clientId.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid client id',
        error: 'INVALID_CLIENT_ID',
        timestamp: new Date().toISOString(),
      });
    }

    try {
      const { request, alreadyPending } =
        await clientDeletionRequestService.create(
          clientId.data,
          req.body.reason,
          actorFrom(req)
        );

      return res.status(alreadyPending ? 200 : 201).json({
        success: true,
        message: alreadyPending
          ? 'This client is already awaiting a deletion decision'
          : 'Deletion request sent for approval',
        data: { request, alreadyPending },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return sendServiceError(res, error);
    }
  }
);

/**
 * GET /api/v1/client-deletion-requests/:id
 */
router.get(
  '/:id',
  requirePermission('clients:view'),
  async (req: Request, res: Response) => {
    const actor = requireOrganization(req, res);
    if (!actor) return;

    try {
      const request = await clientDeletionRequestService.findById(
        req.params.id as string,
        actor.organizationId
      );

      if (!request) {
        return res.status(404).json({
          success: false,
          message: 'Deletion request not found',
          error: 'REQUEST_NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      return res.json({
        success: true,
        data: { request },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return sendServiceError(res, error);
    }
  }
);

/**
 * POST /api/v1/client-deletion-requests/:id/approve
 * Deletes the client outright - refused while they still have loans or group
 * memberships, which the response names.
 */
router.post(
  '/:id/approve',
  requirePermission('clients:delete'),
  validateRequest(reviewDeletionRequestSchema),
  async (req: Request, res: Response) => {
    const actor = requireOrganization(req, res);
    if (!actor) return;

    try {
      const request = await clientDeletionRequestService.approve(
        req.params.id as string,
        actorFrom(req)
      );

      return res.json({
        success: true,
        message: 'Client deleted',
        data: { request },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return sendServiceError(res, error);
    }
  }
);

/**
 * POST /api/v1/client-deletion-requests/:id/reject
 */
router.post(
  '/:id/reject',
  requirePermission('clients:delete'),
  validateRequest(reviewDeletionRequestSchema),
  async (req: Request, res: Response) => {
    const actor = requireOrganization(req, res);
    if (!actor) return;

    try {
      const request = await clientDeletionRequestService.reject(
        req.params.id as string,
        req.body.reviewNotes,
        actorFrom(req)
      );

      return res.json({
        success: true,
        message: 'Deletion request declined',
        data: { request },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return sendServiceError(res, error);
    }
  }
);

/**
 * POST /api/v1/client-deletion-requests/:id/cancel
 * Withdraw your own request.
 */
router.post(
  '/:id/cancel',
  requirePermission('clients:delete:request'),
  async (req: Request, res: Response) => {
    const actor = requireOrganization(req, res);
    if (!actor) return;

    try {
      const request = await clientDeletionRequestService.cancel(
        req.params.id as string,
        actorFrom(req)
      );

      return res.json({
        success: true,
        message: 'Deletion request withdrawn',
        data: { request },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return sendServiceError(res, error);
    }
  }
);

export default router;
