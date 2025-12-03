import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth-supabase';
import { validateRequest } from '../middleware/validation';
import { UserRole } from '../types';
import { authController } from '../controllers/auth.controller';

const router = Router();

// Validation schemas
const loginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

const registerSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  role: z
    .enum([
      'SUPER_ADMIN',
      'ORG_ADMIN',
      'MANAGER',
      'LOAN_OFFICER',
      'ACCOUNTANT',
      'TELLER',
    ])
    .optional(),
  organizationId: z.string().uuid().optional(),
});

const organizationRegistrationSchema = z.object({
  organization: z.object({
    name: z.string().min(2, 'Organization name must be at least 2 characters'),
    type: z.enum(['MICROFINANCE', 'SACCO', 'BANK', 'CREDIT_UNION', 'FINTECH', 'OTHER']),
    email: z.string().email('Invalid organization email format'),
    phone: z.string().optional(),
    address: z.string().optional(),
    registrationNumber: z.string().optional(),
    licenseNumber: z.string().optional(),
    website: z.string().url().optional().or(z.literal('')),
  }),
  admin: z.object({
    firstName: z.string().min(1, 'First name is required'),
    lastName: z.string().min(1, 'Last name is required'),
    email: z.string().email('Invalid admin email format'),
    phone: z.string().optional(),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
      .regex(/[0-9]/, 'Password must contain at least one number')
      .regex(/[!@#$%^&*]/, 'Password must contain at least one special character'),
  }),
});

const rejectOrganizationSchema = z.object({
  reason: z.string().optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: User login
 *     description: Authenticate user with email and password, returns JWT tokens
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoginResponse'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Invalid credentials
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  '/login',
  validateRequest(loginSchema),
  authController.login.bind(authController)
);

/**
 * @swagger
 * /api/v1/auth/register:
 *   post:
 *     summary: User registration
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [SUPER_ADMIN, ORG_ADMIN, MANAGER, LOAN_OFFICER, ACCOUNTANT, TELLER]
 *               organizationId:
 *                 type: string
 *                 format: uuid
 *             required:
 *               - email
 *               - password
 *               - firstName
 *               - lastName
 */
router.post(
  '/register',
  validateRequest(registerSchema),
  authController.register.bind(authController)
);

/**
 * @swagger
 * /api/v1/auth/register-organization:
 *   post:
 *     summary: Organization registration with first admin user
 *     description: Register a new organization with its first admin user. The organization will be pending approval.
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - organization
 *               - admin
 *             properties:
 *               organization:
 *                 type: object
 *                 required:
 *                   - name
 *                   - type
 *                   - email
 *                 properties:
 *                   name:
 *                     type: string
 *                     description: Organization name
 *                   type:
 *                     type: string
 *                     enum: [MICROFINANCE, SACCO, BANK, CREDIT_UNION, FINTECH, OTHER]
 *                   email:
 *                     type: string
 *                     format: email
 *                   phone:
 *                     type: string
 *                   address:
 *                     type: string
 *                   registrationNumber:
 *                     type: string
 *                   licenseNumber:
 *                     type: string
 *                   website:
 *                     type: string
 *                     format: uri
 *               admin:
 *                 type: object
 *                 required:
 *                   - firstName
 *                   - lastName
 *                   - email
 *                   - password
 *                 properties:
 *                   firstName:
 *                     type: string
 *                   lastName:
 *                     type: string
 *                   email:
 *                     type: string
 *                     format: email
 *                   phone:
 *                     type: string
 *                   password:
 *                     type: string
 *                     minLength: 8
 *     responses:
 *       201:
 *         description: Organization registration submitted successfully
 *       400:
 *         description: Validation error
 *       409:
 *         description: Organization or user already exists
 */
router.post(
  '/register-organization',
  validateRequest(organizationRegistrationSchema),
  authController.registerOrganization.bind(authController)
);

/**
 * @swagger
 * /api/v1/auth/organizations/pending:
 *   get:
 *     summary: Get pending organizations
 *     description: Get all organizations pending approval (SUPER_ADMIN only)
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of pending organizations
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - requires SUPER_ADMIN role
 */
router.get(
  '/organizations/pending',
  authenticate,
  authorize(UserRole.SUPER_ADMIN),
  authController.getPendingOrganizations.bind(authController)
);

/**
 * @swagger
 * /api/v1/auth/organizations/{id}/approve:
 *   post:
 *     summary: Approve organization
 *     description: Approve a pending organization and promote the first user to ORG_ADMIN (SUPER_ADMIN only)
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Organization ID
 *     responses:
 *       200:
 *         description: Organization approved successfully
 *       400:
 *         description: Organization already active
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - requires SUPER_ADMIN role
 *       404:
 *         description: Organization not found
 */
router.post(
  '/organizations/:id/approve',
  authenticate,
  authorize(UserRole.SUPER_ADMIN),
  authController.approveOrganization.bind(authController)
);

/**
 * @swagger
 * /api/v1/auth/organizations/{id}/reject:
 *   post:
 *     summary: Reject organization
 *     description: Reject a pending organization registration and delete all associated data (SUPER_ADMIN only)
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Organization ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 description: Reason for rejection
 *     responses:
 *       200:
 *         description: Organization rejected successfully
 *       400:
 *         description: Cannot reject an active organization
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - requires SUPER_ADMIN role
 *       404:
 *         description: Organization not found
 */
router.post(
  '/organizations/:id/reject',
  authenticate,
  authorize(UserRole.SUPER_ADMIN),
  validateRequest(rejectOrganizationSchema),
  authController.rejectOrganization.bind(authController)
);

/**
 * @swagger
 * /api/v1/auth/logout:
 *   post:
 *     summary: User logout
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/logout',
  authenticate,
  authController.logout.bind(authController)
);

/**
 * @swagger
 * /api/v1/auth/me:
 *   get:
 *     summary: Get current user profile
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 */
router.get('/me', authenticate, authController.getProfile.bind(authController));

/**
 * @swagger
 * /api/v1/auth/change-password:
 *   post:
 *     summary: Change password
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/change-password',
  authenticate,
  validateRequest(changePasswordSchema),
  authController.changePassword.bind(authController)
);

/**
 * @swagger
 * /api/v1/auth/api-key:
 *   post:
 *     summary: Generate API key
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/api-key',
  authenticate,
  authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN),
  authController.generateApiKey.bind(authController)
);

export default router;
