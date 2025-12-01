import { Request, Response } from 'express';
import { organizationService } from '../services/organization.service';
import { UserRole } from '../types';

class OrganizationController {
  /**
   * Get all organizations
   * GET /api/v1/organizations
   */
  async getAll(req: Request, res: Response) {
    try {
      const { page = 1, limit = 10, search, type, isActive } = req.query;

      const filters = {
        search: search as string,
        type: type as any,
        isActive: isActive !== undefined ? isActive === 'true' : undefined,
        page: Number(page),
        limit: Number(limit),
      };

      const isSuperAdmin = req.user?.role === UserRole.SUPER_ADMIN;
      const userOrganizationId = req.user?.organizationId;

      const result = await organizationService.findAll(
        filters,
        userOrganizationId,
        isSuperAdmin
      );

      res.json({
        success: true,
        message: 'Organizations retrieved successfully',
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Get organizations error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get organization by ID
   * GET /api/v1/organizations/:id
   */
  async getById(req: Request, res: Response) {
    try {
      const id = req.params.id!;

      // Check permissions
      if (
        req.user?.role !== UserRole.SUPER_ADMIN &&
        req.user?.organizationId !== id
      ) {
        return res.status(403).json({
          success: false,
          message: 'Access denied',
          error: 'FORBIDDEN',
          timestamp: new Date().toISOString(),
        });
      }

      const organization = await organizationService.findById(id);

      if (!organization) {
        return res.status(404).json({
          success: false,
          message: 'Organization not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      res.json({
        success: true,
        message: 'Organization retrieved successfully',
        data: { organization },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Get organization error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Create new organization
   * POST /api/v1/organizations
   */
  async create(req: Request, res: Response) {
    try {
      const organizationData = req.body;

      // Check if organization with same name or email exists
      const exists = await organizationService.exists(
        organizationData.name,
        organizationData.email
      );

      if (exists) {
        return res.status(409).json({
          success: false,
          message: 'Organization with this name or email already exists',
          error: 'ORGANIZATION_EXISTS',
          timestamp: new Date().toISOString(),
        });
      }

      const organization = await organizationService.create(organizationData);

      res.status(201).json({
        success: true,
        message: 'Organization created successfully',
        data: { organization },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Create organization error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Update organization
   * PUT /api/v1/organizations/:id
   */
  async update(req: Request, res: Response) {
    try {
      const id = req.params.id!;
      const updateData = req.body;

      // Check permissions
      if (
        req.user?.role !== UserRole.SUPER_ADMIN &&
        req.user?.organizationId !== id
      ) {
        return res.status(403).json({
          success: false,
          message: 'Access denied',
          error: 'FORBIDDEN',
          timestamp: new Date().toISOString(),
        });
      }

      // Check if organization exists
      const existingOrg = await organizationService.findById(id);

      if (!existingOrg) {
        return res.status(404).json({
          success: false,
          message: 'Organization not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      const organization = await organizationService.update(id, updateData);

      res.json({
        success: true,
        message: 'Organization updated successfully',
        data: { organization },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Update organization error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Update organization status
   * PATCH /api/v1/organizations/:id/status
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

      const organization = await organizationService.updateStatus(id, isActive);

      res.json({
        success: true,
        message: 'Organization status updated successfully',
        data: { organization },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Update organization status error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get organization statistics
   * GET /api/v1/organizations/:id/statistics
   */
  async getStatistics(req: Request, res: Response) {
    try {
      const id = req.params.id!;

      // Check permissions
      if (
        req.user?.role !== UserRole.SUPER_ADMIN &&
        req.user?.organizationId !== id
      ) {
        return res.status(403).json({
          success: false,
          message: 'Access denied',
          error: 'FORBIDDEN',
          timestamp: new Date().toISOString(),
        });
      }

      const statistics = await organizationService.getStatistics(id);

      res.json({
        success: true,
        message: 'Organization statistics retrieved successfully',
        data: { statistics },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Get organization statistics error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
}

export const organizationController = new OrganizationController();
