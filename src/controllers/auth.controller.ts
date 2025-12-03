import { Request, Response } from 'express';
import { authService } from '../services/auth.service';

class AuthController {
  /**
   * User login
   * POST /api/v1/auth/login
   */
  async login(req: Request, res: Response) {
    try {
      const { email, password } = req.body;

      const result = await authService.login({ email, password });

      if (!result.success) {
        return res.status(401).json({
          ...result,
          timestamp: new Date().toISOString(),
        });
      }

      res.json({
        ...result,
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
  }

  /**
   * User registration
   * POST /api/v1/auth/register
   */
  async register(req: Request, res: Response) {
    try {
      const {
        email,
        password,
        firstName,
        lastName,
        role = 'TELLER',
        organizationId,
      } = req.body;

      const result = await authService.register({
        email,
        password,
        firstName,
        lastName,
        role,
        organizationId,
      });

      if (!result.success) {
        const statusCode = result.error === 'USER_EXISTS' ? 409 : 400;
        return res.status(statusCode).json({
          ...result,
          timestamp: new Date().toISOString(),
        });
      }

      res.status(201).json({
        ...result,
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
  }

  /**
   * Organization registration with first admin user
   * POST /api/v1/auth/register-organization
   */
  async registerOrganization(req: Request, res: Response) {
    try {
      const { organization, admin } = req.body;

      const result = await authService.registerOrganization({
        organization,
        admin,
      });

      if (!result.success) {
        const statusCode =
          result.error === 'ORG_EXISTS' ||
          result.error === 'USER_EXISTS' ||
          result.error === 'ORG_REG_EXISTS'
            ? 409
            : 400;
        return res.status(statusCode).json({
          ...result,
          timestamp: new Date().toISOString(),
        });
      }

      res.status(201).json({
        ...result,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Organization registration error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Approve organization
   * POST /api/v1/auth/organizations/:id/approve
   */
  async approveOrganization(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const result = await authService.approveOrganization(id);

      if (!result.success) {
        const statusCode =
          result.error === 'ORG_NOT_FOUND' || result.error === 'NO_USERS'
            ? 404
            : 400;
        return res.status(statusCode).json({
          ...result,
          timestamp: new Date().toISOString(),
        });
      }

      res.json({
        ...result,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Approve organization error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Reject organization
   * POST /api/v1/auth/organizations/:id/reject
   */
  async rejectOrganization(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      const result = await authService.rejectOrganization(id, reason);

      if (!result.success) {
        const statusCode = result.error === 'ORG_NOT_FOUND' ? 404 : 400;
        return res.status(statusCode).json({
          ...result,
          timestamp: new Date().toISOString(),
        });
      }

      res.json({
        ...result,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Reject organization error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get pending organizations
   * GET /api/v1/auth/organizations/pending
   */
  async getPendingOrganizations(req: Request, res: Response) {
    try {
      const result = await authService.getPendingOrganizations();

      res.json({
        ...result,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Get pending organizations error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * User logout
   * POST /api/v1/auth/logout
   */
  async logout(req: Request, res: Response) {
    try {
      const result = await authService.logout();

      if (!result.success) {
        return res.status(400).json({
          ...result,
          timestamp: new Date().toISOString(),
        });
      }

      res.json({
        ...result,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Logout error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get current user profile
   * GET /api/v1/auth/me
   */
  async getProfile(req: Request, res: Response) {
    try {
      const userId = req.userContext?.id || '';

      const result = await authService.getProfile(userId);

      if (!result.success) {
        return res.status(404).json({
          ...result,
          timestamp: new Date().toISOString(),
        });
      }

      res.json({
        ...result,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Get profile error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Change password
   * POST /api/v1/auth/change-password
   */
  async changePassword(req: Request, res: Response) {
    try {
      const { currentPassword, newPassword } = req.body;

      const result = await authService.changePassword({
        currentPassword,
        newPassword,
      });

      if (!result.success) {
        return res.status(400).json({
          ...result,
          timestamp: new Date().toISOString(),
        });
      }

      res.json({
        ...result,
        timestamp: new Date().toISOString(),
      });
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

  /**
   * Generate API key
   * POST /api/v1/auth/api-key
   */
  async generateApiKey(req: Request, res: Response) {
    try {
      const userEmail = req.userContext?.email || '';
      const organizationId = req.userContext?.organizationId || '';

      const result = await authService.generateApiKey(
        userEmail,
        organizationId
      );

      res.json({
        ...result,
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
}

export const authController = new AuthController();
