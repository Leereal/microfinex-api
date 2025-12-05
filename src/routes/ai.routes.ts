/**
 * AI Routes
 * API endpoints for AI provider management and document extraction
 */

import { Router } from 'express';
import { z } from 'zod';
import {
  authenticateToken,
  requirePermission,
} from '../middleware/auth.middleware';
import {
  validateRequest,
  handleAsync,
} from '../middleware/validation.middleware';
import { aiController } from '../controllers/ai.controller';

const router = Router();

// All AI routes require authentication
router.use(authenticateToken);

// ===================
// AI Provider Routes
// ===================

/**
 * Get all available AI providers (system-wide)
 * GET /api/v1/ai/providers
 */
router.get(
  '/providers',
  requirePermission('settings:view'),
  handleAsync(aiController.getAvailableProviders.bind(aiController))
);

/**
 * Get organization's AI configurations
 * GET /api/v1/ai/configs
 */
router.get(
  '/configs',
  requirePermission('settings:view'),
  handleAsync(aiController.getOrganizationConfigs.bind(aiController))
);

/**
 * Configure AI provider for organization
 * POST /api/v1/ai/configs
 */
const configureProviderSchema = z.object({
  body: z.object({
    aiProviderId: z.string().uuid('Invalid provider ID'),
    apiKey: z.string().min(1).optional(),
    modelName: z.string().optional(),
    isEnabled: z.boolean().optional(),
    isPrimary: z.boolean().optional(),
    maxTokens: z.number().int().positive().optional(),
    temperature: z.number().min(0).max(2).optional(),
    settings: z.record(z.unknown()).optional(),
  }),
});

router.post(
  '/configs',
  requirePermission('settings:manage'),
  validateRequest(configureProviderSchema),
  handleAsync(aiController.configureProvider.bind(aiController))
);

/**
 * Update AI provider configuration
 * PUT /api/v1/ai/configs/:configId
 */
const updateConfigSchema = z.object({
  params: z.object({
    configId: z.string().uuid('Invalid config ID'),
  }),
  body: z.object({
    apiKey: z.string().min(1).optional(),
    modelName: z.string().optional(),
    isEnabled: z.boolean().optional(),
    isPrimary: z.boolean().optional(),
    maxTokens: z.number().int().positive().optional(),
    temperature: z.number().min(0).max(2).optional(),
    settings: z.record(z.unknown()).optional(),
  }),
});

router.put(
  '/configs/:configId',
  requirePermission('settings:manage'),
  validateRequest(updateConfigSchema),
  handleAsync(aiController.updateConfig.bind(aiController))
);

/**
 * Delete AI provider configuration
 * DELETE /api/v1/ai/configs/:configId
 */
const deleteConfigSchema = z.object({
  params: z.object({
    configId: z.string().uuid('Invalid config ID'),
  }),
});

router.delete(
  '/configs/:configId',
  requirePermission('settings:manage'),
  validateRequest(deleteConfigSchema),
  handleAsync(aiController.deleteConfig.bind(aiController))
);

/**
 * Test AI provider connection
 * POST /api/v1/ai/configs/:configId/test
 */
const testConnectionSchema = z.object({
  params: z.object({
    configId: z.string().uuid('Invalid config ID'),
  }),
});

router.post(
  '/configs/:configId/test',
  requirePermission('settings:manage'),
  validateRequest(testConnectionSchema),
  handleAsync(aiController.testConnection.bind(aiController))
);

/**
 * Extract data from document using AI
 * POST /api/v1/ai/extract
 */
const extractSchema = z.object({
  body: z
    .object({
      documentType: z.string().min(1, 'Document type is required'),
      imageBase64: z.string().optional(),
      pdfUrl: z.string().url().optional(),
      mimeType: z.string().optional(),
    })
    .refine(data => data.imageBase64 || data.pdfUrl, {
      message: 'Either imageBase64 or pdfUrl is required',
    }),
});

router.post(
  '/extract',
  requirePermission('documents:view'),
  validateRequest(extractSchema),
  handleAsync(aiController.extractFromDocument.bind(aiController))
);

/**
 * Get AI usage statistics
 * GET /api/v1/ai/usage
 */
router.get(
  '/usage',
  requirePermission('settings:view'),
  handleAsync(aiController.getUsageStats.bind(aiController))
);

export default router;
