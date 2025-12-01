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
      } = req.query;

      const filters = {
        search: search as string,
        role: role as UserRole,
        isActive: isActive !== undefined ? isActive === 'true' : undefined,
        branchId: branchId as string,
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

      if (typeof isActive !== 'boolean') {
        return res.status(400).json({
          success: false,
          message: 'isActive must be a boolean value',
          error: 'INVALID_STATUS',
          timestamp: new Date().toISOString(),
        });
      }

      const user = await userService.updateStatus(id, isActive);

      res.json({
        success: true,
        message: 'User status updated successfully',
        data: { user },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Update user status error:', error);
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

      // Prevent deleting yourself
      if (id === req.user?.userId) {
        return res.status(400).json({
          success: false,
          message: 'You cannot delete your own account',
          error: 'SELF_DELETE_FORBIDDEN',
          timestamp: new Date().toISOString(),
        });
      }

      await userService.delete(id);

      res.json({
        success: true,
        message: 'User deleted successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Delete user error:', error);
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
      const organizationId = req.user?.organizationId;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization ID required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      const statistics = await userService.getStatistics(organizationId);

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
}

export const userController = new UserController();
