/**
 * Income Category Routes
 * API endpoints for income category management
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticateToken } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/auth';
import { handleAsync } from '../middleware/validation.middleware';
import {
  incomeCategoryService,
  UpdateIncomeCategoryInput,
} from '../services/income-category.service';
import { PERMISSIONS } from '../constants/permissions';

const router = Router();

// Validation schemas
const createIncomeCategorySchema = z.object({
  name: z.string().min(2).max(100),
  code: z
    .string()
    .min(2)
    .max(20)
    .transform(val => val.toUpperCase()),
  description: z.string().max(500).optional(),
  isActive: z.boolean().default(true),
});

const updateIncomeCategorySchema = z.object({
  name: z.string().min(2).max(100).optional(),
  code: z
    .string()
    .min(2)
    .max(20)
    .transform(val => val.toUpperCase())
    .optional(),
  description: z.string().max(500).optional().nullable(),
  isActive: z.boolean().optional(),
});

const listCategoriesQuerySchema = z.object({
  search: z.string().optional(),
  isActive: z
    .string()
    .transform(val => val === 'true')
    .optional(),
  isSystemCategory: z
    .string()
    .transform(val => val === 'true')
    .optional(),
  page: z.string().transform(Number).default('1'),
  limit: z.string().transform(Number).default('50'),
});

/**
 * @swagger
 * /api/v1/income-categories:
 *   get:
 *     summary: Get all income categories for the organization
 *     tags: [Income Categories]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/',
  authenticateToken,
  requirePermission(PERMISSIONS.INCOME_CATEGORIES_VIEW),
  handleAsync(async (req: Request, res: Response) => {
    const query = listCategoriesQuerySchema.parse(req.query);
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'Organization ID required',
        error: 'MISSING_ORGANIZATION',
      });
    }

    const result = await incomeCategoryService.getAll({
      organizationId,
      search: query.search,
      isActive: query.isActive,
      isSystemCategory: query.isSystemCategory,
      page: query.page,
      limit: query.limit,
    });

    res.json({
      success: true,
      message: 'Income categories retrieved successfully',
      data: result,
      timestamp: new Date().toISOString(),
    });
  })
);

/**
 * @swagger
 * /api/v1/income-categories/active:
 *   get:
 *     summary: Get all active income categories (for dropdowns)
 *     tags: [Income Categories]
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

    const categories = await incomeCategoryService.getActive(organizationId);

    res.json({
      success: true,
      message: 'Active income categories retrieved successfully',
      data: categories,
      timestamp: new Date().toISOString(),
    });
  })
);

/**
 * @swagger
 * /api/v1/income-categories/seed:
 *   post:
 *     summary: Seed default income categories for the organization
 *     tags: [Income Categories]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/seed',
  authenticateToken,
  requirePermission(PERMISSIONS.INCOME_CATEGORIES_CREATE),
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

    const result = await incomeCategoryService.seedDefaults(
      organizationId!,
      userId
    );

    res.status(201).json({
      success: true,
      message: `Created ${result.length} default income categories`,
      data: result,
      timestamp: new Date().toISOString(),
    });
  })
);

/**
 * @swagger
 * /api/v1/income-categories/{id}:
 *   get:
 *     summary: Get an income category by ID
 *     tags: [Income Categories]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/:id',
  authenticateToken,
  requirePermission(PERMISSIONS.INCOME_CATEGORIES_VIEW),
  handleAsync(async (req: Request, res: Response) => {
    const id: string = req.params.id!;
    const organizationId: string = req.user!.organizationId!;

    const category = await incomeCategoryService.getById(id, organizationId);

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Income category not found',
        error: 'NOT_FOUND',
      });
    }

    res.json({
      success: true,
      message: 'Income category retrieved successfully',
      data: category,
      timestamp: new Date().toISOString(),
    });
  })
);

/**
 * @swagger
 * /api/v1/income-categories:
 *   post:
 *     summary: Create a new income category
 *     tags: [Income Categories]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/',
  authenticateToken,
  requirePermission(PERMISSIONS.INCOME_CATEGORIES_CREATE),
  handleAsync(async (req: Request, res: Response) => {
    const data = createIncomeCategorySchema.parse(req.body);
    const organizationId = req.user!.organizationId!;
    const userId = req.user!.userId;

    const category = await incomeCategoryService.create({
      ...data,
      organizationId,
      createdBy: userId,
    });

    res.status(201).json({
      success: true,
      message: 'Income category created successfully',
      data: category,
      timestamp: new Date().toISOString(),
    });
  })
);

/**
 * @swagger
 * /api/v1/income-categories/{id}:
 *   put:
 *     summary: Update an income category
 *     tags: [Income Categories]
 *     security:
 *       - bearerAuth: []
 */
router.put(
  '/:id',
  authenticateToken,
  requirePermission(PERMISSIONS.INCOME_CATEGORIES_UPDATE),
  handleAsync(async (req: Request, res: Response) => {
    const id: string = req.params.id!;
    const data = updateIncomeCategorySchema.parse(
      req.body
    ) as UpdateIncomeCategoryInput;
    const organizationId: string = req.user!.organizationId!;

    const category = await incomeCategoryService.update(
      id,
      organizationId,
      data
    );

    res.json({
      success: true,
      message: 'Income category updated successfully',
      data: category,
      timestamp: new Date().toISOString(),
    });
  })
);

/**
 * @swagger
 * /api/v1/income-categories/{id}:
 *   delete:
 *     summary: Delete an income category
 *     tags: [Income Categories]
 *     security:
 *       - bearerAuth: []
 */
router.delete(
  '/:id',
  authenticateToken,
  requirePermission(PERMISSIONS.INCOME_CATEGORIES_DELETE),
  handleAsync(async (req: Request, res: Response) => {
    const id: string = req.params.id!;
    const organizationId: string = req.user!.organizationId!;

    await incomeCategoryService.delete(id, organizationId);

    res.json({
      success: true,
      message: 'Income category deleted successfully',
      timestamp: new Date().toISOString(),
    });
  })
);

export default router;
