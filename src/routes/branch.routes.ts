/**
 * Branch Routes
 * API endpoints for branch/office management
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/database';
import {
  authenticateToken,
  requirePermission,
} from '../middleware/auth.middleware';
import {
  validateRequest,
  validateQuery,
  validateFullRequest,
  handleAsync,
} from '../middleware/validation.middleware';

const router = Router();

// Type alias for route handlers with user
type RouteHandler = (req: Request, res: Response) => Promise<any>;

// All branch routes require authentication
router.use(authenticateToken);

/**
 * Create a new branch
 * POST /api/branches
 */
const createBranchBodySchema = z.object({
  name: z.string().min(2, 'Branch name required'),
  code: z.string().max(10).optional().default(''),
  address: z.string().optional(),
  city: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  managerId: z.string().uuid().optional(),
  isActive: z.boolean().default(true),
  metadata: z.record(z.any()).optional(),
});

router.post(
  '/',
  requirePermission('branch:create'),
  validateRequest(createBranchBodySchema),
  handleAsync(async (req: Request, res: Response) => {
    const organizationId = req.user!.organizationId;
    const userId = req.user!.userId;

    // Check if user has an organization
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message:
          'User is not associated with an organization. Please contact your administrator.',
        error: 'NO_ORGANIZATION',
      });
    }

    // Check for duplicate code (only if code is provided)
    if (req.body.code) {
      const existing = await prisma.branch.findFirst({
        where: {
          organizationId,
          code: req.body.code,
          isActive: true,
        },
      });

      if (existing) {
        return res.status(400).json({
          success: false,
          message: 'Branch code already exists',
        });
      }
    }

    const branch = await prisma.branch.create({
      data: {
        ...req.body,
        organizationId,
        createdById: userId,
        createdAt: new Date(),
      },
    });

    res.status(201).json({
      success: true,
      data: branch,
    });
  })
);

/**
 * Get all branches
 * GET /api/branches
 */
const listBranchesQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform(v => parseInt(v || '1')),
  limit: z
    .string()
    .optional()
    .transform(v => parseInt(v || '20')),
  search: z.string().optional(),
  isActive: z.enum(['true', 'false', 'all']).optional(),
  sortBy: z.enum(['name', 'code', 'createdAt']).default('name'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

router.get(
  '/',
  requirePermission('branch:view'),
  validateQuery(listBranchesQuerySchema),
  handleAsync(async (req: Request, res: Response) => {
    const organizationId = req.user!.organizationId;
    const { page, limit, search, isActive, sortBy, sortOrder } = req.query;

    const where: any = {
      organizationId,
    };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { city: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (isActive && isActive !== 'all') {
      where.isActive = isActive === 'true';
    }

    const [branches, total] = await Promise.all([
      prisma.branch.findMany({
        where,
        include: {
          manager: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          _count: {
            select: {
              users: { where: { isActive: true } },
              clients: { where: { isActive: true } },
              loans: { where: { status: 'ACTIVE' } },
            },
          },
        },
        orderBy: { [sortBy as string]: sortOrder },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
      }),
      prisma.branch.count({ where }),
    ]);

    res.json({
      success: true,
      data: branches,
      meta: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  })
);

/**
 * Get branch by ID
 * GET /api/branches/:id
 */
router.get(
  '/:id',
  requirePermission('branch:view'),
  handleAsync(async (req: Request, res: Response) => {
    const organizationId = req.user!.organizationId;

    const branch = await prisma.branch.findFirst({
      where: {
        id: req.params.id,
        organizationId,
        isActive: true,
      },
      include: {
        manager: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        users: {
          where: { isActive: true },
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        _count: {
          select: {
            clients: { where: { isActive: true } },
            loans: true,
          },
        },
      },
    });

    if (!branch) {
      return res.status(404).json({
        success: false,
        message: 'Branch not found',
      });
    }

    res.json({
      success: true,
      data: branch,
    });
  })
);

/**
 * Update branch
 * PUT /api/branches/:id
 */
const updateBranchParamsSchema = z.object({ id: z.string().uuid() });
const updateBranchBodySchema = z.object({
  name: z.string().min(2).optional(),
  code: z.string().max(10).optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  managerId: z.string().uuid().optional().nullable(),
  isActive: z.boolean().optional(),
  metadata: z.record(z.any()).optional(),
});

router.put(
  '/:id',
  requirePermission('branch:update'),
  validateFullRequest({
    params: updateBranchParamsSchema,
    body: updateBranchBodySchema,
  }),
  handleAsync(async (req: Request, res: Response) => {
    const organizationId = req.user!.organizationId;

    const branch = await prisma.branch.findFirst({
      where: {
        id: req.params.id,
        organizationId,
        isActive: true,
      },
    });

    if (!branch) {
      return res.status(404).json({
        success: false,
        message: 'Branch not found',
      });
    }

    // Check code uniqueness if changing
    if (req.body.code && req.body.code !== branch.code) {
      const existing = await prisma.branch.findFirst({
        where: {
          organizationId,
          code: req.body.code,
          id: { not: req.params.id },
          isActive: true,
        },
      });

      if (existing) {
        return res.status(400).json({
          success: false,
          message: 'Branch code already exists',
        });
      }
    }

    const updated = await prisma.branch.update({
      where: { id: req.params.id },
      data: {
        ...req.body,
        updatedAt: new Date(),
      },
    });

    res.json({
      success: true,
      data: updated,
    });
  })
);

/**
 * Delete branch (soft delete)
 * DELETE /api/branches/:id
 */
router.delete(
  '/:id',
  requirePermission('branch:delete'),
  handleAsync(async (req: Request, res: Response) => {
    const organizationId = req.user!.organizationId;

    const branch = await prisma.branch.findFirst({
      where: {
        id: req.params.id,
        organizationId,
        isActive: true,
      },
      include: {
        _count: {
          select: {
            users: { where: { isActive: true } },
            loans: { where: { status: 'ACTIVE' } },
          },
        },
      },
    });

    if (!branch) {
      return res.status(404).json({
        success: false,
        message: 'Branch not found',
      });
    }

    // Check for active users/loans
    if (branch._count.users > 0 || branch._count.loans > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete branch with active users or loans',
      });
    }

    await prisma.branch.update({
      where: { id: req.params.id },
      data: {
        isActive: false,
      },
    });

    res.json({
      success: true,
      message: 'Branch deleted successfully',
    });
  })
);

/**
 * Get branch statistics
 * GET /api/branches/:id/stats
 */
router.get(
  '/:id/stats',
  requirePermission('branch:view'),
  handleAsync(async (req: Request, res: Response) => {
    const organizationId = req.user!.organizationId;

    const branch = await prisma.branch.findFirst({
      where: {
        id: req.params.id,
        organizationId,
        isActive: true,
      },
    });

    if (!branch) {
      return res.status(404).json({
        success: false,
        message: 'Branch not found',
      });
    }

    const [
      totalClients,
      activeLoans,
      overdueLoans,
      totalDisbursed,
      totalOutstanding,
      paymentsThisMonth,
    ] = await Promise.all([
      prisma.client.count({
        where: { branchId: req.params.id, isActive: true },
      }),
      prisma.loan.count({
        where: { branchId: req.params.id, status: 'ACTIVE' },
      }),
      prisma.loan.count({
        where: { branchId: req.params.id, status: 'OVERDUE' },
      }),
      prisma.loan.aggregate({
        where: { branchId: req.params.id },
        _sum: { amount: true },
      }),
      prisma.loan.aggregate({
        where: {
          branchId: req.params.id,
          status: { in: ['ACTIVE', 'OVERDUE'] },
        },
        _sum: { outstandingBalance: true },
      }),
      prisma.payment.aggregate({
        where: {
          loan: { branchId: req.params.id },
          status: 'COMPLETED',
          paymentDate: { gte: new Date(new Date().setDate(1)) },
        },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    res.json({
      success: true,
      data: {
        clients: totalClients,
        activeLoans,
        overdueLoans,
        totalDisbursed: Number(totalDisbursed._sum?.amount || 0),
        totalOutstanding: Number(
          totalOutstanding._sum?.outstandingBalance || 0
        ),
        paymentsThisMonth: {
          count: paymentsThisMonth._count || 0,
          amount: Number(paymentsThisMonth._sum.amount || 0),
        },
      },
    });
  })
);

/**
 * Assign manager to branch
 * POST /api/branches/:id/manager
 */
const assignManagerSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    managerId: z.string().uuid(),
  }),
});

router.post(
  '/:id/manager',
  requirePermission('branch:update'),
  validateRequest(assignManagerSchema),
  handleAsync(async (req: Request, res: Response) => {
    const organizationId = req.user!.organizationId;
    const { managerId } = req.body;

    const branch = await prisma.branch.findFirst({
      where: {
        id: req.params.id,
        organizationId,
        isActive: true,
      },
    });

    if (!branch) {
      return res.status(404).json({
        success: false,
        message: 'Branch not found',
      });
    }

    // Verify manager exists
    const manager = await prisma.user.findFirst({
      where: {
        id: managerId,
        organizationId,
        isActive: true,
      },
    });

    if (!manager) {
      return res.status(404).json({
        success: false,
        message: 'Manager not found',
      });
    }

    await prisma.branch.update({
      where: { id: req.params.id },
      data: {
        managerId,
        updatedAt: new Date(),
      },
    });

    res.json({
      success: true,
      message: 'Manager assigned successfully',
    });
  })
);

export default router;
