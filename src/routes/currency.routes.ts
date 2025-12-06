/**
 * Currency Routes
 * API endpoints for currency management (Super Admin only)
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticateToken } from '../middleware/auth.middleware';
import { authorize } from '../middleware/auth';
import {
  validateRequest,
  handleAsync,
} from '../middleware/validation.middleware';
import { currencyService } from '../services/currency.service';
import { UserRole } from '../types';

const router = Router();

// Validation schemas
const createCurrencySchema = z.object({
  code: z
    .string()
    .min(2)
    .max(5)
    .transform(val => val.toUpperCase()),
  name: z.string().min(2).max(100),
  symbol: z.string().min(1).max(10),
  position: z.enum(['before', 'after']).default('before'),
  decimalPlaces: z.number().int().min(0).max(8).default(2),
  isActive: z.boolean().default(true),
  isDefault: z.boolean().default(false),
});

const updateCurrencySchema = z.object({
  code: z
    .string()
    .min(2)
    .max(5)
    .transform(val => val.toUpperCase())
    .optional(),
  name: z.string().min(2).max(100).optional(),
  symbol: z.string().min(1).max(10).optional(),
  position: z.enum(['before', 'after']).optional(),
  decimalPlaces: z.number().int().min(0).max(8).optional(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

const listCurrenciesQuerySchema = z.object({
  search: z.string().optional(),
  isActive: z
    .string()
    .transform(val => val === 'true')
    .optional(),
  page: z.string().transform(Number).default('1'),
  limit: z.string().transform(Number).default('50'),
});

/**
 * @swagger
 * /api/v1/currencies:
 *   get:
 *     summary: Get all currencies
 *     tags: [Currencies]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: isActive
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 */
router.get(
  '/',
  authenticateToken,
  handleAsync(async (req: Request, res: Response) => {
    const query = listCurrenciesQuerySchema.parse(req.query);

    const result = await currencyService.getAll({
      search: query.search,
      isActive: query.isActive,
      page: query.page,
      limit: query.limit,
    });

    res.json({
      success: true,
      message: 'Currencies retrieved successfully',
      data: result,
      timestamp: new Date().toISOString(),
    });
  })
);

/**
 * @swagger
 * /api/v1/currencies/active:
 *   get:
 *     summary: Get all active currencies (for dropdowns)
 *     tags: [Currencies]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/active',
  authenticateToken,
  handleAsync(async (req: Request, res: Response) => {
    const currencies = await currencyService.getActive();

    res.json({
      success: true,
      message: 'Active currencies retrieved successfully',
      data: currencies,
      timestamp: new Date().toISOString(),
    });
  })
);

/**
 * @swagger
 * /api/v1/currencies/default:
 *   get:
 *     summary: Get the default currency
 *     tags: [Currencies]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/default',
  authenticateToken,
  handleAsync(async (req: Request, res: Response) => {
    const currency = await currencyService.getDefault();

    if (!currency) {
      return res.status(404).json({
        success: false,
        message: 'No default currency set',
        error: 'NOT_FOUND',
        timestamp: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      message: 'Default currency retrieved successfully',
      data: currency,
      timestamp: new Date().toISOString(),
    });
  })
);

/**
 * @swagger
 * /api/v1/currencies/seed:
 *   post:
 *     summary: Seed default currencies (Super Admin only)
 *     tags: [Currencies]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/seed',
  authenticateToken,
  authorize(UserRole.SUPER_ADMIN),
  handleAsync(async (req: Request, res: Response) => {
    const results = await currencyService.seedDefaults();

    res.json({
      success: true,
      message: 'Default currencies seeded successfully',
      data: results,
      timestamp: new Date().toISOString(),
    });
  })
);

/**
 * @swagger
 * /api/v1/currencies/{id}:
 *   get:
 *     summary: Get a currency by ID
 *     tags: [Currencies]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/:id',
  authenticateToken,
  handleAsync(async (req: Request, res: Response) => {
    const { id } = req.params;
    const currency = await currencyService.getById(id);

    if (!currency) {
      return res.status(404).json({
        success: false,
        message: 'Currency not found',
        error: 'NOT_FOUND',
        timestamp: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      message: 'Currency retrieved successfully',
      data: currency,
      timestamp: new Date().toISOString(),
    });
  })
);

/**
 * @swagger
 * /api/v1/currencies:
 *   post:
 *     summary: Create a new currency (Super Admin only)
 *     tags: [Currencies]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/',
  authenticateToken,
  authorize(UserRole.SUPER_ADMIN),
  validateRequest(createCurrencySchema),
  handleAsync(async (req: Request, res: Response) => {
    const userId = req.user?.userId;

    const currency = await currencyService.create({
      ...req.body,
      createdBy: userId,
    });

    res.status(201).json({
      success: true,
      message: 'Currency created successfully',
      data: currency,
      timestamp: new Date().toISOString(),
    });
  })
);

/**
 * @swagger
 * /api/v1/currencies/{id}:
 *   patch:
 *     summary: Update a currency (Super Admin only)
 *     tags: [Currencies]
 *     security:
 *       - bearerAuth: []
 */
router.patch(
  '/:id',
  authenticateToken,
  authorize(UserRole.SUPER_ADMIN),
  validateRequest(updateCurrencySchema),
  handleAsync(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = req.user?.userId;

    try {
      const currency = await currencyService.update(id, {
        ...req.body,
        updatedBy: userId,
      });

      res.json({
        success: true,
        message: 'Currency updated successfully',
        data: currency,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      if (error.message.includes('not found')) {
        return res.status(404).json({
          success: false,
          message: error.message,
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }
      throw error;
    }
  })
);

/**
 * @swagger
 * /api/v1/currencies/{id}:
 *   delete:
 *     summary: Delete a currency (Super Admin only)
 *     tags: [Currencies]
 *     security:
 *       - bearerAuth: []
 */
router.delete(
  '/:id',
  authenticateToken,
  authorize(UserRole.SUPER_ADMIN),
  handleAsync(async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
      await currencyService.delete(id);

      res.json({
        success: true,
        message: 'Currency deleted successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      if (error.message.includes('not found')) {
        return res.status(404).json({
          success: false,
          message: error.message,
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }
      if (error.message.includes('default currency')) {
        return res.status(400).json({
          success: false,
          message: error.message,
          error: 'CANNOT_DELETE_DEFAULT',
          timestamp: new Date().toISOString(),
        });
      }
      throw error;
    }
  })
);

/**
 * @swagger
 * /api/v1/currencies/{id}/set-default:
 *   post:
 *     summary: Set a currency as default (Super Admin only)
 *     tags: [Currencies]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/:id/set-default',
  authenticateToken,
  authorize(UserRole.SUPER_ADMIN),
  handleAsync(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = req.user?.userId;

    try {
      const currency = await currencyService.setDefault(id, userId);

      res.json({
        success: true,
        message: 'Currency set as default successfully',
        data: currency,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      if (error.message.includes('not found')) {
        return res.status(404).json({
          success: false,
          message: error.message,
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }
      if (error.message.includes('inactive')) {
        return res.status(400).json({
          success: false,
          message: error.message,
          error: 'CANNOT_SET_INACTIVE_DEFAULT',
          timestamp: new Date().toISOString(),
        });
      }
      throw error;
    }
  })
);

/**
 * @swagger
 * /api/v1/currencies/{id}/toggle-active:
 *   post:
 *     summary: Toggle currency active status (Super Admin only)
 *     tags: [Currencies]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/:id/toggle-active',
  authenticateToken,
  authorize(UserRole.SUPER_ADMIN),
  handleAsync(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = req.user?.userId;

    try {
      const currency = await currencyService.toggleActive(id, userId);

      res.json({
        success: true,
        message: `Currency ${currency.isActive ? 'activated' : 'deactivated'} successfully`,
        data: currency,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      if (error.message.includes('not found')) {
        return res.status(404).json({
          success: false,
          message: error.message,
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }
      if (error.message.includes('default currency')) {
        return res.status(400).json({
          success: false,
          message: error.message,
          error: 'CANNOT_DEACTIVATE_DEFAULT',
          timestamp: new Date().toISOString(),
        });
      }
      throw error;
    }
  })
);

export default router;
