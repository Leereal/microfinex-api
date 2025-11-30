import { Router } from 'express';
import { z } from 'zod';
import { supabase, supabaseAdmin } from '../config/supabase-enhanced';
import { hashPassword } from '../utils/auth';
import { generateApiKey } from '../utils/security';
import { authenticate, authorize } from '../middleware/auth-supabase';
import { validateRequest } from '../middleware/validation';
import { UserRole } from '../types';

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
router.post('/login', validateRequest(loginSchema), async (req, res) => {
  try {
    const { email, password } = req.body;

    // Authenticate with Supabase
    const { data: authData, error: authError } =
      await supabase.auth.signInWithPassword({
        email,
        password,
      });

    if (authError) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
        error: authError.message,
        timestamp: new Date().toISOString(),
      });
    }

    // Get user from database with organization
    console.log('🔍 Looking up user:', email);
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select(
        `
        *,
        organization:organizations(*)
      `
      )
      .eq('email', email)
      .single();

    console.log('🔍 User lookup result:', {
      userFound: !!user,
      userError: userError?.message,
      userActive: user?.isActive,
      userRole: user?.role,
    });

    if (userError || !user || !user.isActive) {
      console.error('Login failed - User lookup error:', {
        userError,
        userFound: !!user,
        userActive: user?.isActive,
        email,
      });
      return res.status(401).json({
        success: false,
        message: 'User account not found or inactive',
        error: 'UNAUTHORIZED',
        timestamp: new Date().toISOString(),
      });
    }

    // Update last login
    await supabaseAdmin
      .from('users')
      .update({ lastLoginAt: new Date().toISOString() })
      .eq('id', user.id);

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          organization: user.organization,
          lastLoginAt: user.lastLoginAt,
        },
        token: authData.session?.access_token,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Login error:', error);
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
router.post('/register', validateRequest(registerSchema), async (req, res) => {
  try {
    const {
      email,
      password,
      firstName,
      lastName,
      role = 'TELLER',
      organizationId,
    } = req.body;

    // Check if user already exists
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'User already exists',
        error: 'USER_EXISTS',
        timestamp: new Date().toISOString(),
      });
    }

    // Register with Supabase
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          firstName,
          lastName,
          role,
        },
      },
    });

    if (authError) {
      return res.status(400).json({
        success: false,
        message: 'Registration failed',
        error: authError.message,
        timestamp: new Date().toISOString(),
      });
    }

    // Create user in database
    const { data: user, error: createError } = await supabaseAdmin
      .from('users')
      .insert({
        id: authData.user?.id || '',
        email,
        password: await hashPassword(password), // Store hashed password as backup
        firstName: firstName,
        lastName: lastName,
        role: role as UserRole,
        organizationId: organizationId,
        isActive: true,
      })
      .select(
        `
        *,
        organization:organizations(*)
      `
      )
      .single();

    if (createError) {
      throw createError;
    }

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          organizationId: user.organizationId,
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Registration error:', error);
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
 * /api/v1/auth/logout:
 *   post:
 *     summary: User logout
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 */
router.post('/logout', authenticate, async (req, res) => {
  try {
    const { error } = await supabase.auth.signOut();

    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Logout failed',
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      message: 'Logout successful',
      timestamp: new Date().toISOString(),
    });
    return;
  } catch (error) {
    console.error('Logout error:', error);
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
 * /api/v1/auth/me:
 *   get:
 *     summary: Get current user profile
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 */
router.get('/me', authenticate, async (req, res) => {
  try {
    const userId = req.userContext?.id || '';
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select(
        `
        *,
        organization:organizations(*)
      `
      )
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
        error: 'USER_NOT_FOUND',
        timestamp: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      message: 'User profile retrieved successfully',
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          organizationId: user.organizationId,
          isActive: user.isActive,
          lastLoginAt: user.lastLoginAt,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
      },
      timestamp: new Date().toISOString(),
    });
    return;
  } catch (error) {
    console.error('Get profile error:', error);
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
  async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;

      // Update password in Supabase
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) {
        return res.status(400).json({
          success: false,
          message: 'Password change failed',
          error: error.message,
          timestamp: new Date().toISOString(),
        });
      }

      res.json({
        success: true,
        message: 'Password changed successfully',
        timestamp: new Date().toISOString(),
      });
      return;
    } catch (error) {
      console.error('Change password error:', error);
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
  async (req, res) => {
    try {
      const apiKey = generateApiKey();

      // Store API key in database
      const { error: apiKeyError } = await supabaseAdmin
        .from('api_keys')
        .insert({
          name: `API Key for ${req.userContext?.email}`,
          key: apiKey,
          organizationId: req.userContext?.organizationId || '',
          isActive: true,
        });

      if (apiKeyError) {
        throw apiKeyError;
      }

      res.json({
        success: true,
        message: 'API key generated successfully',
        data: {
          apiKey,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Generate API key error:', error);
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
