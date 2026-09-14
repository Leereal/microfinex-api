import { Router } from 'express';
import {
  isSecretSettingKey,
  redactSecretSettings,
  reservedSettingEndpoint,
} from '../utils/secret-settings';
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

    // Credentials are stripped: this list is readable by any signed-in user,
    // and an integration's API key is not for a teller to see.
    const settings = redactSecretSettings(
      await settingsService.getAll(organizationId)
    );

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

    // A credential is never read back one at a time either.
    if (isSecretSettingKey(key)) {
      return res.status(403).json({
        success: false,
        message: 'This setting holds a credential and cannot be read back.',
        error: 'SECRET_SETTING',
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
  // ORG_ADMIN belongs here: these are the organization's own settings, and its
  // administrator was the one role unable to change them - the newer of the two
  // administrator roles was simply never added to this list.
  authorize(UserRole.ORG_ADMIN, UserRole.ADMIN, UserRole.SUPER_ADMIN),
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
      // An integration's settings go through its own endpoint, which encrypts
      // and validates on the way in - this one would store them as given.
      const ownedBy = reservedSettingEndpoint(key);
      if (ownedBy) {
        return res.status(400).json({
          success: false,
          message: `This setting is managed by its integration. Update it through ${ownedBy}.`,
          error: 'RESERVED_SETTING',
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
