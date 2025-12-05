/**
 * Payment Enhancement Routes
 * API endpoints for advanced payment operations
 */

import { Router } from 'express';
import { z } from 'zod';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware';
import { validateRequest, handleAsync } from '../middleware/validation.middleware';
import { paymentEnhancementService, AllocationStrategy } from '../services/payment-enhancement.service';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

/**
 * Reverse a payment
 * POST /api/payments/reverse
 */
const reversePaymentSchema = z.object({
  body: z.object({
    paymentId: z.string().uuid('Invalid payment ID'),
    reason: z.string().min(5, 'Reason must be at least 5 characters'),
    notes: z.string().optional(),
  }),
});

router.post(
  '/reverse',
  requirePermission('payments:reverse'),
  validateRequest(reversePaymentSchema),
  handleAsync(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const userId = req.user!.userId;
    const { paymentId, reason, notes } = req.body;

    const result = await paymentEnhancementService.reversePayment(
      { paymentId, reason, notes },
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
 * Calculate payment allocation
 * POST /api/payments/calculate-allocation
 */
const calculateAllocationSchema = z.object({
  body: z.object({
    amount: z.number().positive('Amount must be positive'),
    penaltyBalance: z.number().min(0),
    interestBalance: z.number().min(0),
    principalBalance: z.number().min(0),
    strategy: z.enum([
      'PENALTY_INTEREST_PRINCIPAL',
      'PRINCIPAL_INTEREST_PENALTY',
      'PRO_RATA',
      'OLDEST_FIRST',
    ]).default('PENALTY_INTEREST_PRINCIPAL'),
  }),
});

router.post(
  '/calculate-allocation',
  requirePermission('payments:view'),
  validateRequest(calculateAllocationSchema),
  handleAsync(async (req, res) => {
    const { amount, penaltyBalance, interestBalance, principalBalance, strategy } = req.body;

    const allocation = paymentEnhancementService.allocatePaymentWithStrategy(
      amount,
      penaltyBalance,
      interestBalance,
      principalBalance,
      strategy as AllocationStrategy
    );

    res.json({
      success: true,
      data: {
        strategy,
        input: { amount, penaltyBalance, interestBalance, principalBalance },
        allocation,
      },
    });
  })
);

/**
 * Get branch payment summary
 * GET /api/payments/branch-summary/:branchId
 */
const branchSummarySchema = z.object({
  params: z.object({
    branchId: z.string().uuid(),
  }),
  query: z.object({
    startDate: z.string(),
    endDate: z.string(),
  }),
});

router.get(
  '/branch-summary/:branchId',
  requirePermission('payments:view'),
  validateRequest(branchSummarySchema),
  handleAsync(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const branchId = req.params.branchId!;
    const startDate = new Date(req.query.startDate as string);
    const endDate = new Date(req.query.endDate as string);

    const summary = await paymentEnhancementService.getBranchPaymentSummary(
      branchId,
      organizationId,
      startDate,
      endDate
    );

    if (!summary) {
      return res.status(404).json({
        success: false,
        message: 'Branch not found',
      });
    }

    res.json({
      success: true,
      data: summary,
    });
  })
);

/**
 * Get all branch payment summaries
 * GET /api/payments/branch-summaries
 */
const allBranchSummariesSchema = z.object({
  query: z.object({
    startDate: z.string(),
    endDate: z.string(),
  }),
});

router.get(
  '/branch-summaries',
  requirePermission('payments:view'),
  validateRequest(allBranchSummariesSchema),
  handleAsync(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const startDate = new Date(req.query.startDate as string);
    const endDate = new Date(req.query.endDate as string);

    const summaries = await paymentEnhancementService.getAllBranchPaymentSummaries(
      organizationId,
      startDate,
      endDate
    );

    res.json({
      success: true,
      data: summaries,
    });
  })
);

/**
 * Calculate early payoff amount
 * GET /api/payments/early-payoff/:loanId
 */
const earlyPayoffSchema = z.object({
  params: z.object({
    loanId: z.string().uuid(),
  }),
  query: z.object({
    payoffDate: z.string().optional(),
  }),
});

router.get(
  '/early-payoff/:loanId',
  requirePermission('payments:view'),
  validateRequest(earlyPayoffSchema),
  handleAsync(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const loanId = req.params.loanId!;
    const payoffDate = req.query.payoffDate
      ? new Date(req.query.payoffDate as string)
      : new Date();

    const payoff = await paymentEnhancementService.calculateEarlyPayoff(
      loanId,
      organizationId,
      payoffDate
    );

    if (!payoff) {
      return res.status(404).json({
        success: false,
        message: 'Loan not found or not eligible for early payoff',
      });
    }

    res.json({
      success: true,
      data: {
        loanId,
        payoffDate,
        ...payoff,
      },
    });
  })
);

/**
 * Process payroll payments for an employer
 * POST /api/payments/payroll
 */
const payrollPaymentsSchema = z.object({
  body: z.object({
    employerId: z.string().uuid('Invalid employer ID'),
    payments: z.array(
      z.object({
        clientId: z.string().uuid(),
        loanId: z.string().uuid(),
        amount: z.number().positive(),
        reference: z.string().optional(),
      })
    ).min(1, 'At least one payment required'),
  }),
});

router.post(
  '/payroll',
  requirePermission('payments:create'),
  validateRequest(payrollPaymentsSchema),
  handleAsync(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const userId = req.user!.userId;
    const { employerId, payments } = req.body;

    const result = await paymentEnhancementService.processPayrollPayments(
      employerId,
      organizationId,
      payments,
      userId
    );

    res.json({
      success: result.failed === 0,
      data: {
        processed: result.processed,
        failed: result.failed,
        totalAmount: result.totalAmount,
        results: result.results,
      },
    });
  })
);

export default router;
