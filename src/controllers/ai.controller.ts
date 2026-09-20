/**
 * AI Controller
 * Handles HTTP requests for AI provider management and extraction operations
 */

import { Request, Response } from 'express';
import { aiExtractionService } from '../services/ai-extraction.service';
import { prisma } from '../config/database';
import { isRetiredModel, resolveModelName } from '../config/ai-models';

class AIController {
  /**
   * Get all available AI providers (system-wide)
   * GET /api/v1/ai/providers
   */
  async getAvailableProviders(req: Request, res: Response) {
    try {
      const providers = await aiExtractionService.getAvailableProviders();

      res.json({
        success: true,
        data: { providers },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Get available providers error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get available providers',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * List selectable models for a provider
   * GET /api/v1/ai/models?provider=gemini
   *
   * Returns the curated catalog merged with anything a previous discovery run
   * found and persisted on this organization's config.
   */
  async getProviderModels(req: Request, res: Response) {
    try {
      const organizationId = req.user?.organizationId;
      const provider = String(req.query.provider || '').trim();

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization context required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      if (!provider) {
        return res.status(400).json({
          success: false,
          message: 'A provider name is required',
          error: 'MISSING_PROVIDER',
          timestamp: new Date().toISOString(),
        });
      }

      const result = await aiExtractionService.getProviderModels(
        organizationId,
        provider
      );

      res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Get provider models error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get provider models',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Ask the provider which models this organization's key can use, and persist
   * the result so everyone in the organization sees the refreshed list.
   * POST /api/v1/ai/models/discover
   */
  async discoverModels(req: Request, res: Response) {
    try {
      const organizationId = req.user?.organizationId;
      const { aiProviderId, apiKey } = req.body;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization context required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      const result = await aiExtractionService.discoverModels(
        organizationId,
        aiProviderId,
        apiKey
      );

      res.json({
        success: true,
        message:
          result.added > 0
            ? `Found ${result.discovered} models, ${result.added} new.`
            : `Found ${result.discovered} models — your list is already up to date.`,
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Discover models error:', error);
      res.status(400).json({
        success: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to check available models',
        error: 'DISCOVERY_FAILED',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get organization's configured AI providers
   * GET /api/v1/ai/configs
   */
  async getOrganizationConfigs(req: Request, res: Response) {
    try {
      const organizationId = req.user?.organizationId;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization context required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      const configs = await prisma.organizationAIConfig.findMany({
        where: { organizationId },
        include: {
          aiProvider: true,
        },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      });

      // Mask API keys for security, and flag any model the provider retired
      const maskedConfigs = configs.map(config => ({
        ...config,
        apiKey: config.apiKey ? '********' + config.apiKey.slice(-4) : null,
        isModelRetired: isRetiredModel(config.modelName),
        resolvedModel: resolveModelName(config.aiProvider.name, config.modelName),
      }));

      res.json({
        success: true,
        data: { configs: maskedConfigs },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Get organization configs error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get organization AI configs',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Configure AI provider for organization
   * POST /api/v1/ai/configs
   */
  async configureProvider(req: Request, res: Response) {
    try {
      const organizationId = req.user?.organizationId;
      const {
        aiProviderId,
        apiKey,
        modelName,
        isEnabled,
        isPrimary,
        maxTokens,
        temperature,
        thinkingLevel,
        settings,
      } = req.body;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization context required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      // Verify provider exists
      const provider = await prisma.aIProvider.findUnique({
        where: { id: aiProviderId },
      });

      if (!provider) {
        return res.status(404).json({
          success: false,
          message: 'AI provider not found',
          error: 'PROVIDER_NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      // If non-local provider, API key is required
      if (!provider.isLocal && !apiKey) {
        return res.status(400).json({
          success: false,
          message: 'API key is required for this provider',
          error: 'API_KEY_REQUIRED',
          timestamp: new Date().toISOString(),
        });
      }

      const config = await aiExtractionService.configureProvider(
        organizationId,
        aiProviderId,
        {
          apiKey,
          modelName,
          isEnabled: isEnabled ?? true,
          isPrimary: isPrimary ?? false,
          maxTokens,
          temperature,
          settings: await this.mergeSettings(organizationId, aiProviderId, {
            ...(settings || {}),
            ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
          }),
        }
      );

      // Mask API key in response
      const maskedConfig = {
        ...config,
        apiKey: config.apiKey ? '********' + config.apiKey.slice(-4) : null,
      };

      res.status(201).json({
        success: true,
        message: 'AI provider configured successfully',
        data: { config: maskedConfig },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Configure provider error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to configure AI provider',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Merge incoming settings over whatever is already stored, so saving the
   * config form never wipes side-channel state such as the discovered model
   * list written by POST /ai/models/discover.
   */
  private async mergeSettings(
    organizationId: string,
    aiProviderId: string,
    incoming: Record<string, unknown>
  ): Promise<Record<string, unknown> | undefined> {
    const existingConfig = await prisma.organizationAIConfig.findUnique({
      where: {
        organizationId_aiProviderId: { organizationId, aiProviderId },
      },
      select: { settings: true },
    });

    let existing: Record<string, unknown> = {};
    const stored = existingConfig?.settings;
    if (typeof stored === 'string') {
      try {
        existing = JSON.parse(stored);
      } catch {
        existing = {};
      }
    } else if (stored && typeof stored === 'object') {
      existing = stored as Record<string, unknown>;
    }

    const merged = { ...existing, ...incoming };
    return Object.keys(merged).length > 0 ? merged : undefined;
  }

  /**
   * Update AI provider configuration
   * PUT /api/v1/ai/configs/:configId
   */
  async updateConfig(req: Request, res: Response) {
    try {
      const { configId } = req.params;
      const organizationId = req.user?.organizationId;
      const {
        apiKey,
        modelName,
        isEnabled,
        isPrimary,
        maxTokens,
        temperature,
        thinkingLevel,
        settings,
      } = req.body;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization context required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      // Verify config exists and belongs to organization
      const existingConfig = await prisma.organizationAIConfig.findFirst({
        where: {
          id: configId,
          organizationId,
        },
      });

      if (!existingConfig) {
        return res.status(404).json({
          success: false,
          message: 'AI configuration not found',
          error: 'CONFIG_NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      // If setting as primary, unset other primaries
      if (isPrimary) {
        await prisma.organizationAIConfig.updateMany({
          where: {
            organizationId,
            id: { not: configId },
          },
          data: { isPrimary: false },
        });
      }

      const updateData: Record<string, unknown> = {};
      // Responses mask the key as "********abcd". If a client echoes that back
      // we must not persist it — doing so silently destroys the real key and
      // every later request fails with "API key not valid".
      if (apiKey !== undefined && !/^\*{4,}/.test(apiKey)) {
        updateData.apiKey = apiKey;
      }
      if (modelName !== undefined) updateData.modelName = modelName;
      if (isEnabled !== undefined) updateData.isEnabled = isEnabled;
      if (isPrimary !== undefined) updateData.isPrimary = isPrimary;
      if (maxTokens !== undefined) updateData.maxTokens = maxTokens;
      if (temperature !== undefined) updateData.temperature = temperature;
      if (settings !== undefined || thinkingLevel !== undefined) {
        updateData.settings = await this.mergeSettings(
          organizationId,
          existingConfig.aiProviderId,
          {
            ...(settings || {}),
            ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
          }
        );
      }

      const config = await prisma.organizationAIConfig.update({
        where: { id: configId },
        data: updateData,
        include: {
          aiProvider: true,
        },
      });

      // Mask API key in response
      const maskedConfig = {
        ...config,
        apiKey: config.apiKey ? '********' + config.apiKey.slice(-4) : null,
      };

      res.json({
        success: true,
        message: 'AI configuration updated successfully',
        data: { config: maskedConfig },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Update config error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update AI configuration',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Delete AI provider configuration
   * DELETE /api/v1/ai/configs/:configId
   */
  async deleteConfig(req: Request, res: Response) {
    try {
      const { configId } = req.params;
      const organizationId = req.user?.organizationId;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization context required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      // Verify config exists and belongs to organization
      const existingConfig = await prisma.organizationAIConfig.findFirst({
        where: {
          id: configId,
          organizationId,
        },
      });

      if (!existingConfig) {
        return res.status(404).json({
          success: false,
          message: 'AI configuration not found',
          error: 'CONFIG_NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      await prisma.organizationAIConfig.delete({
        where: { id: configId },
      });

      res.json({
        success: true,
        message: 'AI configuration deleted successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Delete config error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete AI configuration',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Test AI provider connection
   * POST /api/v1/ai/configs/:configId/test
   */
  async testConnection(req: Request, res: Response) {
    try {
      const { configId } = req.params;
      const organizationId = req.user?.organizationId;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization context required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      // Get configuration
      const config = await prisma.organizationAIConfig.findFirst({
        where: {
          id: configId,
          organizationId,
        },
        include: {
          aiProvider: true,
        },
      });

      if (!config) {
        return res.status(404).json({
          success: false,
          message: 'AI configuration not found',
          error: 'CONFIG_NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      // Test connection based on provider
      const startTime = Date.now();
      let testResult: { success: boolean; message: string; latency?: number } =
        {
          success: false,
          message: 'Unknown provider',
        };

      try {
        testResult = await this.testProviderConnection(config);
        testResult.latency = Date.now() - startTime;
      } catch (error: any) {
        testResult = {
          success: false,
          message: error.message || 'Connection test failed',
          latency: Date.now() - startTime,
        };
      }

      res.json({
        success: testResult.success,
        message: testResult.message,
        data: {
          provider: config.aiProvider.displayName,
          model: config.modelName,
          latency: testResult.latency,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Test connection error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to test AI connection',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Test a specific provider's connection
   */
  private async testProviderConnection(
    config: any
  ): Promise<{ success: boolean; message: string }> {
    const { aiProvider, apiKey, modelName } = config;
    const providerName = aiProvider.name.toLowerCase();

    switch (providerName) {
      case 'gemini': {
        // Test Gemini connection via the Interactions API
        const { GoogleGenAI } = await import('@google/genai');
        const genAI = new GoogleGenAI({ apiKey });
        const resolved = resolveModelName('gemini', modelName);
        await genAI.interactions.create({
          model: resolved,
          input: 'Say "OK" if you receive this.',
          generation_config: { max_output_tokens: 16 },
        } as any);
        return {
          success: true,
          message: isRetiredModel(modelName)
            ? `Gemini connection successful. Note: "${modelName}" has been retired — using "${resolved}" instead.`
            : `Gemini connection successful (${resolved})`,
        };
      }

      case 'claude': {
        // Test Claude connection
        const Anthropic = (await import('@anthropic-ai/sdk')).default;
        const anthropic = new Anthropic({ apiKey });
        await anthropic.messages.create({
          model: modelName || 'claude-3-sonnet-20240229',
          max_tokens: 10,
          messages: [
            { role: 'user', content: 'Say "OK" if you receive this.' },
          ],
        });
        return { success: true, message: 'Claude connection successful' };
      }

      case 'openai': {
        // Test OpenAI connection
        const OpenAI = (await import('openai')).default;
        const openai = new OpenAI({ apiKey });
        await openai.chat.completions.create({
          model: modelName || 'gpt-4o-mini',
          max_tokens: 10,
          messages: [
            { role: 'user', content: 'Say "OK" if you receive this.' },
          ],
        });
        return { success: true, message: 'OpenAI connection successful' };
      }

      case 'deepseek': {
        // Test DeepSeek connection (uses OpenAI-compatible API)
        const OpenAI = (await import('openai')).default;
        const deepseek = new OpenAI({
          apiKey,
          baseURL: aiProvider.baseUrl || 'https://api.deepseek.com/v1',
        });
        await deepseek.chat.completions.create({
          model: modelName || 'deepseek-chat',
          max_tokens: 10,
          messages: [
            { role: 'user', content: 'Say "OK" if you receive this.' },
          ],
        });
        return { success: true, message: 'DeepSeek connection successful' };
      }

      case 'ollama': {
        // Test Ollama connection
        const baseUrl = aiProvider.baseUrl || 'http://localhost:11434';
        const response = await fetch(`${baseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: modelName || 'llama2',
            prompt: 'Say "OK" if you receive this.',
            stream: false,
          }),
        });
        if (!response.ok) {
          throw new Error(`Ollama returned status ${response.status}`);
        }
        return { success: true, message: 'Ollama connection successful' };
      }

      default:
        return { success: false, message: `Unknown provider: ${providerName}` };
    }
  }

  /**
   * Extract data from document using AI
   * POST /api/v1/ai/extract
   */
  async extractFromDocument(req: Request, res: Response) {
    try {
      const organizationId = req.user?.organizationId;
      const { documentType, imageBase64, pdfUrl, mimeType } = req.body;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization context required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      if (!documentType || (!imageBase64 && !pdfUrl)) {
        return res.status(400).json({
          success: false,
          message:
            'Document type and content (imageBase64 or pdfUrl) are required',
          error: 'MISSING_FIELDS',
          timestamp: new Date().toISOString(),
        });
      }

      const result = await aiExtractionService.extractFromDocument(
        organizationId,
        {
          documentType,
          imageBase64,
          pdfUrl,
          mimeType: mimeType || 'image/jpeg',
        }
      );

      res.json({
        success: result.success,
        message: result.success
          ? 'Data extracted successfully'
          : result.error || 'Extraction failed',
        error: result.success ? undefined : 'EXTRACTION_FAILED',
        data: {
          extractedData: result.data,
          confidence: result.confidence,
          provider: result.provider,
          model: result.model,
          processingTime: result.processingTime,
          documents: result.documents,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Extract from document error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to extract data from document',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Extract from several documents belonging to one client in a single pass.
   * POST /api/v1/ai/extract-batch
   *
   * All files go to the model together so it can reconcile fields across them
   * (identity from an ID, address from a utility bill, salary from a payslip)
   * and classify each file's document type.
   */
  async extractFromDocuments(req: Request, res: Response) {
    try {
      const organizationId = req.user?.organizationId;
      const { documents } = req.body;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization context required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      if (!Array.isArray(documents) || documents.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'At least one document is required',
          error: 'MISSING_DOCUMENTS',
          timestamp: new Date().toISOString(),
        });
      }

      const result = await aiExtractionService.extractFromDocuments(
        organizationId,
        documents.map((doc: any, index: number) => ({
          documentType: doc.documentType || 'OTHER',
          data: doc.data,
          mimeType: doc.mimeType || 'image/jpeg',
          fileName: doc.fileName || `document-${index + 1}`,
        }))
      );

      res.json({
        success: result.success,
        message: result.success
          ? `Extracted details from ${documents.length} document(s)`
          : result.error || 'Extraction failed',
        error: result.success ? undefined : 'EXTRACTION_FAILED',
        data: {
          extractedData: result.data,
          confidence: result.confidence,
          provider: result.provider,
          model: result.model,
          processingTime: result.processingTime,
          documents: result.documents,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Batch extract error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to extract data from documents',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get AI provider usage statistics
   * GET /api/v1/ai/usage
   */
  async getUsageStats(req: Request, res: Response) {
    try {
      const organizationId = req.user?.organizationId;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization context required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      const configs = await prisma.organizationAIConfig.findMany({
        where: { organizationId },
        include: {
          aiProvider: true,
        },
      });

      const usageStats = configs.map(config => ({
        provider: config.aiProvider.displayName,
        model: config.modelName,
        usageThisMonth: config.usageThisMonth,
        usageLimit: config.usageLimit,
        isEnabled: config.isEnabled,
        isPrimary: config.isPrimary,
      }));

      res.json({
        success: true,
        data: { usage: usageStats },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Get usage stats error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get usage statistics',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
}

export const aiController = new AIController();
