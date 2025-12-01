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
    const { search, role, isActive, branchId, page = 1, limit = 10 } = filters;
    const skip = (page - 1) * limit;

    // Build where clause
    const where: Prisma.UserWhereInput = {};

    // Non-super admins can only see users in their organization
    if (!isSuperAdmin) {
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
  async updateStatus(id: string, isActive: boolean) {
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
      },
    });
  }

  /**
   * Delete user (soft delete by deactivating)
   */
  async delete(id: string) {
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
   * Get user statistics for an organization
   */
  async getStatistics(organizationId: string) {
    const [totalUsers, activeUsers, usersByRole] = await Promise.all([
      prisma.user.count({ where: { organizationId } }),
      prisma.user.count({ where: { organizationId, isActive: true } }),
      prisma.user.groupBy({
        by: ['role'],
        where: { organizationId },
        _count: { id: true },
      }),
    ]);

    const roleBreakdown = usersByRole.reduce(
      (acc, item) => {
        acc[item.role] = item._count.id;
        return acc;
      },
      {} as Record<string, number>
    );

    return {
      totalUsers,
      activeUsers,
      inactiveUsers: totalUsers - activeUsers,
      roleBreakdown,
    };
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
}

export const userService = new UserService();
