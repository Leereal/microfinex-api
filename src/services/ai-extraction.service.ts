/**
 * AI Extraction Service
 *
 * Handles document data extraction using Google Gemini with structured schemas
 * Similar to the resume parser approach - defines exact fields to extract
 * and returns structured JSON that maps directly to form fields.
 *
 * Features:
 * - Structured schema-based extraction
 * - Provider failover
 * - Direct mapping to client form fields
 * - Confidence scoring
 */

import {
  GoogleGenerativeAI,
  SchemaType,
  type Schema,
} from '@google/generative-ai';
import { prisma } from '../config/database';

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
  data: ClientFormData | null;
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

/**
 * Client Form Data Structure
 * This matches the frontend client form fields exactly
 */
export interface ClientFormData {
  // Personal Information
  first_name: string | null;
  last_name: string | null;
  middle_name: string | null;
  full_name: string | null;
  date_of_birth: string | null; // YYYY-MM-DD format
  gender: string | null; // "male" or "female"
  nationality: string | null;
  marital_status: string | null;
  title: string | null; // Mr, Mrs, Miss, Ms, Dr, Prof

  // Identification
  id_type: string | null; // "national_id" or "passport"
  id_number: string | null;
  national_id: string | null;
  passport_number: string | null;
  passport_country: string | null;
  id_issue_date: string | null;
  id_expiry_date: string | null;

  // Address
  street_number: string | null;
  suburb: string | null;
  city: string | null;
  state: string | null; // province
  country: string | null;
  postal_code: string | null;

  // Employment
  employer_name: string | null;
  employer_address: string | null;
  employer_phone: string | null;
  employer_email: string | null;
  occupation: string | null; // job title
  employment_date: string | null;
  salary: number | null;
  net_salary: number | null;
  gross_salary: number | null;

  // Bank Details
  bank_name: string | null;
  account_number: string | null;
  branch_code: string | null;
  branch_name: string | null;

  // Contact
  phone: string | null;
  email: string | null;

  // Next of Kin
  nok_first_name: string | null;
  nok_last_name: string | null;
  nok_phone: string | null;
  nok_relationship: string | null;
  nok_address: string | null;

  // Business (for business clients)
  business_name: string | null;
  registration_number: string | null;
  business_type: string | null;
  industry: string | null;
  business_address: string | null;

  // Document Type Detection
  detected_document_type: string | null; // ID, PASSPORT, POA, BANK_STATEMENT, PAYSLIP, EMPLOYMENT_LETTER, BIZ_REG, PHOTO, OTHER
}

/**
 * Structured schema for client document extraction
 * Uses Google Gemini's SchemaType for guaranteed JSON structure
 */
const clientDocumentSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    // Personal Information
    first_name: {
      type: SchemaType.STRING,
      description: 'First name / given name of the person',
      nullable: true,
    },
    last_name: {
      type: SchemaType.STRING,
      description: 'Last name / surname / family name of the person',
      nullable: true,
    },
    middle_name: {
      type: SchemaType.STRING,
      description: 'Middle name if present',
      nullable: true,
    },
    full_name: {
      type: SchemaType.STRING,
      description: 'Full name as it appears on the document',
      nullable: true,
    },
    date_of_birth: {
      type: SchemaType.STRING,
      description: 'Date of birth in YYYY-MM-DD format (e.g., "1990-05-15")',
      nullable: true,
    },
    gender: {
      type: SchemaType.STRING,
      description: 'Gender - must be exactly "male" or "female" (lowercase)',
      nullable: true,
    },
    nationality: {
      type: SchemaType.STRING,
      description:
        'Nationality or citizenship (e.g., "Zimbabwean", "South African")',
      nullable: true,
    },
    marital_status: {
      type: SchemaType.STRING,
      description: 'Marital status (Single, Married, Divorced, Widowed)',
      nullable: true,
    },
    title: {
      type: SchemaType.STRING,
      description: 'Title (Mr, Mrs, Miss, Ms, Dr, Prof)',
      nullable: true,
    },

    // Identification
    id_type: {
      type: SchemaType.STRING,
      description:
        'Type of ID document - must be "national_id" or "passport" (lowercase)',
      nullable: true,
    },
    id_number: {
      type: SchemaType.STRING,
      description: 'The ID number or passport number from the document',
      nullable: true,
    },
    national_id: {
      type: SchemaType.STRING,
      description: 'National ID number if this is an ID card',
      nullable: true,
    },
    passport_number: {
      type: SchemaType.STRING,
      description: 'Passport number if this is a passport',
      nullable: true,
    },
    passport_country: {
      type: SchemaType.STRING,
      description:
        'Country that issued the passport (e.g., "Zimbabwe", "South Africa"). Look for issuing authority, country code, or place of issue on the passport.',
      nullable: true,
    },
    id_issue_date: {
      type: SchemaType.STRING,
      description: 'Date the ID was issued in YYYY-MM-DD format',
      nullable: true,
    },
    id_expiry_date: {
      type: SchemaType.STRING,
      description: 'Expiry date of the ID in YYYY-MM-DD format',
      nullable: true,
    },

    // Address
    street_number: {
      type: SchemaType.STRING,
      description: 'Street address including house/unit number and street name',
      nullable: true,
    },
    suburb: {
      type: SchemaType.STRING,
      description: 'Suburb, neighborhood, or area name',
      nullable: true,
    },
    city: {
      type: SchemaType.STRING,
      description: 'City or town name',
      nullable: true,
    },
    state: {
      type: SchemaType.STRING,
      description: 'State, province, or region',
      nullable: true,
    },
    country: {
      type: SchemaType.STRING,
      description: 'Country name',
      nullable: true,
    },
    postal_code: {
      type: SchemaType.STRING,
      description: 'Postal code or ZIP code',
      nullable: true,
    },

    // Employment
    employer_name: {
      type: SchemaType.STRING,
      description: 'Name of the employer or company',
      nullable: true,
    },
    employer_address: {
      type: SchemaType.STRING,
      description: 'Address of the employer',
      nullable: true,
    },
    employer_phone: {
      type: SchemaType.STRING,
      description: 'Phone number of the employer',
      nullable: true,
    },
    employer_email: {
      type: SchemaType.STRING,
      description: 'Email address of the employer',
      nullable: true,
    },
    occupation: {
      type: SchemaType.STRING,
      description: 'Job title or occupation',
      nullable: true,
    },
    employment_date: {
      type: SchemaType.STRING,
      description: 'Date employment started in YYYY-MM-DD format',
      nullable: true,
    },
    salary: {
      type: SchemaType.NUMBER,
      description: 'Basic salary as a number without currency symbols',
      nullable: true,
    },
    net_salary: {
      type: SchemaType.NUMBER,
      description:
        'Net salary (take-home pay) as a number without currency symbols',
      nullable: true,
    },
    gross_salary: {
      type: SchemaType.NUMBER,
      description: 'Gross salary as a number without currency symbols',
      nullable: true,
    },

    // Bank Details
    bank_name: {
      type: SchemaType.STRING,
      description: 'Name of the bank',
      nullable: true,
    },
    account_number: {
      type: SchemaType.STRING,
      description: 'Bank account number',
      nullable: true,
    },
    branch_code: {
      type: SchemaType.STRING,
      description: 'Bank branch code or sort code',
      nullable: true,
    },
    branch_name: {
      type: SchemaType.STRING,
      description: 'Name of the bank branch',
      nullable: true,
    },

    // Contact
    phone: {
      type: SchemaType.STRING,
      description: 'Phone number(s) - format based on country',
      nullable: true,
    },
    email: {
      type: SchemaType.STRING,
      description: 'Email address',
      nullable: true,
    },

    // Next of Kin
    nok_first_name: {
      type: SchemaType.STRING,
      description: 'Next of kin first name',
      nullable: true,
    },
    nok_last_name: {
      type: SchemaType.STRING,
      description: 'Next of kin last name',
      nullable: true,
    },
    nok_phone: {
      type: SchemaType.STRING,
      description: 'Next of kin phone number',
      nullable: true,
    },
    nok_relationship: {
      type: SchemaType.STRING,
      description:
        'Relationship to next of kin (e.g., Spouse, Parent, Sibling)',
      nullable: true,
    },
    nok_address: {
      type: SchemaType.STRING,
      description: 'Next of kin address',
      nullable: true,
    },

    // Business (for business registration documents)
    business_name: {
      type: SchemaType.STRING,
      description: 'Registered business name',
      nullable: true,
    },
    registration_number: {
      type: SchemaType.STRING,
      description: 'Business registration number',
      nullable: true,
    },
    business_type: {
      type: SchemaType.STRING,
      description:
        'Type of business (Sole Proprietor, Partnership, Private Limited, etc.)',
      nullable: true,
    },
    industry: {
      type: SchemaType.STRING,
      description: 'Industry or business activity',
      nullable: true,
    },
    business_address: {
      type: SchemaType.STRING,
      description: 'Business address',
      nullable: true,
    },

    // Document Type Detection
    detected_document_type: {
      type: SchemaType.STRING,
      description:
        'The type of document detected from the content. Must be one of: ID, PASSPORT, POA, BANK_STATEMENT, PAYSLIP, EMPLOYMENT_LETTER, BIZ_REG, PHOTO, OTHER',
      nullable: true,
    },
  },
  required: [],
};

/**
 * Document type prompts - tells AI what to look for based on document type
 */
const DOCUMENT_EXTRACTION_PROMPTS: Record<string, string> = {
  ID: `You are extracting information from a NATIONAL ID CARD.

FOCUS ON EXTRACTING:
- ID number (national_id and id_number fields)
- Full name (split into first_name, last_name, middle_name)
- Date of birth (date_of_birth in YYYY-MM-DD format)
- Gender (gender as "male" or "female" lowercase)
- Nationality
- Address if shown
- Issue date and expiry date (in YYYY-MM-DD format)

SET id_type to "national_id"
SET detected_document_type to "ID"`,

  PASSPORT: `You are extracting information from a PASSPORT.

FOCUS ON EXTRACTING:
- Passport number (passport_number and id_number fields)
- Full name (split into first_name, last_name, middle_name)
- Date of birth (date_of_birth in YYYY-MM-DD format)
- Gender (gender as "male" or "female" lowercase)
- Nationality (nationality field - e.g., "Zimbabwean", "South African")
- Place of birth (can be used for city if applicable)
- Issue date (id_issue_date in YYYY-MM-DD format)
- Expiry date (id_expiry_date in YYYY-MM-DD format)
- Issuing country/Country Code (passport_country - the country that issued the passport, e.g., "Zimbabwe", "South Africa", "ZWE", "ZAF")

SET id_type to "passport"
SET detected_document_type to "PASSPORT"`,

  POA: `You are extracting information from a PROOF OF ADDRESS document (utility bill, bank letter, etc.).

FOCUS ON EXTRACTING:
- Full name of the addressee
- Complete address (street_number, suburb, city, state, postal_code, country)
- Account number if shown

This document is primarily for ADDRESS VERIFICATION.
SET detected_document_type to "POA"`,

  BANK_STATEMENT: `You are extracting information from a BANK STATEMENT.

FOCUS ON EXTRACTING:
- Account holder name (full_name, first_name, last_name)
- Bank name (bank_name)
- Account number (account_number)
- Branch code (branch_code)
- Branch name (branch_name)
- Address of account holder
- Account type if shown

SET detected_document_type to "BANK_STATEMENT"`,

  PAYSLIP: `You are extracting information from a PAYSLIP / PAY STUB.

FOCUS ON EXTRACTING:
- Employee name (first_name, last_name, full_name)
- Employer name (employer_name)
- Employer address (employer_address)
- Employee ID
- Job title (occupation)
- Basic salary (salary - number only, no currency)
- Gross salary (gross_salary - number only)
- Net salary (net_salary - number only)
- Bank details if shown (bank_name, account_number)

SET detected_document_type to "PAYSLIP"`,

  EMPLOYMENT_LETTER: `You are extracting information from an EMPLOYMENT LETTER / CONFIRMATION OF EMPLOYMENT.

FOCUS ON EXTRACTING:
- Employee name (first_name, last_name, full_name)
- Employer name (employer_name)
- Employer address (employer_address)
- Employer phone (employer_phone)
- Employer email (employer_email)
- Job title (occupation)
- Employment start date (employment_date in YYYY-MM-DD format)
- Salary if mentioned (salary, gross_salary, net_salary - numbers only)

SET detected_document_type to "EMPLOYMENT_LETTER"`,

  BIZ_REG: `You are extracting information from a BUSINESS REGISTRATION CERTIFICATE.

FOCUS ON EXTRACTING:
- Business name (business_name)
- Registration number (registration_number)
- Business type (business_type)
- Business activity/industry (industry)
- Registered address (business_address)
- Directors/owners names

SET detected_document_type to "BIZ_REG"`,

  PHOTO: `You are analyzing a PHOTOGRAPH.

This is likely a passport photo or ID photo. Extract any visible text if present.
Confirm if a clear face is visible for ID purposes.

SET detected_document_type to "PHOTO"`,

  OTHER: `You are extracting information from a document.

FIRST, analyze the document and determine what type it is. Set detected_document_type to one of:
- "ID" for national ID cards
- "PASSPORT" for passports
- "POA" for proof of address (utility bills, bank letters, etc.)
- "BANK_STATEMENT" for bank statements
- "PAYSLIP" for payslips / pay stubs
- "EMPLOYMENT_LETTER" for employment letters
- "BIZ_REG" for business registration documents
- "PHOTO" for photos
- "OTHER" if you cannot determine the type

Extract any relevant client information you can find:
- Personal details (name, date of birth, gender, nationality)
- Contact information (phone, email, address)
- Identification numbers
- Employment information
- Bank details`,
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
      update: {
        apiKey: config.apiKey,
        modelName: config.modelName,
        isEnabled: config.isEnabled,
        isPrimary: config.isPrimary,
        maxTokens: config.maxTokens,
        temperature: config.temperature,
        settings: config.settings ? JSON.stringify(config.settings) : undefined,
      },
      create: {
        organizationId,
        aiProviderId,
        apiKey: config.apiKey,
        modelName: config.modelName,
        isEnabled: config.isEnabled,
        isPrimary: config.isPrimary,
        maxTokens: config.maxTokens,
        temperature: config.temperature,
        settings: config.settings ? JSON.stringify(config.settings) : undefined,
      },
      include: {
        aiProvider: true,
      },
    });
  }

  /**
   * Extract data from document using AI with structured schema
   * Returns data that maps directly to client form fields
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
   * Extract using a specific provider with structured schema
   */
  private async extractWithProvider(
    provider: AIProviderConfig,
    input: DocumentExtractionInput
  ): Promise<ExtractionResult> {
    const startTime = Date.now();

    try {
      let result: ClientFormData | null = null;
      let confidence = 0;

      // Currently only Gemini supports structured schemas
      // Other providers will use the fallback method
      switch (provider.name) {
        case 'gemini':
          result = await this.extractWithGeminiStructured(provider, input);
          confidence = result ? 0.95 : 0;
          break;

        case 'claude':
          result = await this.extractWithClaudeFallback(provider, input);
          confidence = result ? 0.92 : 0;
          break;

        case 'openai':
          result = await this.extractWithOpenAIFallback(provider, input);
          confidence = result ? 0.91 : 0;
          break;

        case 'deepseek':
          result = await this.extractWithDeepSeekFallback(provider, input);
          confidence = result ? 0.85 : 0;
          break;

        case 'ollama':
          result = await this.extractWithOllamaFallback(provider, input);
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
   * Extract using Google Gemini with structured schema (preferred method)
   */
  private async extractWithGeminiStructured(
    provider: AIProviderConfig,
    input: DocumentExtractionInput
  ): Promise<ClientFormData | null> {
    if (!provider.apiKey) {
      throw new Error('Gemini API key not configured');
    }

    const genAI = new GoogleGenerativeAI(provider.apiKey);
    const model = genAI.getGenerativeModel({
      model: provider.modelName || 'gemini-2.0-flash',
    });

    // Get document-specific prompt
    const docTypePrompt =
      DOCUMENT_EXTRACTION_PROMPTS[input.documentType] ||
      DOCUMENT_EXTRACTION_PROMPTS['OTHER'];

    const systemPrompt = `${docTypePrompt}

IMPORTANT EXTRACTION RULES:
1. Extract ONLY the information visible in the document
2. If a field is not found or unclear, return null for that field
3. Dates MUST be in YYYY-MM-DD format (e.g., "1990-05-15")
4. Numbers (salary, amounts) must be numeric values WITHOUT currency symbols
5. Gender must be exactly "male" or "female" (lowercase)
6. Split full names into first_name, last_name, and middle_name when possible
7. Return empty/null for fields that don't apply to this document type

Extract all relevant information from this document and return it in the structured format.`;

    // Build content parts
    const parts: any[] = [{ text: systemPrompt }];

    if (input.imageBase64) {
      parts.push({
        inlineData: {
          mimeType: input.mimeType,
          data: input.imageBase64,
        },
      });
    }

    // Generate with structured output
    const result = await model.generateContent({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: clientDocumentSchema,
        temperature: provider.temperature ?? 0.1,
        maxOutputTokens: provider.maxTokens ?? 2048,
      },
    });

    const responseText = result.response.text();
    console.log('Gemini structured response:', responseText);

    // Parse JSON (Gemini guarantees valid JSON with schema)
    const extractedData = JSON.parse(responseText) as ClientFormData;

    // Post-process to ensure consistency
    return this.postProcessExtractedData(extractedData, input.documentType);
  }

  /**
   * Post-process extracted data for consistency
   */
  private postProcessExtractedData(
    data: ClientFormData,
    documentType: string
  ): ClientFormData {
    // Ensure gender is lowercase
    if (data.gender) {
      data.gender = data.gender.toLowerCase();
      if (data.gender !== 'male' && data.gender !== 'female') {
        data.gender = null;
      }
    }

    // Set id_type based on document type if not already set
    if (!data.id_type) {
      if (documentType === 'ID') {
        data.id_type = 'national_id';
      } else if (documentType === 'PASSPORT') {
        data.id_type = 'passport';
      }
    }

    // Copy id_number to appropriate field
    if (data.id_number) {
      if (data.id_type === 'national_id' && !data.national_id) {
        data.national_id = data.id_number;
      } else if (data.id_type === 'passport' && !data.passport_number) {
        data.passport_number = data.id_number;
      }
    }

    // For passports, try to infer passport_country from nationality if not set
    if (
      documentType === 'PASSPORT' &&
      !data.passport_country &&
      data.nationality
    ) {
      // Map common nationality adjectives to countries
      const nationalityToCountry: Record<string, string> = {
        zimbabwean: 'Zimbabwe',
        'south african': 'South Africa',
        zambian: 'Zambia',
        botswanan: 'Botswana',
        mozambican: 'Mozambique',
        malawian: 'Malawi',
        namibian: 'Namibia',
        kenyan: 'Kenya',
        ugandan: 'Uganda',
        tanzanian: 'Tanzania',
        nigerian: 'Nigeria',
        ghanaian: 'Ghana',
        british: 'United Kingdom',
        american: 'United States',
        canadian: 'Canada',
        australian: 'Australia',
        indian: 'India',
        chinese: 'China',
      };
      const lowerNationality = data.nationality.toLowerCase();
      if (nationalityToCountry[lowerNationality]) {
        data.passport_country = nationalityToCountry[lowerNationality];
      }
    }

    // Build full_name if not present
    if (!data.full_name && (data.first_name || data.last_name)) {
      const parts = [data.first_name, data.middle_name, data.last_name].filter(
        Boolean
      );
      data.full_name = parts.join(' ');
    }

    return data;
  }

  /**
   * Fallback extraction for Claude (uses prompt-based approach)
   */
  private async extractWithClaudeFallback(
    provider: AIProviderConfig,
    input: DocumentExtractionInput
  ): Promise<ClientFormData | null> {
    if (!provider.apiKey) {
      throw new Error('Claude API key not configured');
    }

    const model = provider.modelName || 'claude-3-sonnet-20240229';
    const url = `${provider.baseUrl}/v1/messages`;

    const prompt = this.buildFallbackPrompt(input.documentType);

    const content: any[] = [];
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

    const data = (await response.json()) as any;
    const text = data.content?.find((c: any) => c.type === 'text')?.text || '';
    return this.parseJsonToClientData(text, input.documentType);
  }

  /**
   * Fallback extraction for OpenAI
   */
  private async extractWithOpenAIFallback(
    provider: AIProviderConfig,
    input: DocumentExtractionInput
  ): Promise<ClientFormData | null> {
    if (!provider.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const model = provider.modelName || 'gpt-4o';
    const url = `${provider.baseUrl}/v1/chat/completions`;
    const prompt = this.buildFallbackPrompt(input.documentType);

    const content: any[] = [{ type: 'text', text: prompt }];
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

    const data = (await response.json()) as any;
    const text = data.choices?.[0]?.message?.content || '';
    return this.parseJsonToClientData(text, input.documentType);
  }

  /**
   * Fallback extraction for DeepSeek
   */
  private async extractWithDeepSeekFallback(
    provider: AIProviderConfig,
    input: DocumentExtractionInput
  ): Promise<ClientFormData | null> {
    if (!provider.apiKey) {
      throw new Error('DeepSeek API key not configured');
    }

    // DeepSeek doesn't support images well, so this is limited
    const model = provider.modelName || 'deepseek-chat';
    const url = `${provider.baseUrl}/v1/chat/completions`;
    const prompt = this.buildFallbackPrompt(input.documentType);

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

    const data = (await response.json()) as any;
    const text = data.choices?.[0]?.message?.content || '';
    return this.parseJsonToClientData(text, input.documentType);
  }

  /**
   * Fallback extraction for Ollama
   */
  private async extractWithOllamaFallback(
    provider: AIProviderConfig,
    input: DocumentExtractionInput
  ): Promise<ClientFormData | null> {
    const model = provider.modelName || 'llava';
    const baseUrl = provider.baseUrl || 'http://localhost:11434';
    const url = `${baseUrl}/api/generate`;
    const prompt = this.buildFallbackPrompt(input.documentType);

    const body: any = {
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

    const data = (await response.json()) as any;
    return this.parseJsonToClientData(data.response || '', input.documentType);
  }

  /**
   * Build fallback prompt for non-Gemini providers
   */
  private buildFallbackPrompt(documentType: string): string {
    const docTypePrompt =
      DOCUMENT_EXTRACTION_PROMPTS[documentType] ||
      DOCUMENT_EXTRACTION_PROMPTS['OTHER'];

    return `${docTypePrompt}

Extract information and return ONLY a valid JSON object with these fields (set to null if not found):

{
  "first_name": "string or null",
  "last_name": "string or null", 
  "middle_name": "string or null",
  "full_name": "string or null",
  "date_of_birth": "YYYY-MM-DD or null",
  "gender": "male or female or null",
  "nationality": "string or null",
  "marital_status": "string or null",
  "title": "Mr/Mrs/Miss/Ms/Dr/Prof or null",
  "id_type": "national_id or passport or null",
  "id_number": "string or null",
  "national_id": "string or null",
  "passport_number": "string or null",
  "passport_country": "string or null",
  "id_issue_date": "YYYY-MM-DD or null",
  "id_expiry_date": "YYYY-MM-DD or null",
  "street_number": "string or null",
  "suburb": "string or null",
  "city": "string or null",
  "state": "string or null",
  "country": "string or null",
  "postal_code": "string or null",
  "employer_name": "string or null",
  "employer_address": "string or null",
  "employer_phone": "string or null",
  "employer_email": "string or null",
  "occupation": "string or null",
  "employment_date": "YYYY-MM-DD or null",
  "salary": number or null,
  "net_salary": number or null,
  "gross_salary": number or null,
  "bank_name": "string or null",
  "account_number": "string or null",
  "branch_code": "string or null",
  "branch_name": "string or null",
  "phone": "string or null",
  "email": "string or null",
  "nok_first_name": "string or null",
  "nok_last_name": "string or null",
  "nok_phone": "string or null",
  "nok_relationship": "string or null",
  "nok_address": "string or null",
  "business_name": "string or null",
  "registration_number": "string or null",
  "business_type": "string or null",
  "industry": "string or null",
  "business_address": "string or null"
}

Return ONLY the JSON object, no other text or markdown.`;
  }

  /**
   * Parse JSON response to ClientFormData
   */
  private parseJsonToClientData(
    text: string,
    documentType: string
  ): ClientFormData | null {
    try {
      // Find JSON in response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return null;
      }

      const data = JSON.parse(jsonMatch[0]) as ClientFormData;
      return this.postProcessExtractedData(data, documentType);
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
