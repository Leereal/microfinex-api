import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth-supabase';
import { validateRequest, validateQuery } from '../middleware/validation';
import { UserRole } from '../types';
import { userController } from '../controllers/user.controller';

const router = Router();

// Validation schemas
const createUserSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  role: z
    .enum([
      'SUPER_ADMIN',
      'ADMIN',
      'ORG_ADMIN',
      'MANAGER',
      'LOAN_OFFICER',
      'ACCOUNTANT',
      'TELLER',
      'STAFF',
    ])
    .optional(),
  organizationId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  phone: z.string().optional(),
});

const updateUserSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  role: z
    .enum([
      'SUPER_ADMIN',
      'ADMIN',
      'ORG_ADMIN',
      'MANAGER',
      'LOAN_OFFICER',
      'ACCOUNTANT',
      'TELLER',
      'STAFF',
    ])
    .optional(),
  branchId: z.string().uuid().nullable().optional(),
  phone: z.string().optional(),
  isActive: z.boolean().optional(),
});

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
  role: z
    .enum([
      'SUPER_ADMIN',
      'ADMIN',
      'ORG_ADMIN',
      'MANAGER',
      'LOAN_OFFICER',
      'ACCOUNTANT',
      'TELLER',
      'STAFF',
    ])
    .optional(),
  isActive: z
    .string()
    .transform(val => val === 'true')
    .pipe(z.boolean())
    .optional(),
  branchId: z.string().uuid().optional(),
  // Super Admin can filter by organization
  organizationId: z.string().uuid().optional(),
});

/**
 * @swagger
 * /api/v1/users:
 *   get:
 *     summary: Get all users
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/',
  authenticate,
  validateQuery(querySchema),
  userController.getAll.bind(userController)
);

/**
 * @swagger
 * /api/v1/users/statistics:
 *   get:
 *     summary: Get user statistics
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/statistics',
  authenticate,
  authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER),
  userController.getStatistics.bind(userController)
);

/**
 * @swagger
 * /api/v1/users/pending-verification:
 *   get:
 *     summary: Get users pending email verification
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/pending-verification',
  authenticate,
  authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN),
  userController.getPendingVerification.bind(userController)
);

/**
 * @swagger
 * /api/v1/users/{id}:
 *   get:
 *     summary: Get user by ID
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 */
router.get('/:id', authenticate, userController.getById.bind(userController));

/**
 * @swagger
 * /api/v1/users:
 *   post:
 *     summary: Create new user
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/',
  authenticate,
  authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER),
  validateRequest(createUserSchema),
  userController.create.bind(userController)
);

/**
 * @swagger
 * /api/v1/users/{id}:
 *   put:
 *     summary: Update user
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 */
router.put(
  '/:id',
  authenticate,
  authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER),
  validateRequest(updateUserSchema),
  userController.update.bind(userController)
);

/**
 * @swagger
 * /api/v1/users/{id}/status:
 *   patch:
 *     summary: Update user active status
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 */
router.patch(
  '/:id/status',
  authenticate,
  authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN),
  userController.updateStatus.bind(userController)
);

/**
 * @swagger
 * /api/v1/users/{id}/branch:
 *   patch:
 *     summary: Assign user to branch
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 */
router.patch(
  '/:id/branch',
  authenticate,
  authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER),
  userController.assignToBranch.bind(userController)
);

/**
 * @swagger
 * /api/v1/users/{id}/reset-password:
 *   post:
 *     summary: Reset user password (admin action)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/:id/reset-password',
  authenticate,
  authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN),
  userController.resetPassword.bind(userController)
);

/**
 * @swagger
 * /api/v1/users/{id}/verify-email:
 *   post:
 *     summary: Manually verify user email (Super Admin only)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/:id/verify-email',
  authenticate,
  authorize(UserRole.SUPER_ADMIN),
  userController.verifyEmail.bind(userController)
);

/**
 * @swagger
 * /api/v1/users/{id}/unverify-email:
 *   post:
 *     summary: Revoke user email verification (Super Admin only)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/:id/unverify-email',
  authenticate,
  authorize(UserRole.SUPER_ADMIN),
  userController.unverifyEmail.bind(userController)
);

/**
 * @swagger
 * /api/v1/users/{id}:
 *   delete:
 *     summary: Delete user
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 */
router.delete(
  '/:id',
  authenticate,
  authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN),
  userController.delete.bind(userController)
);

export default router;
