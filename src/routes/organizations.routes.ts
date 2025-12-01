import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth-supabase';
import { validateRequest, validateQuery } from '../middleware/validation';
import { UserRole } from '../types';
import { organizationController } from '../controllers/organization.controller';

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

export default router;
