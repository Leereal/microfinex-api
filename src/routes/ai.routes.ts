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
  validateParams,
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
  requirePermission('ai:view'),
  handleAsync(aiController.getAvailableProviders.bind(aiController))
);

/**
 * List selectable models for a provider (catalog + previously discovered)
 * GET /api/v1/ai/models?provider=gemini
 */
router.get(
  '/models',
  requirePermission('ai:view'),
  handleAsync(aiController.getProviderModels.bind(aiController))
);

/**
 * Check which models the configured API key can actually use, and persist them
 * POST /api/v1/ai/models/discover
 */
const discoverModelsSchema = z.object({
  aiProviderId: z.string().uuid('Invalid provider ID'),
  apiKey: z.string().min(1).optional(),
});

router.post(
  '/models/discover',
  requirePermission('ai:manage'),
  validateRequest(discoverModelsSchema),
  handleAsync(aiController.discoverModels.bind(aiController))
);

/**
 * Get organization's AI configurations
 * GET /api/v1/ai/configs
 */
router.get(
  '/configs',
  requirePermission('ai:view'),
  handleAsync(aiController.getOrganizationConfigs.bind(aiController))
);

/**
 * Configure AI provider for organization
 * POST /api/v1/ai/configs
 */
const configureProviderSchema = z.object({
  aiProviderId: z.string().uuid('Invalid provider ID'),
  apiKey: z.string().min(1).optional(),
  modelName: z.string().optional(),
  isEnabled: z.boolean().optional(),
  isPrimary: z.boolean().optional(),
  maxTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  thinkingLevel: z.enum(['minimal', 'low', 'medium', 'high']).optional(),
  settings: z.record(z.unknown()).optional(),
});

router.post(
  '/configs',
  requirePermission('ai:manage'),
  validateRequest(configureProviderSchema),
  handleAsync(aiController.configureProvider.bind(aiController))
);

/**
 * Update AI provider configuration
 * PUT /api/v1/ai/configs/:configId
 */
const updateConfigSchema = z.object({
  apiKey: z.string().min(1).optional(),
  modelName: z.string().optional(),
  isEnabled: z.boolean().optional(),
  isPrimary: z.boolean().optional(),
  maxTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  thinkingLevel: z.enum(['minimal', 'low', 'medium', 'high']).optional(),
  settings: z.record(z.unknown()).optional(),
});

router.put(
  '/configs/:configId',
  requirePermission('ai:manage'),
  validateRequest(updateConfigSchema),
  handleAsync(aiController.updateConfig.bind(aiController))
);

/**
 * Delete AI provider configuration
 * DELETE /api/v1/ai/configs/:configId
 */
const deleteConfigParamsSchema = z.object({
  configId: z.string().uuid('Invalid config ID'),
});

router.delete(
  '/configs/:configId',
  requirePermission('ai:manage'),
  validateParams(deleteConfigParamsSchema),
  handleAsync(aiController.deleteConfig.bind(aiController))
);

/**
 * Test AI provider connection
 * POST /api/v1/ai/configs/:configId/test
 */
const testConnectionParamsSchema = z.object({
  configId: z.string().uuid('Invalid config ID'),
});

router.post(
  '/configs/:configId/test',
  requirePermission('ai:manage'),
  validateParams(testConnectionParamsSchema),
  handleAsync(aiController.testConnection.bind(aiController))
);

/**
 * Extract data from document using AI
 * POST /api/v1/ai/extract
 */
const extractSchema = z
  .object({
    documentType: z.string().min(1, 'Document type is required'),
    imageBase64: z.string().optional(),
    pdfUrl: z.string().url().optional(),
    mimeType: z.string().optional(),
  })
  .refine(data => data.imageBase64 || data.pdfUrl, {
    message: 'Either imageBase64 or pdfUrl is required',
  });

router.post(
  '/extract',
  requirePermission('ai:extract'),
  validateRequest(extractSchema),
  handleAsync(aiController.extractFromDocument.bind(aiController))
);

/**
 * Extract from several documents for one client in a single model call
 * POST /api/v1/ai/extract-batch
 */
const extractBatchSchema = z.object({
  documents: z
    .array(
      z.object({
        documentType: z.string().optional(),
        data: z.string().min(1, 'Document data is required'),
        mimeType: z.string().optional(),
        fileName: z.string().optional(),
      })
    )
    .min(1, 'At least one document is required')
    .max(20, 'At most 20 documents can be extracted at once'),
});

router.post(
  '/extract-batch',
  requirePermission('ai:extract'),
  validateRequest(extractBatchSchema),
  handleAsync(aiController.extractFromDocuments.bind(aiController))
);

/**
 * Get AI usage statistics
 * GET /api/v1/ai/usage
 */
router.get(
  '/usage',
  requirePermission('ai:view'),
  handleAsync(aiController.getUsageStats.bind(aiController))
);

export default router;
