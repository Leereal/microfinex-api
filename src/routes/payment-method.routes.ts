/**
 * Payment Method Routes
 * API endpoints for payment method management
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticateToken } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/auth';
import { handleAsync } from '../middleware/validation.middleware';
import {
  paymentMethodService,
  UpdatePaymentMethodInput,
} from '../services/payment-method.service';
import { PaymentMethodType } from '@prisma/client';
import { PERMISSIONS } from '../constants/permissions';

const router = Router();

// Validation schemas
const createPaymentMethodSchema = z.object({
  name: z.string().min(2).max(100),
  code: z
    .string()
    .min(2)
    .max(20)
    .transform(val => val.toUpperCase()),
  type: z.nativeEnum(PaymentMethodType),
  accountNumber: z.string().max(50).optional(),
  description: z.string().max(500).optional(),
  initialBalance: z.number().min(0).default(0),
  currency: z.string().max(10).default('USD'),
  isActive: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  allowDisbursement: z.boolean().default(true),
  allowRepayment: z.boolean().default(true),
});

const updatePaymentMethodSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  code: z
    .string()
    .min(2)
    .max(20)
    .transform(val => val.toUpperCase())
    .optional(),
  type: z.nativeEnum(PaymentMethodType).optional(),
  accountNumber: z.string().max(50).optional().nullable(),
  description: z.string().max(500).optional().nullable(),
  currency: z.string().max(10).optional(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  allowDisbursement: z.boolean().optional(),
  allowRepayment: z.boolean().optional(),
});

const transferFundsSchema = z.object({
  fromPaymentMethodId: z.string().uuid(),
  toPaymentMethodId: z.string().uuid(),
  amount: z.number().positive('Amount must be positive'),
  description: z.string().min(2).max(500),
});

const adjustBalanceSchema = z.object({
  amount: z.number().positive('Amount must be positive'),
  type: z.enum(['credit', 'debit']),
  reason: z.string().min(2).max(500),
});

const listPaymentMethodsQuerySchema = z.object({
  search: z.string().optional(),
  type: z.nativeEnum(PaymentMethodType).optional(),
  isActive: z
    .string()
    .transform(val => val === 'true')
    .optional(),
  page: z.string().transform(Number).default('1'),
  limit: z.string().transform(Number).default('50'),
});

/**
 * @swagger
 * /api/v1/payment-methods:
 *   get:
 *     summary: Get all payment methods for the organization
 *     tags: [Payment Methods]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/',
  authenticateToken,
  requirePermission(PERMISSIONS.PAYMENT_METHODS_VIEW),
  handleAsync(async (req: Request, res: Response) => {
    const query = listPaymentMethodsQuerySchema.parse(req.query);
    const organizationId = req.user!.organizationId!;

    const result = await paymentMethodService.getAll({
      organizationId,
      search: query.search,
      type: query.type,
      isActive: query.isActive,
      page: query.page,
      limit: query.limit,
    });

    res.json({
      success: true,
      message: 'Payment methods retrieved successfully',
      data: result,
      timestamp: new Date().toISOString(),
    });
  })
);

/**
 * @swagger
 * /api/v1/payment-methods/active:
 *   get:
 *     summary: Get all active payment methods (for dropdowns)
 *     tags: [Payment Methods]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/active',
  authenticateToken,
  handleAsync(async (req: Request, res: Response) => {
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'Organization ID required',
        error: 'MISSING_ORGANIZATION',
      });
    }

    const paymentMethods = await paymentMethodService.getActive(organizationId);

    res.json({
      success: true,
      message: 'Active payment methods retrieved successfully',
      data: paymentMethods,
      timestamp: new Date().toISOString(),
    });
  })
);

/**
 * @swagger
 * /api/v1/payment-methods/balances:
 *   get:
 *     summary: Get payment method balances summary
 *     tags: [Payment Methods]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/balances',
  authenticateToken,
  requirePermission(PERMISSIONS.PAYMENT_METHODS_VIEW),
  handleAsync(async (req: Request, res: Response) => {
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'Organization ID required',
        error: 'MISSING_ORGANIZATION',
      });
    }

    const summary =
      await paymentMethodService.getBalancesSummary(organizationId);

    res.json({
      success: true,
      message: 'Payment method balances retrieved successfully',
      data: summary,
      timestamp: new Date().toISOString(),
    });
  })
);

/**
 * @swagger
 * /api/v1/payment-methods/seed:
 *   post:
 *     summary: Seed default payment methods for the organization
 *     tags: [Payment Methods]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/seed',
  authenticateToken,
  requirePermission(PERMISSIONS.PAYMENT_METHODS_CREATE),
  handleAsync(async (req: Request, res: Response) => {
    const organizationId = req.user?.organizationId;
    const userId = req.user?.userId;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'Organization ID required',
        error: 'MISSING_ORGANIZATION',
      });
    }

    const result = await paymentMethodService.seedDefaults(
      organizationId,
      userId
    );

    res.status(201).json({
      success: true,
      message: `Created ${result.length} default payment methods`,
      data: result,
      timestamp: new Date().toISOString(),
    });
  })
);

/**
 * @swagger
 * /api/v1/payment-methods/stats:
 *   get:
 *     summary: Get payment method statistics
 *     tags: [Payment Methods]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/stats',
  authenticateToken,
  requirePermission(PERMISSIONS.PAYMENT_METHODS_VIEW),
  handleAsync(async (req: Request, res: Response) => {
    const organizationId: string = req.user!.organizationId!;

    const stats = await paymentMethodService.getStats(organizationId);

    res.json({
      success: true,
      message: 'Payment method statistics retrieved successfully',
      data: stats,
      timestamp: new Date().toISOString(),
    });
  })
);

/**
 * @swagger
 * /api/v1/payment-methods/transfer:
 *   post:
 *     summary: Transfer funds between payment methods
 *     tags: [Payment Methods]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/transfer',
  authenticateToken,
  requirePermission(PERMISSIONS.PAYMENT_METHODS_UPDATE),
  handleAsync(async (req: Request, res: Response) => {
    const data = transferFundsSchema.parse(req.body);
    const organizationId: string = req.user!.organizationId!;
    const userId: string = req.user!.userId;

    const result = await paymentMethodService.transferFunds(
      organizationId,
      data.fromPaymentMethodId,
      data.toPaymentMethodId,
      data.amount,
      data.description,
      userId
    );

    res.json({
      success: true,
      message: `Successfully transferred ${data.amount} between payment methods`,
      data: result,
      timestamp: new Date().toISOString(),
    });
  })
);

/**
 * @swagger
 * /api/v1/payment-methods/{id}/adjust-balance:
 *   post:
 *     summary: Manually adjust the balance of a payment method
 *     tags: [Payment Methods]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/:id/adjust-balance',
  authenticateToken,
  requirePermission(PERMISSIONS.PAYMENT_METHODS_UPDATE),
  handleAsync(async (req: Request, res: Response) => {
    const id: string = req.params.id!;
    const data = adjustBalanceSchema.parse(req.body);
    const organizationId: string = req.user!.organizationId!;
    const userId: string = req.user!.userId;

    const result = await paymentMethodService.adjustBalance(
      id,
      organizationId,
      data.amount,
      data.type,
      data.reason,
      userId
    );

    res.json({
      success: true,
      message: `Successfully adjusted balance by ${data.type === 'credit' ? '+' : '-'}${data.amount}`,
      data: result,
      timestamp: new Date().toISOString(),
    });
  })
);

/**
 * @swagger
 * /api/v1/payment-methods/{id}:
 *   get:
 *     summary: Get a payment method by ID
 *     tags: [Payment Methods]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/:id',
  authenticateToken,
  requirePermission(PERMISSIONS.PAYMENT_METHODS_VIEW),
  handleAsync(async (req: Request, res: Response) => {
    const id: string = req.params.id!;
    const organizationId: string = req.user!.organizationId!;

    const paymentMethod = await paymentMethodService.getById(
      id,
      organizationId
    );

    if (!paymentMethod) {
      return res.status(404).json({
        success: false,
        message: 'Payment method not found',
        error: 'NOT_FOUND',
      });
    }

    res.json({
      success: true,
      message: 'Payment method retrieved successfully',
      data: paymentMethod,
      timestamp: new Date().toISOString(),
    });
  })
);

/**
 * @swagger
 * /api/v1/payment-methods:
 *   post:
 *     summary: Create a new payment method
 *     tags: [Payment Methods]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/',
  authenticateToken,
  requirePermission(PERMISSIONS.PAYMENT_METHODS_CREATE),
  handleAsync(async (req: Request, res: Response) => {
    const data = createPaymentMethodSchema.parse(req.body);
    const organizationId = req.user?.organizationId;
    const userId = req.user?.userId;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'Organization ID required',
        error: 'MISSING_ORGANIZATION',
      });
    }

    const paymentMethod = await paymentMethodService.create({
      ...data,
      organizationId,
      createdBy: userId,
    });

    res.status(201).json({
      success: true,
      message: 'Payment method created successfully',
      data: paymentMethod,
      timestamp: new Date().toISOString(),
    });
  })
);

/**
 * @swagger
 * /api/v1/payment-methods/{id}:
 *   put:
 *     summary: Update a payment method
 *     tags: [Payment Methods]
 *     security:
 *       - bearerAuth: []
 */
router.put(
  '/:id',
  authenticateToken,
  requirePermission(PERMISSIONS.PAYMENT_METHODS_UPDATE),
  handleAsync(async (req: Request, res: Response) => {
    const id: string = req.params.id!;
    const data = updatePaymentMethodSchema.parse(req.body);
    const organizationId: string = req.user!.organizationId!;
    const userId: string = req.user!.userId;

    const paymentMethod = await paymentMethodService.update(
      id,
      organizationId,
      {
        ...data,
        updatedBy: userId,
      } as UpdatePaymentMethodInput
    );

    res.json({
      success: true,
      message: 'Payment method updated successfully',
      data: paymentMethod,
      timestamp: new Date().toISOString(),
    });
  })
);

/**
 * @swagger
 * /api/v1/payment-methods/{id}:
 *   delete:
 *     summary: Delete a payment method
 *     tags: [Payment Methods]
 *     security:
 *       - bearerAuth: []
 */
router.delete(
  '/:id',
  authenticateToken,
  requirePermission(PERMISSIONS.PAYMENT_METHODS_DELETE),
  handleAsync(async (req: Request, res: Response) => {
    const id: string = req.params.id!;
    const organizationId: string = req.user!.organizationId!;

    await paymentMethodService.delete(id, organizationId);

    res.json({
      success: true,
      message: 'Payment method deleted successfully',
      timestamp: new Date().toISOString(),
    });
  })
);

export default router;
