/**
 * Loan Adjustment Routes
 * API endpoints for manual adjustments, writeoffs, and rescheduling
 */

import { Router } from 'express';
import { z } from 'zod';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware';
import { validateRequest, handleAsync } from '../middleware/validation.middleware';
import { loanAdjustmentService, AdjustmentType } from '../services/loan-adjustment.service';

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
  requirePermission('loan:adjust'),
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
  requirePermission('loan:view'),
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

router.post(
  '/writeoff',
  requirePermission('loan:writeoff'),
  validateRequest(writeoffSchema),
  handleAsync(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const userId = req.user!.userId;

    const result = await loanAdjustmentService.writeoffLoan(
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
  requirePermission('loan:view'),
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
  requirePermission('loan:reschedule'),
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
  requirePermission('loan:view'),
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
  requirePermission('loan:adjust'),
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
  requirePermission('loan:adjust'),
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
