/**
 * Loan Purpose Routes
 * CRUD operations for loan purposes management
 */

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/database';
import { authenticate } from '../middleware/auth-supabase';
import { validateRequest } from '../middleware/validation';
import { loadPermissions, requirePermission } from '../middleware/permissions';
import { PERMISSIONS } from '../constants/permissions';

const router = Router();

// Validation schemas
const createLoanPurposeSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  code: z
    .string()
    .min(2, 'Code must be at least 2 characters')
    .max(20)
    .regex(
      /^[A-Z0-9_]+$/,
      'Code must be uppercase alphanumeric with underscores'
    ),
  description: z.string().max(500).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

const updateLoanPurposeSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  code: z
    .string()
    .min(2)
    .max(20)
    .regex(
      /^[A-Z0-9_]+$/,
      'Code must be uppercase alphanumeric with underscores'
    )
    .optional(),
  description: z.string().max(500).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

/**
 * @swagger
 * /api/v1/loan-purposes:
 *   get:
 *     summary: Get all loan purposes for organization
 *     tags: [Loan Purposes]
 *     security:
 *       - bearerAuth: []
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const organizationId = req.userContext?.organizationId;
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'Organization ID required',
        error: 'MISSING_ORGANIZATION',
        timestamp: new Date().toISOString(),
      });
    }

    const { activeOnly } = req.query;

    const where: any = { organizationId };
    if (activeOnly === 'true') {
      where.isActive = true;
    }

    const purposes = await prisma.loanPurpose.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    res.json({
      success: true,
      message: 'Loan purposes retrieved successfully',
      data: { purposes },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Get loan purposes error:', error);
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
 * /api/v1/loan-purposes/{id}:
 *   get:
 *     summary: Get loan purpose by ID
 *     tags: [Loan Purposes]
 *     security:
 *       - bearerAuth: []
 */
router.get('/:id', authenticate, async (req, res) => {
  try {
    const organizationId = req.userContext?.organizationId;
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'Organization ID required',
        error: 'MISSING_ORGANIZATION',
        timestamp: new Date().toISOString(),
      });
    }

    const purpose = await prisma.loanPurpose.findFirst({
      where: {
        id: req.params.id,
        organizationId,
      },
    });

    if (!purpose) {
      return res.status(404).json({
        success: false,
        message: 'Loan purpose not found',
        error: 'NOT_FOUND',
        timestamp: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      message: 'Loan purpose retrieved successfully',
      data: { purpose },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Get loan purpose error:', error);
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
 * /api/v1/loan-purposes:
 *   post:
 *     summary: Create loan purpose
 *     tags: [Loan Purposes]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/',
  authenticate,
  loadPermissions,
  requirePermission(PERMISSIONS.SETTINGS_UPDATE),
  validateRequest(createLoanPurposeSchema),
  async (req, res) => {
    try {
      const organizationId = req.userContext?.organizationId;
      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization ID required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      const { name, code, description, sortOrder } = req.body;

      // Check for duplicate code
      const existing = await prisma.loanPurpose.findFirst({
        where: { organizationId, code },
      });

      if (existing) {
        return res.status(409).json({
          success: false,
          message: `Loan purpose with code '${code}' already exists`,
          error: 'DUPLICATE_CODE',
          timestamp: new Date().toISOString(),
        });
      }

      const purpose = await prisma.loanPurpose.create({
        data: {
          organizationId,
          name,
          code,
          description,
          sortOrder: sortOrder ?? 0,
        },
      });

      res.status(201).json({
        success: true,
        message: 'Loan purpose created successfully',
        data: { purpose },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Create loan purpose error:', error);
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
 * /api/v1/loan-purposes/{id}:
 *   put:
 *     summary: Update loan purpose
 *     tags: [Loan Purposes]
 *     security:
 *       - bearerAuth: []
 */
router.put(
  '/:id',
  authenticate,
  loadPermissions,
  requirePermission(PERMISSIONS.SETTINGS_UPDATE),
  validateRequest(updateLoanPurposeSchema),
  async (req, res) => {
    try {
      const organizationId = req.userContext?.organizationId;
      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization ID required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      // Check if exists
      const existing = await prisma.loanPurpose.findFirst({
        where: { id: req.params.id, organizationId },
      });

      if (!existing) {
        return res.status(404).json({
          success: false,
          message: 'Loan purpose not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      // Check for duplicate code if code is being updated
      if (req.body.code && req.body.code !== existing.code) {
        const duplicate = await prisma.loanPurpose.findFirst({
          where: {
            organizationId,
            code: req.body.code,
            id: { not: req.params.id },
          },
        });

        if (duplicate) {
          return res.status(409).json({
            success: false,
            message: `Loan purpose with code '${req.body.code}' already exists`,
            error: 'DUPLICATE_CODE',
            timestamp: new Date().toISOString(),
          });
        }
      }

      const purpose = await prisma.loanPurpose.update({
        where: { id: req.params.id },
        data: req.body,
      });

      res.json({
        success: true,
        message: 'Loan purpose updated successfully',
        data: { purpose },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Update loan purpose error:', error);
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
 * /api/v1/loan-purposes/{id}:
 *   delete:
 *     summary: Delete loan purpose
 *     tags: [Loan Purposes]
 *     security:
 *       - bearerAuth: []
 */
router.delete(
  '/:id',
  authenticate,
  loadPermissions,
  requirePermission(PERMISSIONS.SETTINGS_UPDATE),
  async (req, res) => {
    try {
      const organizationId = req.userContext?.organizationId;
      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization ID required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      // Check if exists
      const existing = await prisma.loanPurpose.findFirst({
        where: { id: req.params.id, organizationId },
      });

      if (!existing) {
        return res.status(404).json({
          success: false,
          message: 'Loan purpose not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      await prisma.loanPurpose.delete({
        where: { id: req.params.id },
      });

      res.json({
        success: true,
        message: 'Loan purpose deleted successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Delete loan purpose error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

// Default loan purposes for seeding
const DEFAULT_LOAN_PURPOSES = [
  {
    code: 'BUSINESS',
    name: 'Business/Working Capital',
    description: 'Loans for business operations, inventory, or working capital',
    sortOrder: 1,
  },
  {
    code: 'EDUCATION',
    name: 'Education',
    description: 'School fees, tuition, books, and educational expenses',
    sortOrder: 2,
  },
  {
    code: 'MEDICAL',
    name: 'Medical/Healthcare',
    description: 'Medical bills, hospital fees, and healthcare expenses',
    sortOrder: 3,
  },
  {
    code: 'AGRICULTURE',
    name: 'Agriculture/Farming',
    description:
      'Farm inputs, equipment, livestock, and agricultural activities',
    sortOrder: 4,
  },
  {
    code: 'HOME_IMPROVEMENT',
    name: 'Home Improvement',
    description: 'Renovations, repairs, and home improvements',
    sortOrder: 5,
  },
  {
    code: 'EMERGENCY',
    name: 'Emergency',
    description: 'Unexpected emergencies and urgent financial needs',
    sortOrder: 6,
  },
  {
    code: 'PERSONAL',
    name: 'Personal/Consumption',
    description: 'Personal expenses and consumption',
    sortOrder: 7,
  },
  {
    code: 'DEBT_CONSOLIDATION',
    name: 'Debt Consolidation',
    description: 'Consolidating existing debts into a single loan',
    sortOrder: 8,
  },
  {
    code: 'ASSET_PURCHASE',
    name: 'Asset Purchase',
    description: 'Purchasing equipment, vehicles, or other assets',
    sortOrder: 9,
  },
  {
    code: 'HOUSING',
    name: 'Housing/Rent',
    description: 'Rental deposits, rent payments, or housing-related expenses',
    sortOrder: 10,
  },
  {
    code: 'WEDDING',
    name: 'Wedding/Events',
    description: 'Wedding ceremonies and major family events',
    sortOrder: 11,
  },
  {
    code: 'TRAVEL',
    name: 'Travel',
    description: 'Travel expenses for work, family, or personal reasons',
    sortOrder: 12,
  },
  {
    code: 'OTHER',
    name: 'Other',
    description: 'Other purposes not listed above',
    sortOrder: 99,
  },
];

/**
 * @swagger
 * /api/v1/loan-purposes/seed:
 *   post:
 *     summary: Seed default loan purposes (ORG_ADMIN only)
 *     tags: [Loan Purposes]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/seed',
  authenticate,
  loadPermissions,
  requirePermission(PERMISSIONS.SETTINGS_UPDATE),
  async (req, res) => {
    try {
      const organizationId = req.userContext?.organizationId;
      const userRole = req.userContext?.role;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization ID required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      // Verify user has ORG_ADMIN or SUPER_ADMIN role
      const hasAdminRole =
        userRole && ['ORG_ADMIN', 'SUPER_ADMIN'].includes(userRole);

      if (!hasAdminRole) {
        return res.status(403).json({
          success: false,
          message: 'Only ORG_ADMIN or SUPER_ADMIN can seed loan purposes',
          error: 'FORBIDDEN',
          timestamp: new Date().toISOString(),
        });
      }

      // Upsert all default loan purposes
      const results = await Promise.all(
        DEFAULT_LOAN_PURPOSES.map(purpose =>
          prisma.loanPurpose.upsert({
            where: {
              organizationId_code: {
                organizationId,
                code: purpose.code,
              },
            },
            update: {
              name: purpose.name,
              description: purpose.description,
              sortOrder: purpose.sortOrder,
              isActive: true,
            },
            create: {
              organizationId,
              code: purpose.code,
              name: purpose.name,
              description: purpose.description,
              sortOrder: purpose.sortOrder,
              isActive: true,
            },
          })
        )
      );

      res.json({
        success: true,
        message: `Successfully seeded ${results.length} loan purposes`,
        data: { purposes: results, count: results.length },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Seed loan purposes error:', error);
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
