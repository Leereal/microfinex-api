import { Request, Response } from 'express';
import { userService } from '../services/user.service';
import { UserRole } from '../types';

class UserController {
  /**
   * Get all users
   * GET /api/v1/users
   */
  async getAll(req: Request, res: Response) {
    try {
      const {
        page = 1,
        limit = 10,
        search,
        role,
        isActive,
        branchId,
        organizationId: filterOrgId,
      } = req.query;

      const filters = {
        search: search as string,
        role: role as UserRole,
        isActive: isActive !== undefined ? isActive === 'true' : undefined,
        branchId: branchId as string,
        organizationId: filterOrgId as string, // Super Admin can filter by organization
        page: Number(page),
        limit: Number(limit),
      };

      const isSuperAdmin = req.user?.role === UserRole.SUPER_ADMIN;
      const organizationId = req.user?.organizationId || '';

      const result = await userService.findAll(
        filters,
        organizationId,
        isSuperAdmin
      );

      res.json({
        success: true,
        message: 'Users retrieved successfully',
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Get users error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get user by ID
   * GET /api/v1/users/:id
   */
  async getById(req: Request, res: Response) {
    try {
      const id = req.params.id!;
      const isSuperAdmin = req.user?.role === UserRole.SUPER_ADMIN;
      const organizationId = req.user?.organizationId;

      const user = await userService.findById(id, organizationId, isSuperAdmin);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      res.json({
        success: true,
        message: 'User retrieved successfully',
        data: { user },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Get user error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Create new user
   * POST /api/v1/users
   */
  async create(req: Request, res: Response) {
    try {
      const {
        email,
        password,
        firstName,
        lastName,
        role = UserRole.STAFF,
        branchId,
        phone,
      } = req.body;

      // Get organization ID from context or body
      const organizationId =
        req.body.organizationId || req.user?.organizationId;

      // Check if user with same email exists
      const exists = await userService.exists(email);

      if (exists) {
        return res.status(409).json({
          success: false,
          message: 'User with this email already exists',
          error: 'USER_EXISTS',
          timestamp: new Date().toISOString(),
        });
      }

      const user = await userService.create({
        email,
        password,
        firstName,
        lastName,
        role,
        organizationId,
        branchId,
        phone,
      });

      res.status(201).json({
        success: true,
        message: 'User created successfully',
        data: { user },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Create user error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Update user
   * PUT /api/v1/users/:id
   */
  async update(req: Request, res: Response) {
    try {
      const id = req.params.id!;
      const updateData = req.body;
      const isSuperAdmin = req.user?.role === UserRole.SUPER_ADMIN;
      const organizationId = req.user?.organizationId;

      const user = await userService.update(
        id,
        updateData,
        organizationId,
        isSuperAdmin
      );

      res.json({
        success: true,
        message: 'User updated successfully',
        data: { user },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Update user error:', error);
      if ((error as Error).message === 'User not found') {
        return res.status(404).json({
          success: false,
          message: 'User not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Update user status
   * PATCH /api/v1/users/:id/status
   */
  async updateStatus(req: Request, res: Response) {
    try {
      const id = req.params.id!;
      const { isActive } = req.body;
      const isSuperAdmin = req.user?.role === UserRole.SUPER_ADMIN;
      const organizationId = req.user?.organizationId;

      if (typeof isActive !== 'boolean') {
        return res.status(400).json({
          success: false,
          message: 'isActive must be a boolean value',
          error: 'INVALID_STATUS',
          timestamp: new Date().toISOString(),
        });
      }

      const user = await userService.updateStatus(
        id,
        isActive,
        organizationId,
        isSuperAdmin
      );

      res.json({
        success: true,
        message: 'User status updated successfully',
        data: { user },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Update user status error:', error);
      if ((error as Error).message === 'User not found') {
        return res.status(404).json({
          success: false,
          message: 'User not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Delete user
   * DELETE /api/v1/users/:id
   */
  async delete(req: Request, res: Response) {
    try {
      const id = req.params.id!;
      const isSuperAdmin = req.user?.role === UserRole.SUPER_ADMIN;
      const organizationId = req.user?.organizationId;

      // Prevent deleting yourself
      if (id === (req.user?.id || req.user?.userId)) {
        return res.status(400).json({
          success: false,
          message: 'You cannot delete your own account',
          error: 'SELF_DELETE_FORBIDDEN',
          timestamp: new Date().toISOString(),
        });
      }

      await userService.delete(id, organizationId, isSuperAdmin);

      res.json({
        success: true,
        message: 'User deleted successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Delete user error:', error);
      if ((error as Error).message === 'User not found') {
        return res.status(404).json({
          success: false,
          message: 'User not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get user statistics
   * GET /api/v1/users/statistics
   */
  async getStatistics(req: Request, res: Response) {
    try {
      const isSuperAdmin = req.user?.role === UserRole.SUPER_ADMIN;
      const organizationId = req.user?.organizationId;

      // Super Admin can optionally filter by organization via query param
      const filterOrgId = req.query.organizationId as string;

      // Non-super admins require organization ID
      if (!isSuperAdmin && !organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization ID required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      // Use filtered org ID for Super Admin, or user's org for others
      const targetOrgId = isSuperAdmin ? filterOrgId : organizationId;

      const statistics = await userService.getStatistics(
        targetOrgId,
        isSuperAdmin
      );

      res.json({
        success: true,
        message: 'User statistics retrieved successfully',
        data: { statistics },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Get user statistics error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Assign user to branch
   * PATCH /api/v1/users/:id/branch
   */
  async assignToBranch(req: Request, res: Response) {
    try {
      const id = req.params.id!;
      const { branchId } = req.body;

      const user = await userService.assignToBranch(id, branchId || null);

      res.json({
        success: true,
        message: 'User assigned to branch successfully',
        data: { user },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Assign user to branch error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Reset user password (admin action)
   * POST /api/v1/users/:id/reset-password
   */
  async resetPassword(req: Request, res: Response) {
    try {
      const id = req.params.id!;
      const { newPassword } = req.body;

      if (!newPassword || newPassword.length < 8) {
        return res.status(400).json({
          success: false,
          message: 'Password must be at least 8 characters',
          error: 'INVALID_PASSWORD',
          timestamp: new Date().toISOString(),
        });
      }

      await userService.changePassword(id, newPassword);

      res.json({
        success: true,
        message: 'Password reset successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Reset password error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Manually verify user email (Super Admin only)
   * POST /api/v1/users/:id/verify-email
   */
  async verifyEmail(req: Request, res: Response) {
    try {
      const id = req.params.id!;

      const user = await userService.verifyEmail(id);

      res.json({
        success: true,
        message: 'User email verified successfully',
        data: { user },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Verify email error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Unverify user email (Super Admin only)
   * POST /api/v1/users/:id/unverify-email
   */
  async unverifyEmail(req: Request, res: Response) {
    try {
      const id = req.params.id!;

      const user = await userService.unverifyEmail(id);

      res.json({
        success: true,
        message: 'User email verification revoked',
        data: { user },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Unverify email error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get users pending email verification
   * GET /api/v1/users/pending-verification
   */
  async getPendingVerification(req: Request, res: Response) {
    try {
      const isSuperAdmin = req.user?.role === UserRole.SUPER_ADMIN;
      const organizationId = req.user?.organizationId;

      const users = await userService.getPendingVerification(
        organizationId,
        isSuperAdmin
      );

      res.json({
        success: true,
        message: 'Users pending verification retrieved successfully',
        data: { users, count: users.length },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Get pending verification error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  // ==========================================
  // Multi-Branch Management Methods
  // ==========================================

  /**
   * Get current user's assigned branches
   * GET /api/v1/users/my-branches
   */
  async getMyBranches(req: Request, res: Response) {
    try {
      const userId = req.user?.id || req.user?.userId;
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
          error: 'UNAUTHORIZED',
          timestamp: new Date().toISOString(),
        });
      }

      const result = await userService.getMyBranches(userId);

      res.json({
        success: true,
        message: 'User branches retrieved successfully',
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Get my branches error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Switch user's current branch
   * POST /api/v1/users/switch-branch
   */
  async switchBranch(req: Request, res: Response) {
    try {
      const userId = req.user?.id || req.user?.userId;
      const { branchId } = req.body;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
          error: 'UNAUTHORIZED',
          timestamp: new Date().toISOString(),
        });
      }

      if (!branchId) {
        return res.status(400).json({
          success: false,
          message: 'Branch ID is required',
          error: 'MISSING_BRANCH_ID',
          timestamp: new Date().toISOString(),
        });
      }

      const result = await userService.switchBranch(userId, branchId);

      res.json({
        success: true,
        message: `Switched to ${result.currentBranch?.name}`,
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Switch branch error:', error);
      const message = (error as Error).message;

      if (
        message.includes('do not have access') ||
        message.includes('not active')
      ) {
        return res.status(403).json({
          success: false,
          message,
          error: 'BRANCH_ACCESS_DENIED',
          timestamp: new Date().toISOString(),
        });
      }

      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get a user's assigned branches (admin view)
   * GET /api/v1/users/:id/branches
   */
  async getUserBranches(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const organizationId = req.user?.organizationId;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization ID required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      const result = await userService.getUserBranches(id, organizationId);

      res.json({
        success: true,
        message: 'User branches retrieved successfully',
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Get user branches error:', error);
      const message = (error as Error).message;

      if (message === 'User not found') {
        return res.status(404).json({
          success: false,
          message,
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Assign multiple branches to a user
   * POST /api/v1/users/:id/branches
   */
  async assignBranches(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { branchIds, primaryBranchId } = req.body;
      const assignedBy = req.user?.id || req.user?.userId;
      const organizationId = req.user?.organizationId;

      if (!assignedBy || !organizationId) {
        return res.status(400).json({
          success: false,
          message: 'User context required',
          error: 'MISSING_CONTEXT',
          timestamp: new Date().toISOString(),
        });
      }

      if (!Array.isArray(branchIds)) {
        return res.status(400).json({
          success: false,
          message: 'branchIds must be an array',
          error: 'INVALID_INPUT',
          timestamp: new Date().toISOString(),
        });
      }

      const result = await userService.assignBranches(
        id,
        branchIds,
        primaryBranchId,
        assignedBy,
        organizationId
      );

      res.json({
        success: true,
        message:
          branchIds.length > 0
            ? `Assigned ${branchIds.length} branch(es) to user`
            : 'All branch assignments removed',
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Assign branches error:', error);
      const message = (error as Error).message;

      if (message === 'User not found') {
        return res.status(404).json({
          success: false,
          message,
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      if (message.includes('branches not found')) {
        return res.status(400).json({
          success: false,
          message,
          error: 'INVALID_BRANCHES',
          timestamp: new Date().toISOString(),
        });
      }

      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
}

export const userController = new UserController();
