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
