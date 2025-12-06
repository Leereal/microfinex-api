/**
 * Expense Category Routes
 * API endpoints for expense category management
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticateToken } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/auth';
import { handleAsync } from '../middleware/validation.middleware';
import {
  expenseCategoryService,
  UpdateExpenseCategoryInput,
} from '../services/expense-category.service';
import { PERMISSIONS } from '../constants/permissions';

const router = Router();

// Validation schemas
const createExpenseCategorySchema = z.object({
  name: z.string().min(2).max(100),
  code: z
    .string()
    .min(2)
    .max(20)
    .transform(val => val.toUpperCase()),
  description: z.string().max(500).optional(),
  isActive: z.boolean().default(true),
});

const updateExpenseCategorySchema = z.object({
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
 * /api/v1/expense-categories:
 *   get:
 *     summary: Get all expense categories for the organization
 *     tags: [Expense Categories]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/',
  authenticateToken,
  requirePermission(PERMISSIONS.EXPENSE_CATEGORIES_VIEW),
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

    const result = await expenseCategoryService.getAll({
      organizationId,
      search: query.search,
      isActive: query.isActive,
      isSystemCategory: query.isSystemCategory,
      page: query.page,
      limit: query.limit,
    });

    res.json({
      success: true,
      message: 'Expense categories retrieved successfully',
      data: result,
      timestamp: new Date().toISOString(),
    });
  })
);

/**
 * @swagger
 * /api/v1/expense-categories/active:
 *   get:
 *     summary: Get all active expense categories (for dropdowns)
 *     tags: [Expense Categories]
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

    const categories = await expenseCategoryService.getActive(organizationId);

    res.json({
      success: true,
      message: 'Active expense categories retrieved successfully',
      data: categories,
      timestamp: new Date().toISOString(),
    });
  })
);

/**
 * @swagger
 * /api/v1/expense-categories/seed:
 *   post:
 *     summary: Seed default expense categories for the organization
 *     tags: [Expense Categories]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/seed',
  authenticateToken,
  requirePermission(PERMISSIONS.EXPENSE_CATEGORIES_CREATE),
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

    const result = await expenseCategoryService.seedDefaults(
      organizationId!,
      userId
    );

    res.status(201).json({
      success: true,
      message: `Created ${result.length} default expense categories`,
      data: result,
      timestamp: new Date().toISOString(),
    });
  })
);

/**
 * @swagger
 * /api/v1/expense-categories/{id}:
 *   get:
 *     summary: Get an expense category by ID
 *     tags: [Expense Categories]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/:id',
  authenticateToken,
  requirePermission(PERMISSIONS.EXPENSE_CATEGORIES_VIEW),
  handleAsync(async (req: Request, res: Response) => {
    const id: string = req.params.id!;
    const organizationId: string = req.user!.organizationId!;

    const category = await expenseCategoryService.getById(id, organizationId);

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Expense category not found',
        error: 'NOT_FOUND',
      });
    }

    res.json({
      success: true,
      message: 'Expense category retrieved successfully',
      data: category,
      timestamp: new Date().toISOString(),
    });
  })
);

/**
 * @swagger
 * /api/v1/expense-categories:
 *   post:
 *     summary: Create a new expense category
 *     tags: [Expense Categories]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/',
  authenticateToken,
  requirePermission(PERMISSIONS.EXPENSE_CATEGORIES_CREATE),
  handleAsync(async (req: Request, res: Response) => {
    const data = createExpenseCategorySchema.parse(req.body);
    const organizationId = req.user!.organizationId!;
    const userId = req.user!.userId;

    const category = await expenseCategoryService.create({
      ...data,
      organizationId,
      createdBy: userId,
    });

    res.status(201).json({
      success: true,
      message: 'Expense category created successfully',
      data: category,
      timestamp: new Date().toISOString(),
    });
  })
);

/**
 * @swagger
 * /api/v1/expense-categories/{id}:
 *   put:
 *     summary: Update an expense category
 *     tags: [Expense Categories]
 *     security:
 *       - bearerAuth: []
 */
router.put(
  '/:id',
  authenticateToken,
  requirePermission(PERMISSIONS.EXPENSE_CATEGORIES_UPDATE),
  handleAsync(async (req: Request, res: Response) => {
    const id: string = req.params.id!;
    const data = updateExpenseCategorySchema.parse(
      req.body
    ) as UpdateExpenseCategoryInput;
    const organizationId: string = req.user!.organizationId!;

    const category = await expenseCategoryService.update(
      id,
      organizationId,
      data
    );

    res.json({
      success: true,
      message: 'Expense category updated successfully',
      data: category,
      timestamp: new Date().toISOString(),
    });
  })
);

/**
 * @swagger
 * /api/v1/expense-categories/{id}:
 *   delete:
 *     summary: Delete an expense category
 *     tags: [Expense Categories]
 *     security:
 *       - bearerAuth: []
 */
router.delete(
  '/:id',
  authenticateToken,
  requirePermission(PERMISSIONS.EXPENSE_CATEGORIES_DELETE),
  handleAsync(async (req: Request, res: Response) => {
    const id: string = req.params.id!;
    const organizationId: string = req.user!.organizationId!;

    await expenseCategoryService.delete(id, organizationId);

    res.json({
      success: true,
      message: 'Expense category deleted successfully',
      timestamp: new Date().toISOString(),
    });
  })
);

export default router;
