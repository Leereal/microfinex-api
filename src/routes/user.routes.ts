/**
 * User Management Routes
 * API endpoints for user CRUD operations
 */

import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../config/database';
import {
  authenticateToken,
  requirePermission,
} from '../middleware/auth.middleware';
import {
  validateRequest,
  handleAsync,
} from '../middleware/validation.middleware';

const router = Router();

// All user routes require authentication
router.use(authenticateToken);

/**
 * Create a new user
 * POST /api/users
 */
const createUserSchema = z.object({
  body: z
    .object({
      email: z.string().email('Valid email required'),
      password: z.string().min(8, 'Password must be at least 8 characters'),
      firstName: z.string().min(1, 'First name required'),
      lastName: z.string().min(1, 'Last name required'),
      phone: z.string().optional(),
      roleId: z.string().uuid('Valid role ID required').optional(), // RBAC role ID
      role: z
        .enum([
          'SUPER_ADMIN',
          'ORG_ADMIN',
          'ADMIN',
          'MANAGER',
          'LOAN_OFFICER',
          'ACCOUNTANT',
          'TELLER',
          'STAFF',
          'VIEWER',
        ])
        .optional(), // Role name
      branchId: z.string().uuid().optional(),
      isActive: z.boolean().default(true),
      isEmailVerified: z.boolean().optional(), // SUPER_ADMIN can set verification status
      organizationId: z.string().uuid().optional(), // SUPER_ADMIN can specify organization
      metadata: z.record(z.any()).optional(),
    })
    .refine(data => data.roleId || data.role, {
      message: 'Either roleId or role name is required',
    }),
});

router.post(
  '/',
  requirePermission('users:create'),
  validateRequest(createUserSchema),
  handleAsync(async (req, res) => {
    const userOrganizationId = req.user!.organizationId;
    const creatorId = req.user!.userId;
    const creatorRole = req.user!.role;
    const {
      email,
      password,
      firstName,
      lastName,
      phone,
      roleId,
      role: roleName,
      branchId,
      isActive,
      isEmailVerified,
      organizationId: requestedOrgId,
      metadata,
    } = req.body;

    // Determine target organization
    // SUPER_ADMIN can create users in any organization
    let targetOrganizationId = userOrganizationId;
    if (creatorRole === 'SUPER_ADMIN' && requestedOrgId) {
      // Verify the organization exists
      const org = await prisma.organization.findUnique({
        where: { id: requestedOrgId },
      });
      if (!org) {
        return res.status(400).json({
          success: false,
          message: 'Organization not found',
        });
      }
      targetOrganizationId = requestedOrgId;
    }

    if (!targetOrganizationId) {
      return res.status(400).json({
        success: false,
        message: 'Organization is required',
      });
    }

    // Check for duplicate email within the target organization
    const existing = await prisma.user.findFirst({
      where: { email, organizationId: targetOrganizationId },
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Email already registered in this organization',
      });
    }

    // Resolve role - either by ID or by name
    let role;
    if (roleId) {
      role = await prisma.role.findFirst({
        where: { id: roleId, organizationId: targetOrganizationId },
      });
    } else if (roleName) {
      // Find role by name in the organization
      role = await prisma.role.findFirst({
        where: { name: roleName, organizationId: targetOrganizationId },
      });
    }

    if (!role) {
      return res.status(400).json({
        success: false,
        message: roleId
          ? 'Invalid role for this organization'
          : `Role "${roleName}" not found in this organization. Please ensure RBAC roles are seeded.`,
      });
    }

    // Verify branch belongs to target organization (if provided)
    if (branchId) {
      const branch = await prisma.branch.findFirst({
        where: { id: branchId, organizationId: targetOrganizationId },
      });
      if (!branch) {
        return res.status(400).json({
          success: false,
          message: 'Branch does not belong to the selected organization',
        });
      }
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Determine email verification status
    // SUPER_ADMIN can set isEmailVerified, defaults to true for SUPER_ADMIN-created users
    const emailVerified =
      creatorRole === 'SUPER_ADMIN'
        ? isEmailVerified !== undefined
          ? isEmailVerified
          : true
        : false;

    // Create user and assign to role in a transaction
    const user = await prisma.$transaction(async tx => {
      // Create the user
      const newUser = await tx.user.create({
        data: {
          email,
          password: hashedPassword,
          firstName,
          lastName,
          phone,
          role: role.name as any, // Use role name as enum value
          branchId,
          isActive,
          isEmailVerified: emailVerified,
          organizationId: targetOrganizationId,
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          isActive: true,
          isEmailVerified: true,
          role: true,
          branch: { select: { id: true, name: true, code: true } },
          organization: { select: { id: true, name: true } },
          createdAt: true,
        },
      });

      // Assign user to RBAC role
      await tx.userRoleAssignment.create({
        data: {
          userId: newUser.id,
          roleId: role.id,
          assignedBy: creatorId,
        },
      });

      return newUser;
    });

    res.status(201).json({
      success: true,
      data: user,
    });
  })
);

/**
 * Get all users
 * GET /api/users
 */
const listUsersSchema = z.object({
  query: z.object({
    page: z
      .string()
      .optional()
      .transform(v => parseInt(v || '1')),
    limit: z
      .string()
      .optional()
      .transform(v => parseInt(v || '20')),
    search: z.string().optional(),
    roleId: z.string().optional(),
    branchId: z.string().optional(),
    isActive: z.enum(['true', 'false', 'all']).optional(),
    sortBy: z
      .enum(['firstName', 'lastName', 'email', 'createdAt'])
      .default('firstName'),
    sortOrder: z.enum(['asc', 'desc']).default('asc'),
  }),
});

router.get(
  '/',
  requirePermission('users:view'),
  validateRequest(listUsersSchema),
  handleAsync(async (req, res) => {
    const organizationId = req.user!.organizationId;
    const page = parseInt(String(req.query.page || '1'), 10);
    const limit = parseInt(String(req.query.limit || '20'), 10);
    const { search, roleId, branchId, isActive, sortBy, sortOrder } = req.query;

    const where: any = { organizationId };

    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (roleId) where.role = roleId; // role is an enum field
    if (branchId) where.branchId = branchId;
    if (isActive && isActive !== 'all') {
      where.isActive = isActive === 'true';
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          isActive: true,
          lastLoginAt: true,
          role: true,
          branch: { select: { id: true, name: true, code: true } },
          createdAt: true,
        },
        orderBy: { [sortBy as string]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    res.json({
      success: true,
      data: users,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  })
);

/**
 * Get user by ID
 * GET /api/users/:id
 */
router.get(
  '/:id',
  requirePermission('users:view'),
  handleAsync(async (req, res) => {
    const organizationId = req.user!.organizationId;

    const user = await prisma.user.findFirst({
      where: {
        id: req.params.id,
        organizationId,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        isActive: true,
        lastLoginAt: true,
        role: true,
        permissions: true,
        branch: { select: { id: true, name: true, code: true } },
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    res.json({
      success: true,
      data: user,
    });
  })
);

/**
 * Update user
 * PUT /api/users/:id
 */
const updateUserSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    email: z.string().email().optional(),
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    phone: z.string().optional().nullable(),
    roleId: z.string().uuid().optional(),
    branchId: z.string().uuid().optional().nullable(),
    isActive: z.boolean().optional(),
    metadata: z.record(z.any()).optional(),
  }),
});

router.put(
  '/:id',
  requirePermission('users:update'),
  validateRequest(updateUserSchema),
  handleAsync(async (req, res) => {
    const organizationId = req.user!.organizationId;

    const user = await prisma.user.findFirst({
      where: {
        id: req.params.id,
        organizationId,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Check email uniqueness if changing
    if (req.body.email && req.body.email !== user.email) {
      const existing = await prisma.user.findFirst({
        where: {
          email: req.body.email,
          organizationId,
          id: { not: req.params.id },
        },
      });

      if (existing) {
        return res.status(400).json({
          success: false,
          message: 'Email already in use',
        });
      }
    }

    // Remove roleId from body if present since role is an enum
    const { roleId, ...updateData } = req.body;
    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        ...updateData,
        updatedAt: new Date(),
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        isActive: true,
        role: true,
        branch: { select: { id: true, name: true } },
        updatedAt: true,
      },
    });

    res.json({
      success: true,
      data: updated,
    });
  })
);

/**
 * Change user password
 * PUT /api/users/:id/password
 */
const changePasswordSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    newPassword: z.string().min(8, 'Password must be at least 8 characters'),
  }),
});

router.put(
  '/:id/password',
  requirePermission('users:update'),
  validateRequest(changePasswordSchema),
  handleAsync(async (req, res) => {
    const organizationId = req.user!.organizationId;

    const user = await prisma.user.findFirst({
      where: {
        id: req.params.id,
        organizationId,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const hashedPassword = await bcrypt.hash(req.body.newPassword, 12);

    await prisma.user.update({
      where: { id: req.params.id },
      data: {
        password: hashedPassword,
        updatedAt: new Date(),
      },
    });

    res.json({
      success: true,
      message: 'Password updated successfully',
    });
  })
);

/**
 * Deactivate user
 * POST /api/users/:id/deactivate
 */
router.post(
  '/:id/deactivate',
  requirePermission('users:update'),
  handleAsync(async (req, res) => {
    const organizationId = req.user!.organizationId;
    const currentUserId = req.user!.userId;

    if (req.params.id === currentUserId) {
      return res.status(400).json({
        success: false,
        message: 'Cannot deactivate your own account',
      });
    }

    const user = await prisma.user.findFirst({
      where: {
        id: req.params.id,
        organizationId,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    await prisma.user.update({
      where: { id: req.params.id },
      data: {
        isActive: false,
        updatedAt: new Date(),
      },
    });

    res.json({
      success: true,
      message: 'User deactivated successfully',
    });
  })
);

/**
 * Reactivate user
 * POST /api/users/:id/reactivate
 */
router.post(
  '/:id/reactivate',
  requirePermission('users:update'),
  handleAsync(async (req, res) => {
    const organizationId = req.user!.organizationId;

    const user = await prisma.user.findFirst({
      where: {
        id: req.params.id,
        organizationId,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    await prisma.user.update({
      where: { id: req.params.id },
      data: {
        isActive: true,
        updatedAt: new Date(),
      },
    });

    res.json({
      success: true,
      message: 'User reactivated successfully',
    });
  })
);

/**
 * Assign role to user
 * POST /api/users/:id/role
 */
const assignRoleSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    roleId: z.string().uuid(),
  }),
});

router.post(
  '/:id/role',
  requirePermission('users:assign_role'),
  validateRequest(assignRoleSchema),
  handleAsync(async (req, res) => {
    const organizationId = req.user!.organizationId;

    const user = await prisma.user.findFirst({
      where: {
        id: req.params.id,
        organizationId,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Verify role exists
    const role = await prisma.role.findFirst({
      where: { id: req.body.roleId, organizationId },
    });

    if (!role) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role',
      });
    }

    await prisma.user.update({
      where: { id: req.params.id },
      data: {
        role: role.name as any, // Use role name as enum value
        updatedAt: new Date(),
      },
    });

    res.json({
      success: true,
      message: 'Role assigned successfully',
    });
  })
);

/**
 * Assign branch to user
 * POST /api/users/:id/branch
 */
const assignBranchSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    branchId: z.string().uuid().nullable(),
  }),
});

router.post(
  '/:id/branch',
  requirePermission('users:assign_branch'),
  validateRequest(assignBranchSchema),
  handleAsync(async (req, res) => {
    const organizationId = req.user!.organizationId;

    const user = await prisma.user.findFirst({
      where: {
        id: req.params.id,
        organizationId,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Verify branch if provided
    if (req.body.branchId) {
      const branch = await prisma.branch.findFirst({
        where: { id: req.body.branchId, organizationId, isActive: true },
      });

      if (!branch) {
        return res.status(400).json({
          success: false,
          message: 'Invalid branch',
        });
      }
    }

    await prisma.user.update({
      where: { id: req.params.id },
      data: {
        branchId: req.body.branchId,
        updatedAt: new Date(),
      },
    });

    res.json({
      success: true,
      message: 'Branch assigned successfully',
    });
  })
);

/**
 * Get user activity log
 * GET /api/users/:id/activity
 */
const activitySchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  query: z.object({
    page: z
      .string()
      .optional()
      .transform(v => parseInt(v || '1')),
    limit: z
      .string()
      .optional()
      .transform(v => parseInt(v || '20')),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  }),
});

router.get(
  '/:id/activity',
  requirePermission('users:view'),
  validateRequest(activitySchema),
  handleAsync(async (req, res) => {
    const organizationId = req.user!.organizationId;
    const page = parseInt(String(req.query.page || '1'), 10);
    const limit = parseInt(String(req.query.limit || '20'), 10);
    const { startDate, endDate } = req.query;

    const user = await prisma.user.findFirst({
      where: {
        id: req.params.id,
        organizationId,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const where: any = {
      userId: req.params.id,
    };

    if (startDate) {
      where.timestamp = {
        ...where.timestamp,
        gte: new Date(startDate as string),
      };
    }
    if (endDate) {
      where.timestamp = {
        ...where.timestamp,
        lte: new Date(endDate as string),
      };
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({
      success: true,
      data: logs,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  })
);

export default router;
