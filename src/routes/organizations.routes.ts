import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth-supabase';
import { validateRequest, validateQuery } from '../middleware/validation';
import { UserRole } from '../types';
import { organizationController } from '../controllers/organization.controller';
import { organizationService } from '../services/organization.service';

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
router.get(
  '/',
  authenticate,
  validateQuery(querySchema),
  organizationController.getAll.bind(organizationController)
);

/**
 * @swagger
 * /api/v1/organizations/{id}:
 *   get:
 *     summary: Get organization by ID
 *     tags: [Organizations]
 *     security:
 *       - bearerAuth: []
 */
/**
 * @swagger
 * /api/v1/organizations/current:
 *   get:
 *     summary: The signed-in user's own organization
 *     tags: [Organizations]
 *     security:
 *       - bearerAuth: []
 */
/**
 * Declared before /:id so "current" is not read as an identifier.
 *
 * Callers previously had to know their own organization's id and take it from
 * the auth state, which is not always populated - the disbursement receipt
 * failed with "Missing loan or organization data" for exactly that reason.
 */
router.get('/current', authenticate, async (req, res) => {
  try {
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      return res.status(404).json({
        success: false,
        message: 'You are not attached to an organization.',
        error: 'NO_ORGANIZATION',
        timestamp: new Date().toISOString(),
      });
    }

    const organization = await organizationService.findById(organizationId);

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
    console.error('Get current organization error:', error);
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
 * /api/v1/organizations/current:
 *   put:
 *     summary: Update your own organization's details
 *     tags: [Organizations]
 *     security:
 *       - bearerAuth: []
 */
/**
 * An organization's own administrator could not edit its address, phone or
 * email: the only screen for it lives in the platform admin area, which the
 * admin layout redirects them away from. This is the same update, scoped to
 * their own organization and limited to the fields that are theirs to change -
 * tier, rate limits and active status stay with the platform operator.
 */
router.put(
  '/current',
  authenticate,
  authorize(UserRole.ORG_ADMIN, UserRole.ADMIN, UserRole.SUPER_ADMIN),
  async (req, res) => {
    try {
      const organizationId = req.user?.organizationId;

      if (!organizationId) {
        return res.status(404).json({
          success: false,
          message: 'You are not attached to an organization.',
          error: 'NO_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      const allowed = [
        'name',
        'email',
        'phone',
        'address',
        'website',
        'registrationNumber',
        'licenseNumber',
      ] as const;

      const updateData: Record<string, unknown> = {};
      for (const field of allowed) {
        if (field in req.body) updateData[field] = req.body[field];
      }

      const conflict = await organizationService.findConflict(
        updateData as any,
        organizationId
      );

      if (conflict) {
        return res.status(409).json({
          success: false,
          message: `Another organization (${conflict.organization.name}) already uses this ${conflict.label}`,
          error: 'ORGANIZATION_EXISTS',
          field: conflict.field,
          timestamp: new Date().toISOString(),
        });
      }

      const organization = await organizationService.update(
        organizationId,
        updateData as any
      );

      res.json({
        success: true,
        message: 'Organization updated successfully',
        data: { organization },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Update current organization error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

router.get(
  '/:id',
  authenticate,
  organizationController.getById.bind(organizationController)
);

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
  organizationController.create.bind(organizationController)
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
  organizationController.update.bind(organizationController)
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
  organizationController.updateStatus.bind(organizationController)
);

/**
 * @swagger
 * /api/v1/organizations/{id}/statistics:
 *   get:
 *     summary: Get organization statistics
 *     tags: [Organizations]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/:id/statistics',
  authenticate,
  organizationController.getStatistics.bind(organizationController)
);

/**
 * @swagger
 * /api/v1/organizations/{id}/setup-status:
 *   get:
 *     summary: What this organization still needs before it can operate
 *     tags: [Organizations]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/:id/setup-status',
  authenticate,
  organizationController.getSetupStatus.bind(organizationController)
);

export default router;
