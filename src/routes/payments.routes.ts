import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/database';
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
  clientId: z.string().uuid().optional(),
  status: z
    .enum(['PENDING', 'COMPLETED', 'FAILED', 'CANCELLED', 'REFUNDED'])
    .optional(),
  method: z.string().optional(), // Dynamic payment methods from database
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  search: z.string().optional(),
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
 *   get:
 *     summary: Get all payments with pagination and filters
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/',
  authenticate,
  validateQuery(paymentQuerySchema),
  async (req, res) => {
    try {
      const organizationId = req.userContext?.organizationId;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization ID required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      const {
        loanId,
        clientId,
        status,
        method,
        dateFrom,
        dateTo,
        search,
        page = 1,
        limit = 10,
      } = req.query as {
        loanId?: string;
        clientId?: string;
        status?: string;
        method?: string;
        dateFrom?: string;
        dateTo?: string;
        search?: string;
        page?: number;
        limit?: number;
      };

      const skip = (Number(page) - 1) * Number(limit);

      // Build where clause
      const where: any = {
        loan: {
          organizationId,
        },
      };

      if (loanId) {
        where.loanId = loanId;
      }

      if (clientId) {
        where.loan = {
          ...where.loan,
          clientId,
        };
      }

      if (status) {
        where.status = status;
      }

      if (method) {
        where.method = method;
      }

      if (dateFrom || dateTo) {
        where.paymentDate = {};
        if (dateFrom) {
          where.paymentDate.gte = new Date(dateFrom);
        }
        if (dateTo) {
          where.paymentDate.lte = new Date(dateTo);
        }
      }

      if (search) {
        where.OR = [
          { paymentNumber: { contains: search, mode: 'insensitive' } },
          { transactionRef: { contains: search, mode: 'insensitive' } },
          {
            loan: {
              loanNumber: { contains: search, mode: 'insensitive' },
            },
          },
          {
            loan: {
              client: {
                OR: [
                  { firstName: { contains: search, mode: 'insensitive' } },
                  { lastName: { contains: search, mode: 'insensitive' } },
                ],
              },
            },
          },
        ];
      }

      const [payments, total] = await Promise.all([
        prisma.payment.findMany({
          where,
          include: {
            loan: {
              select: {
                id: true,
                loanNumber: true,
                amount: true,
                currency: true,
                client: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    clientNumber: true,
                  },
                },
                product: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
            receiver: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
            processedBranch: {
              select: {
                id: true,
                name: true,
                code: true,
              },
            },
          },
          orderBy: { paymentDate: 'desc' },
          skip,
          take: Number(limit),
        }),
        prisma.payment.count({ where }),
      ]);

      // Get summary statistics
      const summaryWhere = {
        loan: { organizationId },
        ...(status && { status }),
        ...(dateFrom || dateTo
          ? {
              paymentDate: {
                ...(dateFrom && { gte: new Date(dateFrom) }),
                ...(dateTo && { lte: new Date(dateTo) }),
              },
            }
          : {}),
      };

      const [totalAmount, statusCounts] = await Promise.all([
        prisma.payment.aggregate({
          where: { ...summaryWhere, status: 'COMPLETED' },
          _sum: { amount: true },
        }),
        prisma.payment.groupBy({
          by: ['status'],
          where: { loan: { organizationId } },
          _count: true,
        }),
      ]);

      res.json({
        success: true,
        message: 'Payments retrieved successfully',
        data: {
          payments: payments.map(p => ({
            ...p,
            amount: Number(p.amount),
            principalAmount: Number(p.principalAmount),
            interestAmount: Number(p.interestAmount),
            penaltyAmount: Number(p.penaltyAmount),
          })),
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total,
            totalPages: Math.ceil(total / Number(limit)),
          },
          summary: {
            totalCollected: Number(totalAmount._sum?.amount || 0),
            statusBreakdown: statusCounts.reduce(
              (acc, s) => {
                acc[s.status] = s._count;
                return acc;
              },
              {} as Record<string, number>
            ),
          },
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Get payments error:', error);
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
