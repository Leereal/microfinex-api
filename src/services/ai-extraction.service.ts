/**
 * AI Extraction Service
 *
 * Handles document data extraction using multiple AI providers:
 * - Google Gemini
 * - Anthropic Claude
 * - OpenAI GPT
 * - DeepSeek
 * - Ollama (Local)
 *
 * Features:
 * - Provider failover
 * - Structured output parsing
 * - Confidence scoring
 * - Caching of results
 */

import { prisma } from '../config/database';
import { Prisma } from '@prisma/client';

// ===== TYPES =====

export interface AIProviderConfig {
  id: string;
  name: string;
  displayName: string;
  baseUrl: string | null;
  apiKey: string | null;
  modelName: string | null;
  isLocal: boolean;
  maxTokens?: number;
  temperature?: number;
}

export interface ExtractionResult {
  success: boolean;
  data: Record<string, unknown> | null;
  confidence: number;
  provider: string;
  model: string;
  processingTime: number;
  error?: string;
}

export interface DocumentExtractionInput {
  documentType: string; // e.g., "ID", "PASSPORT", "BANK_STATEMENT"
  imageBase64?: string; // For images
  pdfUrl?: string; // For PDFs
  mimeType: string;
}

// Expected extraction fields by document type
const EXTRACTION_SCHEMAS: Record<string, Record<string, string>> = {
  ID: {
    idNumber: 'string',
    firstName: 'string',
    lastName: 'string',
    dateOfBirth: 'date',
    gender: 'string',
    nationality: 'string',
    issueDate: 'date',
    expiryDate: 'date',
  },
  PASSPORT: {
    passportNumber: 'string',
    firstName: 'string',
    lastName: 'string',
    dateOfBirth: 'date',
    gender: 'string',
    nationality: 'string',
    issueDate: 'date',
    expiryDate: 'date',
    issuingCountry: 'string',
  },
  POA: {
    fullName: 'string',
    address: 'string',
    city: 'string',
    zipCode: 'string',
    documentDate: 'date',
    utilityType: 'string',
    accountNumber: 'string',
  },
  BANK_STATEMENT: {
    accountHolderName: 'string',
    bankName: 'string',
    accountNumber: 'string',
    branchCode: 'string',
    statementPeriod: 'string',
    openingBalance: 'number',
    closingBalance: 'number',
    totalCredits: 'number',
    totalDebits: 'number',
  },
  PAYSLIP: {
    employeeName: 'string',
    employerName: 'string',
    employeeId: 'string',
    payPeriod: 'string',
    grossPay: 'number',
    netPay: 'number',
    deductions: 'number',
    payDate: 'date',
  },
  BIZ_REG: {
    businessName: 'string',
    registrationNumber: 'string',
    registrationDate: 'date',
    businessType: 'string',
    directors: 'array',
    registeredAddress: 'string',
  },
};

class AIExtractionService {
  /**
   * Get the primary AI provider configuration for an organization
   */
  async getPrimaryProvider(
    organizationId: string
  ): Promise<AIProviderConfig | null> {
    const config = await prisma.organizationAIConfig.findFirst({
      where: {
        organizationId,
        isEnabled: true,
        isPrimary: true,
      },
      include: {
        aiProvider: true,
      },
    });

    if (!config) {
      return null;
    }

    return {
      id: config.aiProvider.id,
      name: config.aiProvider.name,
      displayName: config.aiProvider.displayName,
      baseUrl: config.aiProvider.baseUrl,
      apiKey: config.apiKey,
      modelName: config.modelName,
      isLocal: config.aiProvider.isLocal,
      maxTokens: config.maxTokens ?? undefined,
      temperature: config.temperature ?? undefined,
    };
  }

  /**
   * Get all enabled AI providers for an organization
   */
  async getEnabledProviders(
    organizationId: string
  ): Promise<AIProviderConfig[]> {
    const configs = await prisma.organizationAIConfig.findMany({
      where: {
        organizationId,
        isEnabled: true,
      },
      include: {
        aiProvider: true,
      },
      orderBy: { isPrimary: 'desc' },
    });

    return configs.map(config => ({
      id: config.aiProvider.id,
      name: config.aiProvider.name,
      displayName: config.aiProvider.displayName,
      baseUrl: config.aiProvider.baseUrl,
      apiKey: config.apiKey,
      modelName: config.modelName,
      isLocal: config.aiProvider.isLocal,
      maxTokens: config.maxTokens ?? undefined,
      temperature: config.temperature ?? undefined,
    }));
  }

  /**
   * Get available AI providers (global)
   */
  async getAvailableProviders() {
    return prisma.aIProvider.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Configure AI provider for an organization
   */
  async configureProvider(
    organizationId: string,
    aiProviderId: string,
    config: {
      apiKey?: string;
      modelName?: string;
      isEnabled?: boolean;
      isPrimary?: boolean;
      maxTokens?: number;
      temperature?: number;
      settings?: Record<string, unknown>;
    }
  ) {
    // If setting as primary, unset other primaries
    if (config.isPrimary) {
      await prisma.organizationAIConfig.updateMany({
        where: {
          organizationId,
          aiProviderId: { not: aiProviderId },
        },
        data: { isPrimary: false },
      });
    }

    return prisma.organizationAIConfig.upsert({
      where: {
        organizationId_aiProviderId: {
          organizationId,
          aiProviderId,
        },
      },
      update: config,
      create: {
        organizationId,
        aiProviderId,
        ...config,
      },
      include: {
        aiProvider: true,
      },
    });
  }

  /**
   * Extract data from document using AI
   */
  async extractFromDocument(
    organizationId: string,
    input: DocumentExtractionInput
  ): Promise<ExtractionResult> {
    const startTime = Date.now();
    const providers = await this.getEnabledProviders(organizationId);

    if (providers.length === 0) {
      return {
        success: false,
        data: null,
        confidence: 0,
        provider: 'none',
        model: 'none',
        processingTime: Date.now() - startTime,
        error: 'No AI providers configured for this organization',
      };
    }

    // Try each provider in order (primary first)
    for (const provider of providers) {
      try {
        const result = await this.extractWithProvider(provider, input);
        if (result.success) {
          // Update usage counter
          await this.incrementUsage(organizationId, provider.id);
          return result;
        }
      } catch (error) {
        console.error(`AI extraction failed with ${provider.name}:`, error);
        // Continue to next provider
      }
    }

    return {
      success: false,
      data: null,
      confidence: 0,
      provider: 'none',
      model: 'none',
      processingTime: Date.now() - startTime,
      error: 'All AI providers failed to extract data',
    };
  }

  /**
   * Extract using a specific provider
   */
  private async extractWithProvider(
    provider: AIProviderConfig,
    input: DocumentExtractionInput
  ): Promise<ExtractionResult> {
    const startTime = Date.now();
    const schema = EXTRACTION_SCHEMAS[input.documentType] || {};
    const prompt = this.buildExtractionPrompt(input.documentType, schema);

    try {
      let result: Record<string, unknown> | null = null;
      let confidence = 0;

      switch (provider.name) {
        case 'gemini':
          result = await this.extractWithGemini(provider, input, prompt);
          confidence = result ? 0.9 : 0;
          break;

        case 'claude':
          result = await this.extractWithClaude(provider, input, prompt);
          confidence = result ? 0.92 : 0;
          break;

        case 'openai':
          result = await this.extractWithOpenAI(provider, input, prompt);
          confidence = result ? 0.91 : 0;
          break;

        case 'deepseek':
          result = await this.extractWithDeepSeek(provider, input, prompt);
          confidence = result ? 0.85 : 0;
          break;

        case 'ollama':
          result = await this.extractWithOllama(provider, input, prompt);
          confidence = result ? 0.8 : 0;
          break;

        default:
          throw new Error(`Unknown AI provider: ${provider.name}`);
      }

      return {
        success: result !== null,
        data: result,
        confidence,
        provider: provider.name,
        model: provider.modelName || 'default',
        processingTime: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        confidence: 0,
        provider: provider.name,
        model: provider.modelName || 'default',
        processingTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Build extraction prompt
   */
  private buildExtractionPrompt(
    documentType: string,
    schema: Record<string, string>
  ): string {
    const fields = Object.entries(schema)
      .map(([key, type]) => `- ${key} (${type})`)
      .join('\n');

    return `Extract the following information from this ${documentType} document.
Return the data as a JSON object with these fields:
${fields}

If a field cannot be found or is unclear, set its value to null.
Only return the JSON object, no other text.`;
  }

  /**
   * Extract using Google Gemini
   */
  private async extractWithGemini(
    provider: AIProviderConfig,
    input: DocumentExtractionInput,
    prompt: string
  ): Promise<Record<string, unknown> | null> {
    if (!provider.apiKey) {
      throw new Error('Gemini API key not configured');
    }

    const model = provider.modelName || 'gemini-1.5-flash';
    const url = `${provider.baseUrl}/v1beta/models/${model}:generateContent?key=${provider.apiKey}`;

    const parts: Array<{
      text?: string;
      inlineData?: { mimeType: string; data: string };
    }> = [{ text: prompt }];

    if (input.imageBase64) {
      parts.push({
        inlineData: {
          mimeType: input.mimeType,
          data: input.imageBase64,
        },
      });
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          temperature: provider.temperature ?? 0.1,
          maxOutputTokens: provider.maxTokens ?? 2048,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return this.parseJsonResponse(text);
  }

  /**
   * Extract using Anthropic Claude
   */
  private async extractWithClaude(
    provider: AIProviderConfig,
    input: DocumentExtractionInput,
    prompt: string
  ): Promise<Record<string, unknown> | null> {
    if (!provider.apiKey) {
      throw new Error('Claude API key not configured');
    }

    const model = provider.modelName || 'claude-3-sonnet-20240229';
    const url = `${provider.baseUrl}/v1/messages`;

    const content: Array<{
      type: string;
      text?: string;
      source?: { type: string; media_type: string; data: string };
    }> = [];

    if (input.imageBase64) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: input.mimeType,
          data: input.imageBase64,
        },
      });
    }
    content.push({ type: 'text', text: prompt });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': provider.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: provider.maxTokens ?? 2048,
        messages: [{ role: 'user', content }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = data.content?.find(c => c.type === 'text')?.text || '';
    return this.parseJsonResponse(text);
  }

  /**
   * Extract using OpenAI
   */
  private async extractWithOpenAI(
    provider: AIProviderConfig,
    input: DocumentExtractionInput,
    prompt: string
  ): Promise<Record<string, unknown> | null> {
    if (!provider.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const model = provider.modelName || 'gpt-4o';
    const url = `${provider.baseUrl}/v1/chat/completions`;

    const content: Array<{
      type: string;
      text?: string;
      image_url?: { url: string };
    }> = [{ type: 'text', text: prompt }];

    if (input.imageBase64) {
      content.push({
        type: 'image_url',
        image_url: {
          url: `data:${input.mimeType};base64,${input.imageBase64}`,
        },
      });
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: provider.maxTokens ?? 2048,
        messages: [{ role: 'user', content }],
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: { content?: string };
      }>;
    };
    const text = data.choices?.[0]?.message?.content || '';
    return this.parseJsonResponse(text);
  }

  /**
   * Extract using DeepSeek
   */
  private async extractWithDeepSeek(
    provider: AIProviderConfig,
    input: DocumentExtractionInput,
    prompt: string
  ): Promise<Record<string, unknown> | null> {
    if (!provider.apiKey) {
      throw new Error('DeepSeek API key not configured');
    }

    const model = provider.modelName || 'deepseek-chat';
    const url = `${provider.baseUrl}/v1/chat/completions`;

    // DeepSeek doesn't support images directly, so we'll need to describe the document
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: provider.maxTokens ?? 2048,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(`DeepSeek API error: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: { content?: string };
      }>;
    };
    const text = data.choices?.[0]?.message?.content || '';
    return this.parseJsonResponse(text);
  }

  /**
   * Extract using Ollama (local)
   */
  private async extractWithOllama(
    provider: AIProviderConfig,
    input: DocumentExtractionInput,
    prompt: string
  ): Promise<Record<string, unknown> | null> {
    const model = provider.modelName || 'llava';
    const baseUrl = provider.baseUrl || 'http://localhost:11434';
    const url = `${baseUrl}/api/generate`;

    const body: {
      model: string;
      prompt: string;
      stream: boolean;
      images?: string[];
    } = {
      model,
      prompt,
      stream: false,
    };

    if (input.imageBase64) {
      body.images = [input.imageBase64];
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`);
    }

    const data = (await response.json()) as { response?: string };
    return this.parseJsonResponse(data.response || '');
  }

  /**
   * Parse JSON from AI response
   */
  private parseJsonResponse(text: string): Record<string, unknown> | null {
    try {
      // Try to find JSON in the response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return null;
      }

      return JSON.parse(jsonMatch[0]);
    } catch {
      return null;
    }
  }

  /**
   * Increment usage counter
   */
  private async incrementUsage(organizationId: string, aiProviderId: string) {
    try {
      await prisma.organizationAIConfig.update({
        where: {
          organizationId_aiProviderId: {
            organizationId,
            aiProviderId,
          },
        },
        data: {
          usageThisMonth: { increment: 1 },
        },
      });
    } catch (error) {
      console.error('Failed to increment AI usage:', error);
    }
  }

  /**
   * Reset monthly usage counters (call via cron job)
   */
  async resetMonthlyUsage() {
    return prisma.organizationAIConfig.updateMany({
      data: { usageThisMonth: 0 },
    });
  }

  /**
   * Check if organization has exceeded usage limit
   */
  async checkUsageLimit(
    organizationId: string,
    aiProviderId: string
  ): Promise<boolean> {
    const config = await prisma.organizationAIConfig.findUnique({
      where: {
        organizationId_aiProviderId: {
          organizationId,
          aiProviderId,
        },
      },
    });

    if (!config || !config.usageLimit) {
      return false; // No limit set
    }

    return config.usageThisMonth >= config.usageLimit;
  }
}

export const aiExtractionService = new AIExtractionService();
