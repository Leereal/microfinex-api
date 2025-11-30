import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth-supabase';
import { validateRequest } from '../middleware/validation';
import { UserRole } from '../types';
import { loanProductService } from '../services/loan-product.service';

const router = Router();

// Validation schemas
const createProductSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: z
    .enum([
      'PERSONAL',
      'BUSINESS',
      'AGRICULTURE',
      'EDUCATION',
      'MEDICAL',
      'HOUSING',
      'EMERGENCY',
      'GROUP',
      'SME',
      'OTHER',
    ])
    .optional(),
  categoryId: z.string().uuid().optional(),
  minAmount: z.number().positive(),
  maxAmount: z.number().positive(),
  currency: z
    .enum(['USD', 'EUR', 'GBP', 'JPY', 'CNY', 'HTG', 'DOP', 'CAD'])
    .optional(),
  interestRate: z.number().min(0).max(1), // Annual rate as decimal (0.15 = 15%)
  calculationMethod: z
    .enum([
      'FLAT_RATE',
      'REDUCING_BALANCE',
      'SIMPLE_INTEREST',
      'COMPOUND_INTEREST',
      'ANNUITY',
      'BALLOON_PAYMENT',
      'CUSTOM_FORMULA',
    ])
    .optional(),
  minTerm: z.number().int().positive(),
  maxTerm: z.number().int().positive(),
  repaymentFrequency: z
    .enum([
      'DAILY',
      'WEEKLY',
      'BIWEEKLY',
      'MONTHLY',
      'QUARTERLY',
      'SEMI_ANNUAL',
      'ANNUAL',
    ])
    .optional(),
  gracePeriod: z.number().int().min(0).optional(),
  penaltyRate: z.number().min(0).max(1).optional(),
  requiresCollateral: z.boolean().optional(),
  requiresGuarantor: z.boolean().optional(),
  isOnlineEligible: z.boolean().optional(),
});

const updateProductSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  type: z
    .enum([
      'PERSONAL',
      'BUSINESS',
      'AGRICULTURE',
      'EDUCATION',
      'MEDICAL',
      'HOUSING',
      'EMERGENCY',
      'GROUP',
      'SME',
      'OTHER',
    ])
    .optional(),
  categoryId: z.string().uuid().optional(),
  minAmount: z.number().positive().optional(),
  maxAmount: z.number().positive().optional(),
  currency: z
    .enum(['USD', 'EUR', 'GBP', 'JPY', 'CNY', 'HTG', 'DOP', 'CAD'])
    .optional(),
  interestRate: z.number().min(0).max(1).optional(),
  calculationMethod: z
    .enum([
      'FLAT_RATE',
      'REDUCING_BALANCE',
      'SIMPLE_INTEREST',
      'COMPOUND_INTEREST',
      'ANNUITY',
      'BALLOON_PAYMENT',
      'CUSTOM_FORMULA',
    ])
    .optional(),
  minTerm: z.number().int().positive().optional(),
  maxTerm: z.number().int().positive().optional(),
  repaymentFrequency: z
    .enum([
      'DAILY',
      'WEEKLY',
      'BIWEEKLY',
      'MONTHLY',
      'QUARTERLY',
      'SEMI_ANNUAL',
      'ANNUAL',
    ])
    .optional(),
  gracePeriod: z.number().int().min(0).optional(),
  penaltyRate: z.number().min(0).max(1).optional(),
  requiresCollateral: z.boolean().optional(),
  requiresGuarantor: z.boolean().optional(),
  isOnlineEligible: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

/**
 * @swagger
 * /api/v1/loan-products:
 *   get:
 *     summary: Get all loan products
 *     tags: [Loan Products]
 *     security:
 *       - bearerAuth: []
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'User does not belong to an organization',
        error: 'NO_ORGANIZATION',
        timestamp: new Date().toISOString(),
      });
    }

    const { categoryId, isActive } = req.query;

    const products = await loanProductService.getAll(organizationId, {
      categoryId: categoryId as string | undefined,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
    });

    res.json({
      success: true,
      message: 'Loan products retrieved successfully',
      data: { products },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Get loan products error:', error);
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
 * /api/v1/loan-products/calculator:
 *   get:
 *     summary: Get loan products for calculator (minimal data)
 *     tags: [Loan Products]
 *     security:
 *       - bearerAuth: []
 */
router.get('/calculator', authenticate, async (req, res) => {
  try {
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'User does not belong to an organization',
        error: 'NO_ORGANIZATION',
        timestamp: new Date().toISOString(),
      });
    }

    const products =
      await loanProductService.getProductsForLoanCalculation(organizationId);

    res.json({
      success: true,
      message: 'Loan products for calculator retrieved successfully',
      data: { products },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Get calculator products error:', error);
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
 * /api/v1/loan-products:
 *   post:
 *     summary: Create loan product
 *     tags: [Loan Products]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/',
  authenticate,
  authorize(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateRequest(createProductSchema),
  async (req, res) => {
    try {
      const organizationId = req.user?.organizationId;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'User does not belong to an organization',
          error: 'NO_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      // Validate min < max amounts
      if (req.body.minAmount >= req.body.maxAmount) {
        return res.status(400).json({
          success: false,
          message: 'Minimum amount must be less than maximum amount',
          error: 'VALIDATION_ERROR',
          timestamp: new Date().toISOString(),
        });
      }

      // Validate min < max terms
      if (req.body.minTerm >= req.body.maxTerm) {
        return res.status(400).json({
          success: false,
          message: 'Minimum term must be less than maximum term',
          error: 'VALIDATION_ERROR',
          timestamp: new Date().toISOString(),
        });
      }

      const product = await loanProductService.create({
        ...req.body,
        organizationId,
      });

      res.status(201).json({
        success: true,
        message: 'Loan product created successfully',
        data: { product },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Create loan product error:', error);
      if (error.message === 'Loan category not found') {
        return res.status(400).json({
          success: false,
          message: 'Invalid category specified',
          error: 'INVALID_CATEGORY',
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
 * /api/v1/loan-products/{id}:
 *   get:
 *     summary: Get single loan product
 *     tags: [Loan Products]
 *     security:
 *       - bearerAuth: []
 */
router.get('/:id', authenticate, async (req, res) => {
  try {
    const id = req.params.id;
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'User does not belong to an organization',
        error: 'NO_ORGANIZATION',
        timestamp: new Date().toISOString(),
      });
    }

    const product = await loanProductService.get(id!, organizationId!);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Loan product not found',
        error: 'NOT_FOUND',
        timestamp: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      message: 'Loan product retrieved successfully',
      data: { product },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Get loan product error:', error);
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
 * /api/v1/loan-products/{id}:
 *   put:
 *     summary: Update loan product
 *     tags: [Loan Products]
 *     security:
 *       - bearerAuth: []
 */
router.put(
  '/:id',
  authenticate,
  authorize(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateRequest(updateProductSchema),
  async (req, res) => {
    try {
      const id = req.params.id;
      const organizationId = req.user?.organizationId;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'User does not belong to an organization',
          error: 'NO_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      const product = await loanProductService.update(
        id!,
        organizationId!,
        req.body
      );

      res.json({
        success: true,
        message: 'Loan product updated successfully',
        data: { product },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Update loan product error:', error);
      if (error.message === 'Loan product not found') {
        return res.status(404).json({
          success: false,
          message: 'Loan product not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }
      if (error.message === 'Loan category not found') {
        return res.status(400).json({
          success: false,
          message: 'Invalid category specified',
          error: 'INVALID_CATEGORY',
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
 * /api/v1/loan-products/{id}:
 *   delete:
 *     summary: Delete loan product
 *     tags: [Loan Products]
 *     security:
 *       - bearerAuth: []
 */
router.delete(
  '/:id',
  authenticate,
  authorize(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  async (req, res) => {
    try {
      const id = req.params.id;
      const organizationId = req.user?.organizationId;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'User does not belong to an organization',
          error: 'NO_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      await loanProductService.delete(id!, organizationId!);

      res.json({
        success: true,
        message: 'Loan product deleted successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Delete loan product error:', error);
      if (error.message === 'Loan product not found') {
        return res.status(404).json({
          success: false,
          message: 'Loan product not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }
      if (error.message.includes('used by')) {
        return res.status(400).json({
          success: false,
          message: error.message,
          error: 'PRODUCT_IN_USE',
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
 * /api/v1/loan-products/{id}/duplicate:
 *   post:
 *     summary: Duplicate a loan product
 *     tags: [Loan Products]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/:id/duplicate',
  authenticate,
  authorize(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  async (req, res) => {
    try {
      const id = req.params.id;
      const { name } = req.body;
      const organizationId = req.user?.organizationId;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'User does not belong to an organization',
          error: 'NO_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      if (!name) {
        return res.status(400).json({
          success: false,
          message: 'New product name is required',
          error: 'VALIDATION_ERROR',
          timestamp: new Date().toISOString(),
        });
      }

      const product = await loanProductService.duplicateProduct(
        id!,
        organizationId!,
        name
      );

      res.status(201).json({
        success: true,
        message: 'Loan product duplicated successfully',
        data: { product },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Duplicate loan product error:', error);
      if (error.message === 'Loan product not found') {
        return res.status(404).json({
          success: false,
          message: 'Loan product not found',
          error: 'NOT_FOUND',
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

export default router;
