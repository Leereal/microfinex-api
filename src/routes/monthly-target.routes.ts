/**
 * Monthly Target Routes
 * API endpoints for managing monthly disbursement and repayment targets
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticateToken } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/auth';
import { handleAsync } from '../middleware/validation.middleware';
import { monthlyTargetService } from '../services/monthly-target.service';
import { Currency, TargetType } from '@prisma/client';
import { PERMISSIONS } from '../constants/permissions';

const router = Router();

// Validation schemas
const createTargetSchema = z.object({
  branchId: z.string().uuid(),
  currency: z.nativeEnum(Currency),
  targetType: z.nativeEnum(TargetType),
  targetAmount: z.number().positive(),
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
  notes: z.string().max(500).optional(),
});

const updateTargetSchema = z.object({
  targetAmount: z.number().positive().optional(),
  notes: z.string().max(500).optional().nullable(),
  isActive: z.boolean().optional(),
});

const bulkUpsertSchema = z.object({
  targets: z.array(
    z.object({
      branchId: z.string().uuid(),
      currency: z.nativeEnum(Currency),
      targetType: z.nativeEnum(TargetType),
      targetAmount: z.number().positive(),
      year: z.number().int().min(2020).max(2100),
      month: z.number().int().min(1).max(12),
      notes: z.string().max(500).optional(),
    })
  ),
});

const listQuerySchema = z.object({
  branchId: z.string().uuid().optional(),
  currency: z.nativeEnum(Currency).optional(),
  targetType: z.nativeEnum(TargetType).optional(),
  year: z
    .string()
    .optional()
    .transform(val => (val ? parseInt(val) : undefined)),
  month: z
    .string()
    .optional()
    .transform(val => (val ? parseInt(val) : undefined)),
  isActive: z
    .string()
    .optional()
    .transform(val =>
      val === 'true' ? true : val === 'false' ? false : undefined
    ),
  page: z
    .string()
    .optional()
    .transform(val => (val ? parseInt(val) : 1)),
  limit: z
    .string()
    .optional()
    .transform(val => (val ? parseInt(val) : 50)),
});

const progressQuerySchema = z.object({
  year: z
    .string()
    .optional()
    .transform(val => (val ? parseInt(val) : new Date().getFullYear())),
  month: z
    .string()
    .optional()
    .transform(val => (val ? parseInt(val) : new Date().getMonth() + 1)),
  branchId: z.string().uuid().optional(),
  currency: z.nativeEnum(Currency).optional(),
  targetType: z.nativeEnum(TargetType).optional(),
});

const historicalQuerySchema = z.object({
  branchId: z.string().uuid().optional(),
  currency: z.nativeEnum(Currency).optional(),
  targetType: z.nativeEnum(TargetType).optional(),
  months: z
    .string()
    .optional()
    .transform(val => (val ? parseInt(val) : 12)),
});

// All routes require authentication
router.use(authenticateToken);

/**
 * @route GET /api/v1/monthly-targets
 * @desc Get all monthly targets with optional filters
 */
router.get(
  '/',
  requirePermission(PERMISSIONS.REPORTS_VIEW),
  handleAsync(async (req: Request, res: Response) => {
    const query = listQuerySchema.parse(req.query);
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        error: 'Organization ID required',
      });
    }

    const result = await monthlyTargetService.getAll({
      organizationId,
      ...query,
    });

    res.json({
      success: true,
      ...result,
    });
  })
);

/**
 * @route GET /api/v1/monthly-targets/progress
 * @desc Get target progress for a specific month
 */
router.get(
  '/progress',
  requirePermission(PERMISSIONS.REPORTS_VIEW),
  handleAsync(async (req: Request, res: Response) => {
    const query = progressQuerySchema.parse(req.query);
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        error: 'Organization ID required',
      });
    }

    const progress = await monthlyTargetService.getTargetProgress(
      organizationId,
      query.year!,
      query.month!,
      query.branchId,
      query.currency,
      query.targetType
    );

    res.json({
      success: true,
      data: progress,
    });
  })
);

/**
 * @route GET /api/v1/monthly-targets/summary
 * @desc Get organization-wide target summary for a specific month
 */
router.get(
  '/summary',
  requirePermission(PERMISSIONS.REPORTS_VIEW),
  handleAsync(async (req: Request, res: Response) => {
    const query = progressQuerySchema.parse(req.query);
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        error: 'Organization ID required',
      });
    }

    const summary = await monthlyTargetService.getOrganizationSummary(
      organizationId,
      query.year!,
      query.month!,
      query.currency,
      query.targetType
    );

    res.json({
      success: true,
      data: summary,
    });
  })
);

/**
 * @route GET /api/v1/monthly-targets/dashboard
 * @desc Get dashboard summary for current month
 */
router.get(
  '/dashboard',
  requirePermission(PERMISSIONS.DASHBOARD_VIEW),
  handleAsync(async (req: Request, res: Response) => {
    const organizationId = req.user?.organizationId;
    const branchId = (req.query.branchId as string) || undefined;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        error: 'Organization ID required',
      });
    }

    const summary = await monthlyTargetService.getDashboardSummary(
      organizationId,
      branchId
    );

    res.json({
      success: true,
      data: summary,
    });
  })
);

/**
 * @route GET /api/v1/monthly-targets/historical
 * @desc Get historical target data for trend analysis
 */
router.get(
  '/historical',
  requirePermission(PERMISSIONS.REPORTS_VIEW),
  handleAsync(async (req: Request, res: Response) => {
    const query = historicalQuerySchema.parse(req.query);
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        error: 'Organization ID required',
      });
    }

    const data = await monthlyTargetService.getHistoricalData(
      organizationId,
      query.branchId,
      query.currency,
      query.targetType,
      query.months
    );

    res.json({
      success: true,
      data,
    });
  })
);

/**
 * @route GET /api/v1/monthly-targets/:id
 * @desc Get a single monthly target by ID
 */
router.get(
  '/:id',
  requirePermission(PERMISSIONS.REPORTS_VIEW),
  handleAsync(async (req: Request, res: Response) => {
    const { id } = req.params;
    const organizationId = req.user?.organizationId;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Target ID required',
      });
    }

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        error: 'Organization ID required',
      });
    }

    const target = await monthlyTargetService.getById(id, organizationId);

    if (!target) {
      return res.status(404).json({
        success: false,
        error: 'Target not found',
      });
    }

    res.json({
      success: true,
      data: target,
    });
  })
);

/**
 * @route POST /api/v1/monthly-targets
 * @desc Create a new monthly target
 */
router.post(
  '/',
  requirePermission(PERMISSIONS.SETTINGS_UPDATE),
  handleAsync(async (req: Request, res: Response) => {
    const data = createTargetSchema.parse(req.body);
    const organizationId = req.user?.organizationId;
    const userId = req.user?.id;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        error: 'Organization ID required',
      });
    }

    const target = await monthlyTargetService.create({
      ...data,
      organizationId,
      createdBy: userId,
    });

    res.status(201).json({
      success: true,
      data: target,
    });
  })
);

/**
 * @route POST /api/v1/monthly-targets/upsert
 * @desc Create or update a monthly target
 */
router.post(
  '/upsert',
  requirePermission(PERMISSIONS.SETTINGS_UPDATE),
  handleAsync(async (req: Request, res: Response) => {
    const data = createTargetSchema.parse(req.body);
    const organizationId = req.user?.organizationId;
    const userId = req.user?.id;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        error: 'Organization ID required',
      });
    }

    const target = await monthlyTargetService.upsert({
      ...data,
      organizationId,
      createdBy: userId,
    });

    res.json({
      success: true,
      data: target,
    });
  })
);

/**
 * @route POST /api/v1/monthly-targets/bulk
 * @desc Bulk create or update multiple targets
 */
router.post(
  '/bulk',
  requirePermission(PERMISSIONS.SETTINGS_UPDATE),
  handleAsync(async (req: Request, res: Response) => {
    const { targets } = bulkUpsertSchema.parse(req.body);
    const organizationId = req.user?.organizationId;
    const userId = req.user?.id;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        error: 'Organization ID required',
      });
    }

    const results = await monthlyTargetService.bulkUpsert(
      organizationId,
      targets,
      userId
    );

    res.json({
      success: true,
      data: results,
      message: `${results.length} targets saved successfully`,
    });
  })
);

/**
 * @route PUT /api/v1/monthly-targets/:id
 * @desc Update a monthly target
 */
router.put(
  '/:id',
  requirePermission(PERMISSIONS.SETTINGS_UPDATE),
  handleAsync(async (req: Request, res: Response) => {
    const { id } = req.params;
    const data = updateTargetSchema.parse(req.body);
    const organizationId = req.user?.organizationId;
    const userId = req.user?.id;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Target ID required',
      });
    }

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        error: 'Organization ID required',
      });
    }

    const target = await monthlyTargetService.update(id, organizationId, {
      ...data,
      updatedBy: userId,
    });

    res.json({
      success: true,
      data: target,
    });
  })
);

/**
 * @route DELETE /api/v1/monthly-targets/:id
 * @desc Delete a monthly target
 */
router.delete(
  '/:id',
  requirePermission(PERMISSIONS.SETTINGS_UPDATE),
  handleAsync(async (req: Request, res: Response) => {
    const { id } = req.params;
    const organizationId = req.user?.organizationId;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Target ID required',
      });
    }

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        error: 'Organization ID required',
      });
    }

    await monthlyTargetService.delete(id, organizationId);

    res.json({
      success: true,
      message: 'Target deleted successfully',
    });
  })
);

export default router;
