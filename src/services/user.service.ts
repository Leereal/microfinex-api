import { prisma } from '../config/database';
import { supabase, supabaseAdmin } from '../config/supabase-enhanced';
import { hashPassword } from '../utils/auth';
import { Prisma, UserRole as PrismaUserRole } from '@prisma/client';
import { UserRole } from '../types';

export interface UserFilters {
  search?: string;
  role?: string;
  isActive?: boolean;
  branchId?: string;
  organizationId?: string; // Super Admin can filter by organization
  page?: number;
  limit?: number;
}

export interface CreateUserInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role?: UserRole;
  organizationId?: string;
  branchId?: string;
  phone?: string;
}

export interface UpdateUserInput {
  firstName?: string;
  lastName?: string;
  role?: string;
  branchId?: string;
  phone?: string;
  isActive?: boolean;
}

class UserService {
  /**
   * Get all users with filters and pagination
   */
  async findAll(
    filters: UserFilters,
    organizationId: string,
    isSuperAdmin: boolean = false
  ) {
    const {
      search,
      role,
      isActive,
      branchId,
      organizationId: filterOrgId,
      page = 1,
      limit = 10,
    } = filters;
    const skip = (page - 1) * limit;

    // Build where clause
    const where: Prisma.UserWhereInput = {};

    // Super Admin can see all users or filter by specific organization
    if (isSuperAdmin) {
      // If Super Admin provides organizationId filter, use it
      if (filterOrgId) {
        where.organizationId = filterOrgId;
      }
      // Otherwise, no organization filter - show all users
    } else {
      // Non-super admins can only see users in their organization
      where.organizationId = organizationId;
    }

    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (role) {
      where.role = role as PrismaUserRole;
    }

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    if (branchId) {
      where.branchId = branchId;
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          isActive: true,
          isEmailVerified: true,
          phone: true,
          lastLoginAt: true,
          createdAt: true,
          updatedAt: true,
          organization: {
            select: {
              id: true,
              name: true,
            },
          },
          branch: {
            select: {
              id: true,
              name: true,
            },
          },
          userRoles: {
            where: { isActive: true },
            select: {
              role: {
                select: {
                  id: true,
                  name: true,
                  description: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      users,
      pagination: {
        page,
        limit,
        total,
        pages: totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }

  /**
   * Get user by ID
   */
  async findById(
    id: string,
    organizationId?: string,
    isSuperAdmin: boolean = false
  ) {
    const where: Prisma.UserWhereUniqueInput = { id };

    const user = await prisma.user.findUnique({
      where,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        isEmailVerified: true,
        phone: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
        organizationId: true,
        branchId: true,
        organization: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
        branch: {
          select: {
            id: true,
            name: true,
          },
        },
        userRoles: {
          where: { isActive: true },
          select: {
            role: {
              select: {
                id: true,
                name: true,
                description: true,
              },
            },
          },
        },
      },
    });

    // Check organization access for non-super admins
    if (
      user &&
      !isSuperAdmin &&
      organizationId &&
      user.organizationId !== organizationId
    ) {
      return null;
    }

    return user;
  }

  /**
   * Get user by email
   */
  async findByEmail(email: string) {
    return prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        organizationId: true,
        branchId: true,
      },
    });
  }

  /**
   * Check if user with email exists
   */
  async exists(email: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    return !!user;
  }

  /**
   * Create a new user
   */
  async create(input: CreateUserInput) {
    const {
      email,
      password,
      firstName,
      lastName,
      role = UserRole.STAFF,
      organizationId,
      branchId,
      phone,
    } = input;

    // Validate branch requirement for non-admin users
    const adminRoles = [UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN];
    if (!adminRoles.includes(role as UserRole) && !branchId) {
      throw new Error('Branch is required for non-admin users');
    }

    // Create user in Supabase Auth
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
      throw new Error(`Supabase auth error: ${authError.message}`);
    }

    // Create user in database
    const user = await prisma.user.create({
      data: {
        id: authData.user?.id || '',
        email,
        password: await hashPassword(password),
        firstName,
        lastName,
        role: role as PrismaUserRole,
        organizationId,
        branchId,
        phone,
        isActive: true,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        phone: true,
        organizationId: true,
        branchId: true,
        createdAt: true,
        organization: {
          select: {
            id: true,
            name: true,
          },
        },
        branch: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return user;
  }

  /**
   * Update a user
   */
  async update(
    id: string,
    data: UpdateUserInput,
    organizationId?: string,
    isSuperAdmin: boolean = false
  ) {
    // Verify user exists and belongs to organization
    const existingUser = await this.findById(id, organizationId, isSuperAdmin);
    if (!existingUser) {
      throw new Error('User not found');
    }

    // Build update data with proper types
    const updateData: Prisma.UserUpdateInput = {};
    if (data.firstName !== undefined) updateData.firstName = data.firstName;
    if (data.lastName !== undefined) updateData.lastName = data.lastName;
    if (data.role !== undefined) updateData.role = data.role as PrismaUserRole;
    if (data.phone !== undefined) updateData.phone = data.phone;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (data.branchId !== undefined) {
      updateData.branch = data.branchId
        ? { connect: { id: data.branchId } }
        : { disconnect: true };
    }

    return prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        phone: true,
        organizationId: true,
        branchId: true,
        updatedAt: true,
        organization: {
          select: {
            id: true,
            name: true,
          },
        },
        branch: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
  }

  /**
   * Update user status (activate/deactivate)
   */
  async updateStatus(
    id: string,
    isActive: boolean,
    organizationId?: string,
    isSuperAdmin: boolean = false
  ) {
    // Verify user exists and belongs to organization for non-super admins
    const existingUser = await this.findById(id, organizationId, isSuperAdmin);
    if (!existingUser) {
      throw new Error('User not found');
    }

    return prisma.user.update({
      where: { id },
      data: { isActive },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        organization: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
  }

  /**
   * Delete user (soft delete by deactivating)
   */
  async delete(
    id: string,
    organizationId?: string,
    isSuperAdmin: boolean = false
  ) {
    // Verify user exists and belongs to organization for non-super admins
    const existingUser = await this.findById(id, organizationId, isSuperAdmin);
    if (!existingUser) {
      throw new Error('User not found');
    }

    // Deactivate in database
    await prisma.user.update({
      where: { id },
      data: { isActive: false },
    });

    // Optionally disable in Supabase Auth
    // Note: This requires admin API access
    try {
      await supabaseAdmin.auth.admin.deleteUser(id);
    } catch (error) {
      console.error('Failed to delete user from Supabase Auth:', error);
      // Don't throw - user is already deactivated in database
    }

    return { success: true };
  }

  /**
   * Get user statistics for an organization or globally for Super Admin
   */
  async getStatistics(organizationId?: string, isSuperAdmin: boolean = false) {
    const where: Prisma.UserWhereInput = {};

    // Non-super admins or Super Admins filtering by org
    if (organizationId) {
      where.organizationId = organizationId;
    }

    const [totalUsers, activeUsers, usersByRole, usersByOrganization] =
      await Promise.all([
        prisma.user.count({ where }),
        prisma.user.count({ where: { ...where, isActive: true } }),
        prisma.user.groupBy({
          by: ['role'],
          where,
          _count: { id: true },
        }),
        // Only get org breakdown for Super Admin without org filter
        isSuperAdmin && !organizationId
          ? prisma.user.groupBy({
              by: ['organizationId'],
              _count: { id: true },
            })
          : Promise.resolve([]),
      ]);

    const roleBreakdown = usersByRole.reduce(
      (acc, item) => {
        acc[item.role] = item._count.id;
        return acc;
      },
      {} as Record<string, number>
    );

    const result: {
      totalUsers: number;
      activeUsers: number;
      inactiveUsers: number;
      roleBreakdown: Record<string, number>;
      organizationBreakdown?: Record<string, number>;
    } = {
      totalUsers,
      activeUsers,
      inactiveUsers: totalUsers - activeUsers,
      roleBreakdown,
    };

    // Add organization breakdown for Super Admin global view
    if (isSuperAdmin && !organizationId && usersByOrganization.length > 0) {
      result.organizationBreakdown = usersByOrganization.reduce(
        (acc, item) => {
          acc[item.organizationId || 'no_org'] = item._count.id;
          return acc;
        },
        {} as Record<string, number>
      );
    }

    return result;
  }

  /**
   * Change user password
   */
  async changePassword(id: string, newPassword: string) {
    // Update in Supabase Auth
    const { error } = await supabaseAdmin.auth.admin.updateUserById(id, {
      password: newPassword,
    });

    if (error) {
      throw new Error(`Failed to update password: ${error.message}`);
    }

    // Update hashed password in database
    await prisma.user.update({
      where: { id },
      data: { password: await hashPassword(newPassword) },
    });

    return { success: true };
  }

  /**
   * Assign user to branch
   */
  async assignToBranch(userId: string, branchId: string | null) {
    return prisma.user.update({
      where: { id: userId },
      data: { branchId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        branchId: true,
        branch: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
  }

  /**
   * Manually verify user email (Super Admin only)
   */
  async verifyEmail(userId: string) {
    // Update in database
    const user = await prisma.user.update({
      where: { id: userId },
      data: { isEmailVerified: true },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        isEmailVerified: true,
        organizationId: true,
        organization: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // Also update in Supabase Auth to mark email as confirmed
    try {
      await supabaseAdmin.auth.admin.updateUserById(userId, {
        email_confirm: true,
      });
    } catch (error) {
      console.error('Failed to update Supabase email verification:', error);
      // Don't throw - database is already updated
    }

    return user;
  }

  /**
   * Unverify user email (Super Admin only)
   */
  async unverifyEmail(userId: string) {
    return prisma.user.update({
      where: { id: userId },
      data: { isEmailVerified: false },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        isEmailVerified: true,
        organizationId: true,
        organization: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
  }

  /**
   * Get users pending email verification
   */
  async getPendingVerification(
    organizationId?: string,
    isSuperAdmin: boolean = false
  ) {
    const where: Prisma.UserWhereInput = {
      isEmailVerified: false,
    };

    if (!isSuperAdmin && organizationId) {
      where.organizationId = organizationId;
    }

    return prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        isEmailVerified: true,
        createdAt: true,
        organization: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ==========================================
  // Multi-Branch Management Methods
  // ==========================================

  /**
   * Get current user's assigned branches
   */
  async getMyBranches(userId: string) {
    const userBranches = await prisma.userBranch.findMany({
      where: { userId },
      include: {
        branch: {
          select: {
            id: true,
            name: true,
            code: true,
            address: true,
            phone: true,
            isActive: true,
          },
        },
      },
      orderBy: [
        { isPrimary: 'desc' },
        { isCurrent: 'desc' },
        { branch: { name: 'asc' } },
      ],
    });

    const currentBranch = userBranches.find(ub => ub.isCurrent)?.branch || null;

    return {
      currentBranch,
      branches: userBranches.map(ub => ({
        id: ub.id,
        branchId: ub.branchId,
        branchName: ub.branch.name,
        branch: ub.branch,
        isCurrent: ub.isCurrent,
        isPrimary: ub.isPrimary,
        assignedAt: ub.assignedAt,
      })),
    };
  }

  /**
   * Switch user's current branch
   */
  async switchBranch(userId: string, branchId: string) {
    // Check if user has access to this branch
    const userBranch = await prisma.userBranch.findFirst({
      where: { userId, branchId },
      include: {
        branch: {
          select: {
            id: true,
            name: true,
            code: true,
            isActive: true,
          },
        },
      },
    });

    if (!userBranch) {
      throw new Error('You do not have access to this branch');
    }

    if (!userBranch.branch.isActive) {
      throw new Error('This branch is not active');
    }

    // Update all user branches to not current, then set the selected one as current
    await prisma.$transaction([
      prisma.userBranch.updateMany({
        where: { userId },
        data: { isCurrent: false },
      }),
      prisma.userBranch.update({
        where: { userId_branchId: { userId, branchId } },
        data: { isCurrent: true },
      }),
    ]);

    // Get updated user branches
    const userBranches = await prisma.userBranch.findMany({
      where: { userId },
      include: {
        branch: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
      },
      orderBy: [{ isPrimary: 'desc' }, { branch: { name: 'asc' } }],
    });

    const currentBranch =
      userBranches.find(ub => ub.isCurrent)?.branch || userBranch.branch;

    return {
      currentBranch,
      branches: userBranches.map(ub => ({
        id: ub.id,
        branchId: ub.branchId,
        branch: ub.branch,
        isCurrent: ub.isCurrent,
        isPrimary: ub.isPrimary,
      })),
    };
  }

  /**
   * Get a user's assigned branches (for admin view)
   */
  async getUserBranches(userId: string, organizationId: string) {
    // Verify target user exists and belongs to same organization
    const targetUser = await prisma.user.findFirst({
      where: { id: userId, organizationId },
    });

    if (!targetUser) {
      throw new Error('User not found');
    }

    const userBranches = await prisma.userBranch.findMany({
      where: { userId },
      include: {
        branch: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
      },
      orderBy: [{ isPrimary: 'desc' }, { branch: { name: 'asc' } }],
    });

    return {
      branches: userBranches.map(ub => ({
        id: ub.id,
        branchId: ub.branchId,
        branchName: ub.branch.name,
        isCurrent: ub.isCurrent,
        isPrimary: ub.isPrimary,
      })),
    };
  }

  /**
   * Assign multiple branches to a user
   */
  async assignBranches(
    userId: string,
    branchIds: string[],
    primaryBranchId: string | undefined,
    assignedBy: string,
    organizationId: string
  ) {
    // Verify target user exists and belongs to same organization
    const targetUser = await prisma.user.findFirst({
      where: { id: userId, organizationId },
    });

    if (!targetUser) {
      throw new Error('User not found');
    }

    // Handle empty branchIds - remove all assignments
    if (branchIds.length === 0) {
      await prisma.userBranch.deleteMany({
        where: { userId },
      });

      return { userBranches: [] };
    }

    // Verify all branches exist and belong to same organization
    const branches = await prisma.branch.findMany({
      where: {
        id: { in: branchIds },
        organizationId,
        isActive: true,
      },
    });

    if (branches.length !== branchIds.length) {
      throw new Error('One or more branches not found or inactive');
    }

    // Determine primary branch
    const actualPrimaryId =
      primaryBranchId && branchIds.includes(primaryBranchId)
        ? primaryBranchId
        : branchIds[0];

    // Remove existing branch assignments and create new ones
    await prisma.$transaction([
      prisma.userBranch.deleteMany({
        where: { userId },
      }),
      prisma.userBranch.createMany({
        data: branchIds.map(branchId => ({
          userId,
          branchId,
          isPrimary: branchId === actualPrimaryId,
          isCurrent: branchId === actualPrimaryId,
          assignedBy,
        })),
      }),
    ]);

    // Get updated assignments
    const userBranches = await prisma.userBranch.findMany({
      where: { userId },
      include: {
        branch: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
      },
      orderBy: [{ isPrimary: 'desc' }, { branch: { name: 'asc' } }],
    });

    return {
      userBranches: userBranches.map(ub => ({
        id: ub.id,
        branchId: ub.branchId,
        branchName: ub.branch.name,
        isCurrent: ub.isCurrent,
        isPrimary: ub.isPrimary,
      })),
    };
  }
}

export const userService = new UserService();
