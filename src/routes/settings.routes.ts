import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth-supabase';
import { validateRequest } from '../middleware/validation';
import { UserRole } from '../types';
import { settingsService } from '../services/settings.service';

const router = Router();

// Validation schemas
const updateSettingSchema = z.object({
  settingValue: z.any(),
  description: z.string().optional(),
});

/**
 * @swagger
 * /api/v1/settings:
 *   get:
 *     summary: Get all settings for organization
 *     tags: [Settings]
 *     security:
 *       - bearerAuth: []
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'User does not belong to an organization',
        error: 'NO_ORGANIZATION',
        timestamp: new Date().toISOString(),
      });
    }

    const settings = await settingsService.getAll(organizationId);

    res.json({
      success: true,
      message: 'Settings retrieved successfully',
      data: { settings },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Get settings error:', error);
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
 * /api/v1/settings/{key}:
 *   get:
 *     summary: Get single setting value
 *     tags: [Settings]
 *     security:
 *       - bearerAuth: []
 */
router.get('/:key', authenticate, async (req, res) => {
  try {
    const { key } = req.params;
    if (!key) {
      return res.status(400).json({
        success: false,
        message: 'Setting key is required',
        error: 'MISSING_KEY',
        timestamp: new Date().toISOString(),
      });
    }
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'User does not belong to an organization',
        error: 'NO_ORGANIZATION',
        timestamp: new Date().toISOString(),
      });
    }

    const value = await settingsService.get(organizationId, key);

    res.json({
      success: true,
      message: 'Setting retrieved successfully',
      data: { key, value },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Get setting error:', error);
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
 * /api/v1/settings/{key}:
 *   put:
 *     summary: Update setting
 *     tags: [Settings]
 *     security:
 *       - bearerAuth: []
 */
router.put(
  '/:key',
  authenticate,
  authorize(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateRequest(updateSettingSchema),
  async (req, res) => {
    try {
      const { key } = req.params;
      if (!key) {
        return res.status(400).json({
          success: false,
          message: 'Setting key is required',
          error: 'MISSING_KEY',
          timestamp: new Date().toISOString(),
        });
      }
      const { settingValue, description } = req.body;
      const organizationId = req.user?.organizationId;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'User does not belong to an organization',
          error: 'NO_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      const setting = await settingsService.set(organizationId, {
        settingKey: key,
        settingValue,
        description,
        updatedBy: req.user?.userId,
      });

      res.json({
        success: true,
        message: 'Setting updated successfully',
        data: { setting },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Update setting error:', error);
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
 * /api/v1/settings/reset/{key}:
 *   post:
 *     summary: Reset setting to default
 *     tags: [Settings]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/reset/:key',
  authenticate,
  authorize(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  async (req, res) => {
    try {
      const { key } = req.params;
      if (!key) {
        return res.status(400).json({
          success: false,
          message: 'Setting key is required',
          error: 'MISSING_KEY',
          timestamp: new Date().toISOString(),
        });
      }
      const organizationId = req.user?.organizationId;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'User does not belong to an organization',
          error: 'NO_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      await settingsService.reset(organizationId, key);

      res.json({
        success: true,
        message: 'Setting reset successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Reset setting error:', error);
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
