/**
 * Financial Transaction Routes
 * API endpoints for income and expense transaction management
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticateToken } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/auth';
import { handleAsync } from '../middleware/validation.middleware';
import {
  financialTransactionService,
  UpdateFinancialTransactionInput,
} from '../services/financial-transaction.service';
import {
  FinancialTransactionType,
  FinancialTransactionStatus,
} from '@prisma/client';
import { PERMISSIONS } from '../constants/permissions';

const router = Router();

// Validation schemas
const createTransactionSchema = z
  .object({
    branchId: z.string().uuid().optional(),
    type: z.nativeEnum(FinancialTransactionType),
    incomeCategoryId: z.string().uuid().optional(),
    expenseCategoryId: z.string().uuid().optional(),
    paymentMethodId: z.string().uuid(),
    amount: z.number().positive(),
    currency: z.string().max(10).default('USD'),
    description: z.string().min(2).max(500),
    reference: z.string().max(100).optional(),
    relatedLoanId: z.string().uuid().optional(),
    transactionDate: z
      .string()
      .datetime()
      .optional()
      .transform(val => (val ? new Date(val) : undefined)),
    notes: z.string().max(1000).optional(),
    attachments: z.any().optional(),
  })
  .refine(
    data => {
      if (data.type === 'INCOME' && !data.incomeCategoryId) {
        return false;
      }
      if (data.type === 'EXPENSE' && !data.expenseCategoryId) {
        return false;
      }
      return true;
    },
    {
      message:
        'Income category is required for INCOME transactions, expense category is required for EXPENSE transactions',
    }
  );

const updateTransactionSchema = z.object({
  description: z.string().min(2).max(500).optional(),
  reference: z.string().max(100).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  attachments: z.any().optional(),
});

const voidTransactionSchema = z.object({
  reason: z.string().min(5).max(500),
});

const listTransactionsQuerySchema = z.object({
  branchId: z.string().uuid().optional(),
  type: z.nativeEnum(FinancialTransactionType).optional(),
  status: z.nativeEnum(FinancialTransactionStatus).optional(),
  paymentMethodId: z.string().uuid().optional(),
  incomeCategoryId: z.string().uuid().optional(),
  expenseCategoryId: z.string().uuid().optional(),
  startDate: z
    .string()
    .datetime()
    .optional()
    .transform(val => (val ? new Date(val) : undefined)),
  endDate: z
    .string()
    .datetime()
    .optional()
    .transform(val => (val ? new Date(val) : undefined)),
  search: z.string().optional(),
  page: z.string().transform(Number).default('1'),
  limit: z.string().transform(Number).default('50'),
});

const summaryQuerySchema = z.object({
  startDate: z
    .string()
    .datetime()
    .optional()
    .transform(val => (val ? new Date(val) : undefined)),
  endDate: z
    .string()
    .datetime()
    .optional()
    .transform(val => (val ? new Date(val) : undefined)),
});

/**
 * @swagger
 * /api/v1/financial-transactions:
 *   get:
 *     summary: Get all financial transactions for the organization
 *     tags: [Financial Transactions]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/',
  authenticateToken,
  requirePermission(PERMISSIONS.FINANCIAL_TRANSACTIONS_VIEW),
  handleAsync(async (req: Request, res: Response) => {
    const query = listTransactionsQuerySchema.parse(req.query);
    const organizationId = req.user!.organizationId!;

    const result = await financialTransactionService.getAll({
      organizationId,
      ...query,
    });

    res.json({
      success: true,
      message: 'Financial transactions retrieved successfully',
      data: result,
      timestamp: new Date().toISOString(),
    });
  })
);

/**
 * @swagger
 * /api/v1/financial-transactions/summary:
 *   get:
 *     summary: Get financial summary for the organization
 *     tags: [Financial Transactions]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/summary',
  authenticateToken,
  requirePermission(PERMISSIONS.FINANCIAL_TRANSACTIONS_SUMMARY),
  handleAsync(async (req: Request, res: Response) => {
    const { startDate, endDate } = summaryQuerySchema.parse(req.query);
    const organizationId = req.user!.organizationId!;

    const summary = await financialTransactionService.getSummary(
      organizationId,
      startDate,
      endDate
    );

    res.json({
      success: true,
      message: 'Financial summary retrieved successfully',
      data: summary,
      timestamp: new Date().toISOString(),
    });
  })
);

/**
 * @swagger
 * /api/v1/financial-transactions/payment-method/{paymentMethodId}/history:
 *   get:
 *     summary: Get transaction history for a payment method
 *     tags: [Financial Transactions]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/payment-method/:paymentMethodId/history',
  authenticateToken,
  requirePermission(PERMISSIONS.FINANCIAL_TRANSACTIONS_VIEW),
  handleAsync(async (req: Request, res: Response) => {
    const paymentMethodId: string = req.params.paymentMethodId!;
    const { startDate, endDate } = summaryQuerySchema.parse(req.query);
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const organizationId: string = req.user!.organizationId!;

    const result = await financialTransactionService.getPaymentMethodHistory(
      paymentMethodId,
      organizationId,
      startDate,
      endDate,
      page,
      limit
    );

    res.json({
      success: true,
      message: 'Payment method history retrieved successfully',
      data: result,
      timestamp: new Date().toISOString(),
    });
  })
);

/**
 * @swagger
 * /api/v1/financial-transactions/{id}:
 *   get:
 *     summary: Get a financial transaction by ID
 *     tags: [Financial Transactions]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/:id',
  authenticateToken,
  requirePermission(PERMISSIONS.FINANCIAL_TRANSACTIONS_VIEW),
  handleAsync(async (req: Request, res: Response) => {
    const id: string = req.params.id!;
    const organizationId: string = req.user!.organizationId!;

    const transaction = await financialTransactionService.getById(
      id,
      organizationId
    );

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found',
        error: 'NOT_FOUND',
      });
    }

    res.json({
      success: true,
      message: 'Transaction retrieved successfully',
      data: transaction,
      timestamp: new Date().toISOString(),
    });
  })
);

/**
 * @swagger
 * /api/v1/financial-transactions:
 *   post:
 *     summary: Create a new financial transaction (income or expense)
 *     tags: [Financial Transactions]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/',
  authenticateToken,
  requirePermission(PERMISSIONS.FINANCIAL_TRANSACTIONS_CREATE),
  handleAsync(async (req: Request, res: Response) => {
    const data = createTransactionSchema.parse(req.body);
    const organizationId = req.user!.organizationId!;
    const userId = req.user!.userId;

    const transaction = await financialTransactionService.create({
      ...data,
      organizationId,
      processedBy: userId,
    });

    res.status(201).json({
      success: true,
      message: `${data.type === 'INCOME' ? 'Income' : 'Expense'} transaction recorded successfully`,
      data: transaction,
      timestamp: new Date().toISOString(),
    });
  })
);

/**
 * @swagger
 * /api/v1/financial-transactions/{id}:
 *   put:
 *     summary: Update a financial transaction (limited fields)
 *     tags: [Financial Transactions]
 *     security:
 *       - bearerAuth: []
 */
router.put(
  '/:id',
  authenticateToken,
  requirePermission(PERMISSIONS.FINANCIAL_TRANSACTIONS_UPDATE),
  handleAsync(async (req: Request, res: Response) => {
    const id: string = req.params.id!;
    const data = updateTransactionSchema.parse(req.body);
    const organizationId: string = req.user!.organizationId!;

    const transaction = await financialTransactionService.update(
      id,
      organizationId,
      data as UpdateFinancialTransactionInput
    );

    res.json({
      success: true,
      message: 'Transaction updated successfully',
      data: transaction,
      timestamp: new Date().toISOString(),
    });
  })
);

/**
 * @swagger
 * /api/v1/financial-transactions/{id}/void:
 *   post:
 *     summary: Void a financial transaction
 *     tags: [Financial Transactions]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/:id/void',
  authenticateToken,
  requirePermission(PERMISSIONS.FINANCIAL_TRANSACTIONS_VOID),
  handleAsync(async (req: Request, res: Response) => {
    const id: string = req.params.id!;
    const { reason } = voidTransactionSchema.parse(req.body);
    const organizationId: string = req.user!.organizationId!;
    const userId: string = req.user!.userId;

    const transaction = await financialTransactionService.void(
      id,
      organizationId,
      userId,
      reason
    );

    res.json({
      success: true,
      message: 'Transaction voided successfully',
      data: transaction,
      timestamp: new Date().toISOString(),
    });
  })
);

export default router;
