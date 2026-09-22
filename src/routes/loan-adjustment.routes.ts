/**
 * Loan Adjustment Routes
 * API endpoints for manual adjustments, writeoffs, and rescheduling
 */

import { Router } from 'express';
import { z } from 'zod';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware';
import { validateRequest, handleAsync } from '../middleware/validation.middleware';
import { loanAdjustmentService, AdjustmentType } from '../services/loan-adjustment.service';
import { prisma } from '../config/database';
import {
  requestWriteOff,
  reviewWriteOff,
  cancelWriteOffRequest,
  recordRecovery,
} from '../services/loan-writeoff-approval.service';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

/**
 * Create a manual adjustment
 * POST /api/loans/adjustments
 */
const createAdjustmentSchema = z.object({
  body: z.object({
    loanId: z.string().uuid('Invalid loan ID'),
    type: z.enum([
      'PRINCIPAL_INCREASE',
      'PRINCIPAL_DECREASE',
      'INTEREST_INCREASE',
      'INTEREST_DECREASE',
      'PENALTY_WAIVER',
      'INTEREST_WAIVER',
      'FEE_ADDITION',
      'FEE_WAIVER',
    ] as const),
    amount: z.number().positive('Amount must be positive'),
    reason: z.string().min(5, 'Reason must be at least 5 characters'),
    notes: z.string().optional(),
    effectiveDate: z.string().datetime().optional().transform((v) => v ? new Date(v) : undefined),
  }),
});

router.post(
  '/adjustments',
  requirePermission('loans:adjust'),
  validateRequest(createAdjustmentSchema),
  handleAsync(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const userId = req.user!.userId;

    const result = await loanAdjustmentService.createAdjustment(
      req.body,
      organizationId,
      userId
    );

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.error,
      });
    }

    res.status(201).json({
      success: true,
      data: result,
    });
  })
);

/**
 * Get adjustment history for a loan
 * GET /api/loans/:loanId/adjustments
 */
const adjustmentHistorySchema = z.object({
  params: z.object({
    loanId: z.string().uuid(),
  }),
});

router.get(
  '/:loanId/adjustments',
  requirePermission('loans:view'),
  validateRequest(adjustmentHistorySchema),
  handleAsync(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const loanId = req.params.loanId!;

    const adjustments = await loanAdjustmentService.getAdjustmentHistory(
      loanId,
      organizationId
    );

    res.json({
      success: true,
      data: adjustments,
    });
  })
);

/**
 * Writeoff a loan
 * POST /api/loans/writeoff
 */
const writeoffSchema = z.object({
  body: z.object({
    loanId: z.string().uuid('Invalid loan ID'),
    reason: z.string().min(5, 'Reason must be at least 5 characters'),
    writeoffType: z.enum(['FULL', 'PARTIAL']),
    amount: z.number().positive().optional(), // Required for partial
    notes: z.string().optional(),
    recoveryExpected: z.boolean().default(false),
    recoveryAmount: z.number().min(0).optional(),
  }).refine(
    (data) => data.writeoffType !== 'PARTIAL' || data.amount !== undefined,
    'Amount is required for partial writeoff'
  ),
});

/**
 * Ask for a loan to be written off.
 *
 * Writing off is not done directly. It removes a receivable from the books and
 * takes the loss to profit, so - like reversing a disbursement - one person
 * asks and a different person decides. The approval is what performs it.
 */
router.post(
  '/writeoff-requests',
  requirePermission('loans:writeoff:request'),
  validateRequest(writeoffSchema),
  handleAsync(async (req, res) => {
    try {
      const request = await requestWriteOff({
        ...req.body,
        organizationId: req.user!.organizationId!,
        requestedById: req.user!.userId,
      });
      res.status(201).json({
        success: true,
        message:
          'Write-off requested. Whoever may approve write-offs has been notified.',
        data: request,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message:
          error instanceof Error
            ? error.message
            : 'Could not request the write-off',
      });
    }
  })
);

/** Write-off requests, newest first. */
router.get(
  '/writeoff-requests',
  requirePermission('loans:view'),
  handleAsync(async (req, res) => {
    const status = (req.query.status as string) || undefined;

    const requests = await prisma.loanWriteOffRequest.findMany({
      where: {
        organizationId: req.user!.organizationId!,
        ...(status && status !== 'ALL' ? { status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        loan: {
          select: {
            id: true,
            loanNumber: true,
            currency: true,
            outstandingBalance: true,
            principalBalance: true,
            interestBalance: true,
            penaltyBalance: true,
            status: true,
            client: {
              select: { firstName: true, lastName: true, clientNumber: true },
            },
          },
        },
        requestedBy: { select: { firstName: true, lastName: true } },
        reviewedBy: { select: { firstName: true, lastName: true } },
      },
    });

    res.json({ success: true, data: requests });
  })
);

/** Approve or refuse one. Approving performs the write-off. */
const reviewWriteOffSchema = z.object({
  params: z.object({ requestId: z.string().uuid() }),
  body: z.object({
    decision: z.enum(['APPROVE', 'REJECT']),
    reviewNotes: z.string().max(500).optional(),
  }),
});

router.post(
  '/writeoff-requests/:requestId/review',
  requirePermission('loans:writeoff'),
  validateRequest(reviewWriteOffSchema),
  handleAsync(async (req, res) => {
    try {
      const request = await reviewWriteOff({
        requestId: req.params.requestId!,
        organizationId: req.user!.organizationId!,
        reviewedById: req.user!.userId,
        decision: req.body.decision,
        reviewNotes: req.body.reviewNotes,
      });
      res.json({ success: true, data: request });
    } catch (error) {
      res.status(400).json({
        success: false,
        message:
          error instanceof Error ? error.message : 'Could not review the request',
      });
    }
  })
);

/** Withdraw your own request before anybody has decided on it. */
router.post(
  '/writeoff-requests/:requestId/cancel',
  requirePermission('loans:writeoff:request'),
  handleAsync(async (req, res) => {
    try {
      const request = await cancelWriteOffRequest(
        req.params.requestId!,
        req.user!.organizationId!,
        req.user!.userId
      );
      res.json({ success: true, data: request });
    } catch (error) {
      res.status(400).json({
        success: false,
        message:
          error instanceof Error ? error.message : 'Could not withdraw the request',
      });
    }
  })
);

/** Record money collected on a loan that was already written off. */
const recoverySchema = z.object({
  params: z.object({ loanId: z.string().uuid() }),
  body: z.object({
    amount: z.number().positive('A recovery has to be for more than nothing'),
    paymentMethodId: z.string().uuid().optional(),
    reference: z.string().max(120).optional(),
    notes: z.string().max(500).optional(),
    recoveredAt: z.string().optional(),
  }),
});

router.post(
  '/:loanId/recoveries',
  requirePermission('loans:recover'),
  validateRequest(recoverySchema),
  handleAsync(async (req, res) => {
    try {
      const recovery = await recordRecovery({
        loanId: req.params.loanId!,
        organizationId: req.user!.organizationId!,
        recordedById: req.user!.userId,
        amount: req.body.amount,
        paymentMethodId: req.body.paymentMethodId,
        reference: req.body.reference,
        notes: req.body.notes,
        recoveredAt: req.body.recoveredAt
          ? new Date(req.body.recoveredAt)
          : undefined,
      });
      res.status(201).json({ success: true, data: recovery });
    } catch (error) {
      res.status(400).json({
        success: false,
        message:
          error instanceof Error ? error.message : 'Could not record the recovery',
      });
    }
  })
);

/** What has been collected on a written-off loan. */
router.get(
  '/:loanId/recoveries',
  requirePermission('loans:view'),
  handleAsync(async (req, res) => {
    const recoveries = await prisma.loanRecovery.findMany({
      where: {
        loanId: req.params.loanId!,
        organizationId: req.user!.organizationId!,
      },
      orderBy: { recoveredAt: 'desc' },
      include: {
        recordedBy: { select: { firstName: true, lastName: true } },
        paymentMethod: { select: { name: true } },
      },
    });

    res.json({ success: true, data: recoveries });
  })
);

/**
 * Get writeoff history
 * GET /api/loans/writeoffs
 */
const writeoffHistorySchema = z.object({
  query: z.object({
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    branchId: z.string().optional(),
  }),
});

router.get(
  '/writeoffs',
  requirePermission('loans:view'),
  validateRequest(writeoffHistorySchema),
  handleAsync(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const { startDate, endDate, branchId } = req.query;

    const writeoffs = await loanAdjustmentService.getWriteoffHistory(
      organizationId,
      {
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
        branchId: branchId as string | undefined,
      }
    );

    res.json({
      success: true,
      data: writeoffs,
    });
  })
);

/**
 * Reschedule a loan
 * POST /api/loans/reschedule
 */
const rescheduleSchema = z.object({
  body: z.object({
    loanId: z.string().uuid('Invalid loan ID'),
    newTerm: z.number().int().positive().max(120, 'Term cannot exceed 120 months'),
    newInterestRate: z.number().min(0).max(100).optional(),
    reason: z.string().min(5, 'Reason must be at least 5 characters'),
    newStartDate: z.string().datetime().optional().transform((v) => v ? new Date(v) : undefined),
    graceperiodMonths: z.number().int().min(0).max(12).optional(),
    notes: z.string().optional(),
  }),
});

router.post(
  '/reschedule',
  requirePermission('loans:reschedule'),
  validateRequest(rescheduleSchema),
  handleAsync(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const userId = req.user!.userId;

    const result = await loanAdjustmentService.rescheduleLoan(
      req.body,
      organizationId,
      userId
    );

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.error,
      });
    }

    res.json({
      success: true,
      data: result,
    });
  })
);

/**
 * Get reschedule history for a loan
 * GET /api/loans/:loanId/reschedules
 */
const rescheduleHistorySchema = z.object({
  params: z.object({
    loanId: z.string().uuid(),
  }),
});

router.get(
  '/:loanId/reschedules',
  requirePermission('loans:view'),
  validateRequest(rescheduleHistorySchema),
  handleAsync(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const loanId = req.params.loanId!;

    const reschedules = await loanAdjustmentService.getRescheduleHistory(
      loanId,
      organizationId
    );

    res.json({
      success: true,
      data: reschedules,
    });
  })
);

/**
 * Waive penalty for a loan
 * POST /api/loans/:loanId/waive-penalty
 */
const waivePenaltySchema = z.object({
  params: z.object({
    loanId: z.string().uuid(),
  }),
  body: z.object({
    amount: z.number().positive().optional(), // If not provided, waive all
    reason: z.string().min(5, 'Reason required'),
  }),
});

router.post(
  '/:loanId/waive-penalty',
  requirePermission('loans:adjust'),
  validateRequest(waivePenaltySchema),
  handleAsync(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const userId = req.user!.userId;
    const loanId = req.params.loanId!;
    const { amount, reason } = req.body;

    const result = await loanAdjustmentService.createAdjustment(
      {
        loanId,
        type: 'PENALTY_WAIVER' as AdjustmentType,
        amount: amount || 999999999, // Large number to waive all if not specified
        reason,
      },
      organizationId,
      userId
    );

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.error,
      });
    }

    res.json({
      success: true,
      data: result,
    });
  })
);

/**
 * Waive interest for a loan
 * POST /api/loans/:loanId/waive-interest
 */
const waiveInterestSchema = z.object({
  params: z.object({
    loanId: z.string().uuid(),
  }),
  body: z.object({
    amount: z.number().positive('Amount required'),
    reason: z.string().min(5, 'Reason required'),
  }),
});

router.post(
  '/:loanId/waive-interest',
  requirePermission('loans:adjust'),
  validateRequest(waiveInterestSchema),
  handleAsync(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const userId = req.user!.userId;
    const loanId = req.params.loanId!;
    const { amount, reason } = req.body;

    const result = await loanAdjustmentService.createAdjustment(
      {
        loanId,
        type: 'INTEREST_WAIVER' as AdjustmentType,
        amount,
        reason,
      },
      organizationId,
      userId
    );

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.error,
      });
    }

    res.json({
      success: true,
      data: result,
    });
  })
);

export default router;
