import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/database';
import { authenticate, authorize } from '../middleware/auth-supabase';
import { validateRequest, validateQuery } from '../middleware/validation';
import { UserRole } from '../types';

const router = Router();

// Validation schemas
const createOrganizationSchema = z.object({
  name: z.string().min(1, 'Organization name is required'),
  type: z.enum(['MICROFINANCE', 'BANK', 'CREDIT_UNION', 'COOPERATIVE']),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email('Valid email is required').optional(),
  website: z.string().url('Valid URL is required').optional(),
  registrationNumber: z.string().optional(),
  licenseNumber: z.string().optional(),
  isActive: z.boolean().optional(),
  apiTier: z.enum(['BASIC', 'PROFESSIONAL', 'ENTERPRISE']).optional(),
  maxApiKeys: z.number().int().positive().optional(),
  rateLimit: z.number().int().positive().optional(),
});

const updateOrganizationSchema = createOrganizationSchema.partial();

const querySchema = z.object({
  page: z
    .string()
    .transform(val => parseInt(val, 10))
    .pipe(z.number().min(1))
    .optional(),
  limit: z
    .string()
    .transform(val => parseInt(val, 10))
    .pipe(z.number().min(1).max(100))
    .optional(),
  search: z.string().optional(),
  type: z
    .enum(['MICROFINANCE', 'BANK', 'CREDIT_UNION', 'COOPERATIVE'])
    .optional(),
  isActive: z
    .string()
    .transform(val => val === 'true')
    .pipe(z.boolean())
    .optional(),
});

/**
 * @swagger
 * /api/v1/organizations:
 *   get:
 *     summary: Get all organizations
 *     tags: [Organizations]
 *     security:
 *       - bearerAuth: []
 */
router.get('/', authenticate, validateQuery(querySchema), async (req, res) => {
  try {
    const { page = 1, limit = 10, search, type, isActive } = req.query;
    const pageNum = Number(page);
    const limitNum = Number(limit);
    const skip = (pageNum - 1) * limitNum;

    // Build where clause
    const where: any = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { registrationNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (type) {
      where.type = type;
    }

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    // For non-super admins, filter by their organization
    if (req.user?.role !== UserRole.SUPER_ADMIN) {
      where.id = req.user?.organizationId;
    }

    const [organizations, total] = await Promise.all([
      prisma.organization.findMany({
        where,
        skip,
        take: limitNum,
        include: {
          branches: {
            select: {
              id: true,
              name: true,
            },
          },
          _count: {
            select: {
              users: true,
              clients: true,
              loans: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.organization.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limitNum);

    res.json({
      success: true,
      message: 'Organizations retrieved successfully',
      data: {
        organizations,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: totalPages,
          hasNext: pageNum < totalPages,
          hasPrev: pageNum > 1,
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Get organizations error:', error);
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
 * /api/v1/organizations/{id}:
 *   get:
 *     summary: Get organization by ID
 *     tags: [Organizations]
 *     security:
 *       - bearerAuth: []
 */
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    // Check permissions
    if (
      req.user?.role !== UserRole.SUPER_ADMIN &&
      req.user?.organizationId !== id
    ) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
        error: 'FORBIDDEN',
        timestamp: new Date().toISOString(),
      });
    }

    const organization = await prisma.organization.findUnique({
      where: { id: id as string },
      include: {
        branches: {
          include: {
            _count: {
              select: {
                users: true,
                clients: true,
              },
            },
          },
        },
        _count: {
          select: {
            users: true,
            clients: true,
            loans: true,
            apiKeys: true,
          },
        },
      },
    });

    if (!organization) {
      return res.status(404).json({
        success: false,
        message: 'Organization not found',
        error: 'NOT_FOUND',
        timestamp: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      message: 'Organization retrieved successfully',
      data: { organization },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Get organization error:', error);
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
 * /api/v1/organizations:
 *   post:
 *     summary: Create new organization
 *     tags: [Organizations]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/',
  authenticate,
  authorize(UserRole.SUPER_ADMIN),
  validateRequest(createOrganizationSchema),
  async (req, res) => {
    try {
      const organizationData = req.body;

      // Check if organization with same name or email exists
      const existingOrg = await prisma.organization.findFirst({
        where: {
          OR: [
            { name: organizationData.name },
            { email: organizationData.email },
          ],
        },
      });

      if (existingOrg) {
        return res.status(409).json({
          success: false,
          message: 'Organization with this name or email already exists',
          error: 'ORGANIZATION_EXISTS',
          timestamp: new Date().toISOString(),
        });
      }

      const organization = await prisma.organization.create({
        data: {
          ...organizationData,
          isActive: true, // Set active by default
        },
        include: {
          _count: {
            select: {
              users: true,
              clients: true,
              loans: true,
            },
          },
        },
      });

      res.status(201).json({
        success: true,
        message: 'Organization created successfully',
        data: { organization },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Create organization error:', error);
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
 * /api/v1/organizations/{id}:
 *   put:
 *     summary: Update organization
 *     tags: [Organizations]
 *     security:
 *       - bearerAuth: []
 */
router.put(
  '/:id',
  authenticate,
  authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN),
  validateRequest(updateOrganizationSchema),
  async (req, res) => {
    try {
      const { id } = req.params;
      const updateData = req.body;

      // Check permissions
      if (
        req.user?.role !== UserRole.SUPER_ADMIN &&
        req.user?.organizationId !== id
      ) {
        return res.status(403).json({
          success: false,
          message: 'Access denied',
          error: 'FORBIDDEN',
          timestamp: new Date().toISOString(),
        });
      }

      // Check if organization exists
      const existingOrg = await prisma.organization.findUnique({
        where: { id: id as string },
      });

      if (!existingOrg) {
        return res.status(404).json({
          success: false,
          message: 'Organization not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      const organization = await prisma.organization.update({
        where: { id: id as string },
        data: updateData,
        include: {
          _count: {
            select: {
              users: true,
              clients: true,
              loans: true,
            },
          },
        },
      });

      res.json({
        success: true,
        message: 'Organization updated successfully',
        data: { organization },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Update organization error:', error);
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
 * /api/v1/organizations/{id}/status:
 *   patch:
 *     summary: Update organization active status
 *     tags: [Organizations]
 *     security:
 *       - bearerAuth: []
 */
router.patch(
  '/:id/status',
  authenticate,
  authorize(UserRole.SUPER_ADMIN),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { isActive } = req.body;

      if (typeof isActive !== 'boolean') {
        return res.status(400).json({
          success: false,
          message: 'isActive must be a boolean value',
          error: 'INVALID_STATUS',
          timestamp: new Date().toISOString(),
        });
      }

      const organization = await prisma.organization.update({
        where: { id: id as string },
        data: { isActive },
      });

      res.json({
        success: true,
        message: 'Organization status updated successfully',
        data: { organization },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Update organization status error:', error);
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
