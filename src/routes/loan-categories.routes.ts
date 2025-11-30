import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth-supabase';
import { validateRequest } from '../middleware/validation';
import { UserRole } from '../types';
import { loanCategoryService } from '../services/loan-category.service';

const router = Router();

// Validation schemas
const createCategorySchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  description: z.string().optional(),
  isLongTerm: z.boolean().optional(),
  requiresBusinessVisit: z.boolean().optional(),
  requiresHomeVisit: z.boolean().optional(),
  requiresSecurityPledge: z.boolean().optional(),
  requiresCollateral: z.boolean().optional(),
});

const updateCategorySchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  isLongTerm: z.boolean().optional(),
  requiresBusinessVisit: z.boolean().optional(),
  requiresHomeVisit: z.boolean().optional(),
  requiresSecurityPledge: z.boolean().optional(),
  requiresCollateral: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

/**
 * @swagger
 * /api/v1/loan-categories:
 *   get:
 *     summary: Get all loan categories
 *     tags: [Loan Categories]
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

    const categories = await loanCategoryService.getAll(organizationId);

    res.json({
      success: true,
      message: 'Loan categories retrieved successfully',
      data: { categories },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Get loan categories error:', error);
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
 * /api/v1/loan-categories:
 *   post:
 *     summary: Create loan category
 *     tags: [Loan Categories]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/',
  authenticate,
  authorize(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateRequest(createCategorySchema),
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

      const category = await loanCategoryService.create({
        ...req.body,
        organizationId,
      });

      res.status(201).json({
        success: true,
        message: 'Loan category created successfully',
        data: { category },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Create loan category error:', error);
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
 * /api/v1/loan-categories/{id}:
 *   get:
 *     summary: Get single loan category
 *     tags: [Loan Categories]
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

    const category = await loanCategoryService.get(id!, organizationId!);

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Loan category not found',
        error: 'NOT_FOUND',
        timestamp: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      message: 'Loan category retrieved successfully',
      data: { category },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Get loan category error:', error);
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
 * /api/v1/loan-categories/{id}:
 *   put:
 *     summary: Update loan category
 *     tags: [Loan Categories]
 *     security:
 *       - bearerAuth: []
 */
router.put(
  '/:id',
  authenticate,
  authorize(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateRequest(updateCategorySchema),
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

      const category = await loanCategoryService.update(
        id!,
        organizationId!,
        req.body
      );

      res.json({
        success: true,
        message: 'Loan category updated successfully',
        data: { category },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Update loan category error:', error);
      if (error.message === 'Loan category not found') {
        return res.status(404).json({
          success: false,
          message: 'Loan category not found',
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

/**
 * @swagger
 * /api/v1/loan-categories/{id}:
 *   delete:
 *     summary: Delete loan category
 *     tags: [Loan Categories]
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

      await loanCategoryService.delete(id!, organizationId!);

      res.json({
        success: true,
        message: 'Loan category deleted successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Delete loan category error:', error);
      if (error.message === 'Loan category not found') {
        return res.status(404).json({
          success: false,
          message: 'Loan category not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }
      if (error.message.includes('used by loan products')) {
        return res.status(400).json({
          success: false,
          message: error.message,
          error: 'CATEGORY_IN_USE',
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
