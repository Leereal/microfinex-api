import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth-supabase';
import { requirePermission } from '../middleware/permissions';
import { validateRequest } from '../middleware/validation';
import { chargeService } from '../services/charge.service';

const router = Router();

// ============================================
// VALIDATION SCHEMAS
// ============================================

const chargeRateSchema = z.object({
  currency: z.enum(['USD', 'ZWG', 'ZAR', 'BWP', 'EUR', 'GBP']),
  amount: z.number().positive().optional(),
  percentage: z.number().min(0).max(1).optional(), // 0 to 1 (0% to 100%)
  minAmount: z.number().positive().optional(),
  maxAmount: z.number().positive().optional(),
  isActive: z.boolean().optional(),
});

const createChargeSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(2).max(20),
  type: z.enum([
    'ADMIN_FEE',
    'APPLICATION_FEE',
    'PROCESSING_FEE',
    'SERVICE_FEE',
    'LEGAL_FEE',
    'DOCUMENTATION_FEE',
    'INSURANCE_FEE',
    'STAMP_DUTY',
    'LATE_FEE',
    'PENALTY',
    'EARLY_SETTLEMENT_FEE',
    'COLLECTION_FEE',
    'RESTRUCTURE_FEE',
    'OTHER',
  ]),
  calculationType: z
    .enum(['FIXED', 'PERCENTAGE', 'PERCENTAGE_BALANCE'])
    .optional(),
  defaultAmount: z.number().positive().optional(),
  defaultPercentage: z.number().min(0).max(1).optional(),
  appliesAt: z
    .enum([
      'DISBURSEMENT',
      'APPROVAL',
      'SETTLEMENT',
      'LATE_PAYMENT',
      'MONTHLY',
      'MANUAL',
    ])
    .optional(),
  isDeductedFromPrincipal: z.boolean().optional(),
  isMandatory: z.boolean().optional(),
  description: z.string().max(500).optional(),
  isActive: z.boolean().optional(),
  rates: z.array(chargeRateSchema).optional(),
});

const updateChargeSchema = createChargeSchema.partial();

const applyChargeSchema = z.object({
  // Alias used by some frontends
  percentageValue: z.number().min(0).max(1).optional(),
  chargeId: z.string().uuid(),
  amount: z.number().positive().optional(),
  paymentMethodId: z.string().uuid().optional(),
  notes: z.string().optional(),
});

const applyDisbursementChargesSchema = z.object({
  chargeIds: z.array(z.string().uuid()).optional(),
  paymentMethodId: z.string().uuid().optional(),
});

const assignToProductSchema = z.object({
  chargeIds: z.array(z.string().uuid()),
  isMandatory: z.boolean().optional(),
  customAmount: z.number().positive().optional(),
  customPercentage: z.number().min(0).max(1).optional(),
});

// ============================================
// ROUTES
// ============================================

/**
 * @swagger
 * /api/v1/charges:
 *   get:
 *     summary: Get all charges
 *     tags: [Charges]
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'Organization ID required',
        error: 'BAD_REQUEST',
        timestamp: new Date().toISOString(),
      });
    }

    const { type, appliesAt, isActive, search } = req.query;

    const charges = await chargeService.getAll(organizationId, {
      type: type as any,
      appliesAt: appliesAt as any,
      isActive:
        isActive === 'true' ? true : isActive === 'false' ? false : undefined,
      search: search as string,
    });

    res.json({
      success: true,
      message: 'Charges retrieved successfully',
      data: { charges },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Get charges error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
      error: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @swagger
 * /api/v1/charges/disbursement:
 *   get:
 *     summary: Get disbursement charges
 *     tags: [Charges]
 */
router.get('/disbursement', authenticate, async (req, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'Organization ID required',
        error: 'BAD_REQUEST',
        timestamp: new Date().toISOString(),
      });
    }

    const { productId } = req.query;

    const charges = await chargeService.getDisbursementCharges(
      organizationId,
      productId as string
    );

    res.json({
      success: true,
      message: 'Disbursement charges retrieved successfully',
      data: { charges },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Get disbursement charges error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
      error: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @swagger
 * /api/v1/charges/seed:
 *   post:
 *     summary: Seed default charges
 *     tags: [Charges]
 */
router.post(
  '/seed',
  authenticate,
  requirePermission('charges:create'),
  async (req, res) => {
    try {
      const organizationId = req.user?.organizationId;
      const userId = req.user?.id || req.user?.userId;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization ID required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }

      const charges = await chargeService.seedDefaultCharges(
        organizationId,
        userId
      );

      res.status(201).json({
        success: true,
        message: `${charges.length} default charges created successfully`,
        data: { charges },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Seed charges error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/charges/{id}:
 *   get:
 *     summary: Get charge by ID
 *     tags: [Charges]
 */
router.get('/:id', authenticate, async (req, res) => {
  try {
    const chargeId = req.params.id;
    if (!chargeId) {
      return res.status(400).json({
        success: false,
        message: 'Charge ID is required',
        error: 'BAD_REQUEST',
        timestamp: new Date().toISOString(),
      });
    }

    const charge = await chargeService.getById(chargeId);

    if (!charge) {
      return res.status(404).json({
        success: false,
        message: 'Charge not found',
        error: 'NOT_FOUND',
        timestamp: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      message: 'Charge retrieved successfully',
      data: { charge },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Get charge error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
      error: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @swagger
 * /api/v1/charges:
 *   post:
 *     summary: Create a new charge
 *     tags: [Charges]
 */
router.post(
  '/',
  authenticate,
  requirePermission('charges:create'),
  validateRequest(createChargeSchema),
  async (req, res) => {
    try {
      const organizationId = req.user?.organizationId;
      const userId = req.user?.id || req.user?.userId;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization ID required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }

      const charge = await chargeService.create(
        organizationId,
        req.body,
        userId
      );

      res.status(201).json({
        success: true,
        message: 'Charge created successfully',
        data: { charge },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Create charge error:', error);

      if (error.code === 'P2002') {
        return res.status(409).json({
          success: false,
          message: 'A charge with this code already exists',
          error: 'DUPLICATE',
          timestamp: new Date().toISOString(),
        });
      }

      res.status(500).json({
        success: false,
        message: error.message || 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/charges/{id}:
 *   put:
 *     summary: Update a charge
 *     tags: [Charges]
 */
router.put(
  '/:id',
  authenticate,
  requirePermission('charges:update'),
  validateRequest(updateChargeSchema),
  async (req, res) => {
    try {
      const chargeId = req.params.id;
      if (!chargeId) {
        return res.status(400).json({
          success: false,
          message: 'Charge ID is required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }

      const userId = req.user?.id || req.user?.userId;
      const charge = await chargeService.update(chargeId, req.body, userId);

      res.json({
        success: true,
        message: 'Charge updated successfully',
        data: { charge },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Update charge error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/charges/{id}:
 *   delete:
 *     summary: Delete a charge (soft delete)
 *     tags: [Charges]
 */
router.delete(
  '/:id',
  authenticate,
  requirePermission('charges:delete'),
  async (req, res) => {
    try {
      const chargeId = req.params.id;
      if (!chargeId) {
        return res.status(400).json({
          success: false,
          message: 'Charge ID is required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }

      const userId = req.user?.id || req.user?.userId;
      await chargeService.delete(chargeId, userId);

      res.json({
        success: true,
        message: 'Charge deleted successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Delete charge error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

// ============================================
// LOAN CHARGE ROUTES
// ============================================

/**
 * @swagger
 * /api/v1/charges/loans/{loanId}/preview:
 *   get:
 *     summary: Preview charges for a loan
 *     tags: [Charges]
 */
router.get('/loans/:loanId/preview', authenticate, async (req, res) => {
  try {
    const loanId = req.params.loanId;
    if (!loanId) {
      return res.status(400).json({
        success: false,
        message: 'Loan ID is required',
        error: 'BAD_REQUEST',
        timestamp: new Date().toISOString(),
      });
    }

    const { chargeIds } = req.query;
    const chargeIdArray = chargeIds
      ? (chargeIds as string).split(',')
      : undefined;

    const calculatedCharges = await chargeService.getCalculatedChargesForLoan(
      loanId,
      chargeIdArray
    );

    const totalCharges = calculatedCharges.reduce(
      (sum, c) => sum + c.calculatedAmount,
      0
    );
    const deductedFromPrincipal = calculatedCharges
      .filter(c => c.isDeductedFromPrincipal)
      .reduce((sum, c) => sum + c.calculatedAmount, 0);

    res.json({
      success: true,
      message: 'Charge preview calculated successfully',
      data: {
        charges: calculatedCharges,
        summary: {
          totalCharges,
          deductedFromPrincipal,
          addedToLoan: totalCharges - deductedFromPrincipal,
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Preview charges error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
      error: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @swagger
 * /api/v1/charges/loans/{loanId}:
 *   get:
 *     summary: Get charges applied to a loan
 *     tags: [Charges]
 */
router.get('/loans/:loanId', authenticate, async (req, res) => {
  try {
    const loanId = req.params.loanId;
    if (!loanId) {
      return res.status(400).json({
        success: false,
        message: 'Loan ID is required',
        error: 'BAD_REQUEST',
        timestamp: new Date().toISOString(),
      });
    }

    const loanCharges = await chargeService.getLoanCharges(loanId);

    const totalCharges = loanCharges.reduce(
      (sum, c) => sum + parseFloat(c.amount.toString()),
      0
    );
    const totalPaid = loanCharges.reduce(
      (sum, c) => sum + parseFloat(c.paidAmount.toString()),
      0
    );

    res.json({
      success: true,
      message: 'Loan charges retrieved successfully',
      data: {
        loanCharges,
        summary: {
          totalCharges,
          totalPaid,
          totalOutstanding: totalCharges - totalPaid,
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Get loan charges error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
      error: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @swagger
 * /api/v1/charges/loans/{loanId}/apply:
 *   post:
 *     summary: Apply a charge to a loan
 *     tags: [Charges]
 */
router.post(
  '/loans/:loanId/apply',
  authenticate,
  requirePermission('charges:apply'),
  validateRequest(applyChargeSchema),
  async (req, res) => {
    try {
      const loanId = req.params.loanId;
      if (!loanId) {
        return res.status(400).json({
          success: false,
          message: 'Loan ID is required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }

      const userId = req.user?.id || req.user?.userId;

      const loanCharge = await chargeService.applyCharge({
        loanId,
        chargeId: req.body.chargeId,
        amount: req.body.amount,
        appliedBy: userId!,
        paymentMethodId: req.body.paymentMethodId,
        notes: req.body.notes,
      });

      res.status(201).json({
        success: true,
        message: 'Charge applied successfully',
        data: { loanCharge },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Apply charge error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/charges/loans/{loanId}/apply-disbursement:
 *   post:
 *     summary: Apply disbursement charges to a loan
 *     tags: [Charges]
 */
router.post(
  '/loans/:loanId/apply-disbursement',
  authenticate,
  requirePermission('loans:disburse'),
  validateRequest(applyDisbursementChargesSchema),
  async (req, res) => {
    try {
      const loanId = req.params.loanId;
      if (!loanId) {
        return res.status(400).json({
          success: false,
          message: 'Loan ID is required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }

      const userId = req.user?.id || req.user?.userId;

      const result = await chargeService.applyDisbursementCharges({
        loanId,
        chargeIds: req.body.chargeIds,
        appliedBy: userId!,
        paymentMethodId: req.body.paymentMethodId,
      });

      res.status(201).json({
        success: true,
        message: 'Disbursement charges applied successfully',
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Apply disbursement charges error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/charges/loans/{loanChargeId}/waive:
 *   post:
 *     summary: Waive a loan charge
 *     tags: [Charges]
 */
router.post(
  '/loan-charges/:loanChargeId/waive',
  authenticate,
  requirePermission('charges:waive'),
  async (req, res) => {
    try {
      const loanChargeId = req.params.loanChargeId;
      if (!loanChargeId) {
        return res.status(400).json({
          success: false,
          message: 'Loan charge ID is required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }

      const userId = req.user?.id || req.user?.userId;
      const { reason } = req.body;

      if (!reason) {
        return res.status(400).json({
          success: false,
          message: 'Waiver reason is required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }

      const loanCharge = await chargeService.waiveCharge(
        loanChargeId,
        userId!,
        reason
      );

      res.json({
        success: true,
        message: 'Charge waived successfully',
        data: { loanCharge },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Waive charge error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

// ============================================
// PRODUCT CHARGE ROUTES
// ============================================

/**
 * @swagger
 * /api/v1/charges/products/{productId}/assign:
 *   post:
 *     summary: Assign charges to a product
 *     tags: [Charges]
 */
router.post(
  '/products/:productId/assign',
  authenticate,
  requirePermission('loan_products:update'),
  validateRequest(assignToProductSchema),
  async (req, res) => {
    try {
      const productId = req.params.productId;
      if (!productId) {
        return res.status(400).json({
          success: false,
          message: 'Product ID is required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }

      await chargeService.assignToProduct(productId, req.body.chargeIds, {
        isMandatory: req.body.isMandatory,
        customAmount: req.body.customAmount,
        customPercentage: req.body.customPercentage,
      });

      res.json({
        success: true,
        message: 'Charges assigned to product successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Assign charges to product error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/charges/products/{productId}/remove:
 *   post:
 *     summary: Remove charges from a product
 *     tags: [Charges]
 */
router.post(
  '/products/:productId/remove',
  authenticate,
  requirePermission('loan_products:update'),
  async (req, res) => {
    try {
      const productId = req.params.productId;
      if (!productId) {
        return res.status(400).json({
          success: false,
          message: 'Product ID is required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }

      const { chargeIds } = req.body;

      if (!chargeIds || !Array.isArray(chargeIds)) {
        return res.status(400).json({
          success: false,
          message: 'chargeIds array is required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }

      await chargeService.removeFromProduct(productId, chargeIds);

      res.json({
        success: true,
        message: 'Charges removed from product successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Remove charges from product error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

export default router;
