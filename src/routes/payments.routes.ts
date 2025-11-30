import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth-supabase';
import { validateRequest, validateQuery } from '../middleware/validation';
import { UserRole } from '../types';
import {
  paymentService,
  createPaymentSchema,
  bulkPaymentSchema,
  reversePaymentSchema,
} from '../services/payment.service';

const router = Router();

// Query validation schemas
const paymentQuerySchema = z.object({
  loanId: z.string().uuid().optional(),
  status: z
    .enum(['PENDING', 'COMPLETED', 'FAILED', 'CANCELLED', 'REFUNDED'])
    .optional(),
  method: z
    .enum(['CASH', 'BANK_TRANSFER', 'MOBILE_MONEY', 'CHECK', 'CARD'])
    .optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  page: z
    .string()
    .transform(val => parseInt(val) || 1)
    .optional(),
  limit: z
    .string()
    .transform(val => Math.min(parseInt(val) || 10, 100))
    .optional(),
});

/**
 * @swagger
 * /api/v1/payments:
 *   post:
 *     summary: Process loan payment
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/',
  authenticate,
  authorize(UserRole.MANAGER, UserRole.STAFF),
  validateRequest(createPaymentSchema),
  async (req, res) => {
    try {
      const organizationId = req.userContext?.organizationId;
      const receivedBy = req.userContext?.id;

      if (!organizationId || !receivedBy) {
        return res.status(400).json({
          success: false,
          message: 'Organization ID and user ID required',
          error: 'MISSING_CONTEXT',
          timestamp: new Date().toISOString(),
        });
      }

      const payment = await paymentService.processPayment(
        req.body,
        organizationId,
        receivedBy
      );

      res.status(201).json({
        success: true,
        message: 'Payment processed successfully',
        data: { payment },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Process payment error:', error);
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        error: 'PAYMENT_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/payments/bulk:
 *   post:
 *     summary: Process multiple payments
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/bulk',
  authenticate,
  authorize(UserRole.MANAGER, UserRole.ADMIN),
  validateRequest(bulkPaymentSchema),
  async (req, res) => {
    try {
      const organizationId = req.userContext?.organizationId;
      const receivedBy = req.userContext?.id;

      if (!organizationId || !receivedBy) {
        return res.status(400).json({
          success: false,
          message: 'Organization ID and user ID required',
          error: 'MISSING_CONTEXT',
          timestamp: new Date().toISOString(),
        });
      }

      const result = await paymentService.processBulkPayments(
        req.body,
        organizationId,
        receivedBy
      );

      res.json({
        success: true,
        message: 'Bulk payments processed',
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Bulk payment error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/payments/{paymentId}/reverse:
 *   post:
 *     summary: Reverse a payment
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/:paymentId/reverse',
  authenticate,
  authorize(UserRole.MANAGER, UserRole.ADMIN),
  validateRequest(reversePaymentSchema),
  async (req, res) => {
    try {
      const paymentId = req.params.paymentId!;
      const organizationId = req.userContext?.organizationId;
      const reversedBy = req.userContext?.id;

      if (!organizationId || !reversedBy) {
        return res.status(400).json({
          success: false,
          message: 'Organization ID and user ID required',
          error: 'MISSING_CONTEXT',
          timestamp: new Date().toISOString(),
        });
      }

      const payment = await paymentService.reversePayment(
        paymentId!,
        req.body,
        organizationId!,
        reversedBy!
      );

      res.json({
        success: true,
        message: 'Payment reversed successfully',
        data: { payment },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Reverse payment error:', error);
      if (
        (error as Error).message === 'Payment not found or cannot be reversed'
      ) {
        return res.status(404).json({
          success: false,
          message: (error as Error).message,
          error: 'PAYMENT_NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/payments/loans/{loanId}/history:
 *   get:
 *     summary: Get payment history for a loan
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 */
router.get('/loans/:loanId/history', authenticate, async (req, res) => {
  try {
    const loanId = req.params.loanId!;
    const organizationId = req.userContext?.organizationId;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 100);

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'Organization ID required',
        error: 'MISSING_ORGANIZATION',
        timestamp: new Date().toISOString(),
      });
    }

    const result = await paymentService.getPaymentHistory(
      loanId!,
      organizationId!,
      page,
      limit
    );

    res.json({
      success: true,
      message: 'Payment history retrieved successfully',
      data: result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Get payment history error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @swagger
 * /api/v1/payments/loans/{loanId}/schedule:
 *   get:
 *     summary: Get repayment schedule for a loan
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 */
router.get('/loans/:loanId/schedule', authenticate, async (req, res) => {
  try {
    const loanId = req.params.loanId!;
    const organizationId = req.userContext?.organizationId;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'Organization ID required',
        error: 'MISSING_ORGANIZATION',
        timestamp: new Date().toISOString(),
      });
    }

    const schedule = await paymentService.getRepaymentSchedule(
      loanId!,
      organizationId!
    );

    res.json({
      success: true,
      message: 'Repayment schedule retrieved successfully',
      data: { schedule },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Get repayment schedule error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @swagger
 * /api/v1/payments/loans/{loanId}/overdue:
 *   get:
 *     summary: Calculate overdue amounts for a loan
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 */
router.get('/loans/:loanId/overdue', authenticate, async (req, res) => {
  try {
    const loanId = req.params.loanId!;
    const organizationId = req.userContext?.organizationId;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'Organization ID required',
        error: 'MISSING_ORGANIZATION',
        timestamp: new Date().toISOString(),
      });
    }

    const overdueInfo = await paymentService.calculateOverdueAmounts(
      loanId!,
      organizationId!
    );

    res.json({
      success: true,
      message: 'Overdue amounts calculated successfully',
      data: { overdueInfo },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Calculate overdue error:', error);
    if ((error as Error).message === 'Loan not found') {
      return res.status(404).json({
        success: false,
        message: 'Loan not found',
        error: 'LOAN_NOT_FOUND',
        timestamp: new Date().toISOString(),
      });
    }
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @swagger
 * /api/v1/payments/statistics:
 *   get:
 *     summary: Get payment statistics
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 */
router.get('/statistics', authenticate, async (req, res) => {
  try {
    const organizationId = req.userContext?.organizationId;
    const branchId = req.query.branchId as string;
    const dateFrom = req.query.dateFrom
      ? new Date(req.query.dateFrom as string)
      : undefined;
    const dateTo = req.query.dateTo
      ? new Date(req.query.dateTo as string)
      : undefined;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'Organization ID required',
        error: 'MISSING_ORGANIZATION',
        timestamp: new Date().toISOString(),
      });
    }

    const statistics = await paymentService.getPaymentStatistics(
      organizationId,
      branchId,
      dateFrom,
      dateTo
    );

    res.json({
      success: true,
      message: 'Payment statistics retrieved successfully',
      data: { statistics },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Get payment statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
