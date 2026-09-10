/**
 * AI Extraction Service
 *
 * Handles document data extraction using the Google Gemini Interactions API
 * with structured JSON schemas — defines exact fields to extract and returns
 * structured JSON that maps directly to client form fields.
 *
 * Features:
 * - Structured schema-based extraction (guaranteed JSON shape)
 * - Multi-document extraction: all of a client's documents go to the model in
 *   a single interaction so it can reconcile fields across them
 * - Automatic document-type detection per file
 * - Live model discovery + automatic migration off retired models
 * - Provider failover
 */

import { GoogleGenAI } from '@google/genai';
import { prisma } from '../config/database';
import {
  CatalogModel,
  MODEL_CATALOG,
  getModelCapabilities,
  isRetiredModel,
  mergeModels,
  parseAllowedThinkingLevels,
  resolveMediaResolution,
  resolveModelName,
  resolveThinkingLevel,
  stepDownResolution,
  stepUpThinkingLevel,
  RETIRED_MODELS,
} from '../config/ai-models';
import { enrichFromSouthAfricanId } from '../utils/south-african-id';

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
  thinkingLevel?: string;
  /** Image detail sent to the model: low | medium | high | ultra_high. */
  mediaResolution?: string;
}

export interface ExtractionResult {
  success: boolean;
  data: ClientFormData | null;
  confidence: number;
  provider: string;
  model: string;
  processingTime: number;
  error?: string;
  /** Per-file classification, present for multi-document extraction. */
  documents?: DocumentClassification[];
}

export interface DocumentClassification {
  index: number;
  fileName: string;
  detectedDocumentType: string | null;
  /** Fields this particular file contributed, for UI attribution. */
  fieldsFound?: string[];
  readable: boolean;
  notes?: string | null;
}

export interface DocumentExtractionInput {
  documentType: string; // e.g., "ID", "PASSPORT", "BANK_STATEMENT"
  imageBase64?: string; // For images
  pdfUrl?: string; // For PDFs
  mimeType: string;
  fileName?: string;
}

/** One file in a multi-document extraction request. */
export interface BatchDocumentInput {
  /** Declared type, or "OTHER"/undefined to let the model detect it. */
  documentType?: string;
  data: string; // base64, with or without data-URL prefix
  mimeType: string;
  fileName: string;
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
  id_type: string | null; // "national_id", "passport" or "drivers_license"
  id_number: string | null;
  /** Initials as printed on ID cards and driving licences (e.g. "S.C."). */
  initials: string | null;
  /** Driving licence number, which is NOT the national ID number. */
  license_number: string | null;
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
 * Field definitions for the extraction schema.
 *
 * Kept as a compact table rather than a hand-written JSON Schema so the
 * descriptions (which drive extraction quality) stay readable and the schema
 * for single- and multi-document extraction is generated from one source.
 */
const CLIENT_FIELDS: Array<[keyof ClientFormData, 'string' | 'number', string]> =
  [
    // Personal Information
    ['first_name', 'string', 'First name / given name of the person'],
    ['last_name', 'string', 'Last name / surname / family name of the person'],
    ['middle_name', 'string', 'Middle name if present'],
    ['full_name', 'string', 'Full name as it appears on the document'],
    [
      'date_of_birth',
      'string',
      'Date of birth in YYYY-MM-DD format (e.g., "1990-05-15")',
    ],
    ['gender', 'string', 'Gender - must be exactly "male" or "female" (lowercase)'],
    [
      'nationality',
      'string',
      'Nationality or citizenship (e.g., "Zimbabwean", "South African")',
    ],
    [
      'marital_status',
      'string',
      'Marital status (Single, Married, Divorced, Widowed)',
    ],
    ['title', 'string', 'Title (Mr, Mrs, Miss, Ms, Dr, Prof)'],
    [
      'initials',
      'string',
      'Initials exactly as printed (e.g. "S.C."). South African ID cards and driving licences often print a SURNAME plus INITIALS instead of full given names. Put the initials here, never in first_name.',
    ],

    // Identification
    [
      'id_type',
      'string',
      'Type of ID document - must be "national_id", "passport" or "drivers_license" (lowercase)',
    ],
    [
      'license_number',
      'string',
      'Driving licence number, if this is a driving licence. This is a DIFFERENT number from the national ID number - do not put it in id_number.',
    ],
    ['id_number', 'string', 'The ID number or passport number from the document'],
    ['national_id', 'string', 'National ID number if this is an ID card'],
    ['passport_number', 'string', 'Passport number if this is a passport'],
    [
      'passport_country',
      'string',
      'Country that issued the passport (e.g., "Zimbabwe", "South Africa"). Look for issuing authority, country code, or place of issue on the passport.',
    ],
    ['id_issue_date', 'string', 'Date the ID was issued in YYYY-MM-DD format'],
    ['id_expiry_date', 'string', 'Expiry date of the ID in YYYY-MM-DD format'],

    // Address
    [
      'street_number',
      'string',
      'Street address including house/unit number and street name',
    ],
    ['suburb', 'string', 'Suburb, neighborhood, or area name'],
    ['city', 'string', 'City or town name'],
    ['state', 'string', 'State, province, or region'],
    ['country', 'string', 'Country name'],
    ['postal_code', 'string', 'Postal code or ZIP code'],

    // Employment
    ['employer_name', 'string', 'Name of the employer or company'],
    ['employer_address', 'string', 'Address of the employer'],
    ['employer_phone', 'string', 'Phone number of the employer'],
    ['employer_email', 'string', 'Email address of the employer'],
    ['occupation', 'string', 'Job title or occupation'],
    ['employment_date', 'string', 'Date employment started in YYYY-MM-DD format'],
    ['salary', 'number', 'Basic salary as a number without currency symbols'],
    [
      'net_salary',
      'number',
      'Net salary (take-home pay) as a number without currency symbols',
    ],
    ['gross_salary', 'number', 'Gross salary as a number without currency symbols'],

    // Bank Details
    ['bank_name', 'string', 'Name of the bank'],
    ['account_number', 'string', 'Bank account number'],
    ['branch_code', 'string', 'Bank branch code or sort code'],
    ['branch_name', 'string', 'Name of the bank branch'],

    // Contact
    ['phone', 'string', 'Phone number(s) - format based on country'],
    ['email', 'string', 'Email address'],

    // Next of Kin
    ['nok_first_name', 'string', 'Next of kin first name'],
    ['nok_last_name', 'string', 'Next of kin last name'],
    ['nok_phone', 'string', 'Next of kin phone number'],
    [
      'nok_relationship',
      'string',
      'Relationship to next of kin (e.g., Spouse, Parent, Sibling)',
    ],
    ['nok_address', 'string', 'Next of kin address'],

    // Business (for business registration documents)
    ['business_name', 'string', 'Registered business name'],
    ['registration_number', 'string', 'Business registration number'],
    [
      'business_type',
      'string',
      'Type of business (Sole Proprietor, Partnership, Private Limited, etc.)',
    ],
    ['industry', 'string', 'Industry or business activity'],
    ['business_address', 'string', 'Business address'],
  ];

const DETECTABLE_TYPES = [
  'ID',
  'PASSPORT',
  'DRIVING_LICENCE',
  'POA',
  'BANK_STATEMENT',
  'PAYSLIP',
  'EMPLOYMENT_LETTER',
  'BIZ_REG',
  'PHOTO',
  'OTHER',
];

type JsonSchema = Record<string, any>;

/**
 * Build the JSON Schema for the client fields.
 * Every field is nullable so the model can honestly report "not present".
 */
function buildClientFieldsSchema(includeDetectedType: boolean): JsonSchema {
  const properties: JsonSchema = {};

  for (const [name, type, description] of CLIENT_FIELDS) {
    properties[name] = {
      type: [type, 'null'],
      description,
    };
  }

  if (includeDetectedType) {
    properties.detected_document_type = {
      type: ['string', 'null'],
      enum: [...DETECTABLE_TYPES, null],
      description:
        'The type of document detected from the content. Must be one of: ' +
        DETECTABLE_TYPES.join(', '),
    };
  }

  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

/** Schema for extracting a single document. */
export const SINGLE_DOCUMENT_SCHEMA: JsonSchema = buildClientFieldsSchema(true);

/**
 * Schema for extracting a set of documents at once: one reconciled client
 * record plus a per-file classification so the UI can auto-assign types.
 */
export const BATCH_DOCUMENT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    client: {
      ...buildClientFieldsSchema(false),
      description:
        'The single best reconciled set of client details drawn from ALL supplied documents.',
    },
    documents: {
      type: 'array',
      description:
        'One entry per supplied document, in the same order they were provided.',
      items: {
        type: 'object',
        properties: {
          index: {
            type: 'integer',
            description:
              'Zero-based position of this document in the supplied list',
          },
          file_name: {
            type: 'string',
            description: 'The file name given for this document',
          },
          detected_document_type: {
            type: ['string', 'null'],
            enum: [...DETECTABLE_TYPES, null],
            description:
              'What kind of document this is. Must be one of: ' +
              DETECTABLE_TYPES.join(', '),
          },
          readable: {
            type: 'boolean',
            description:
              'False if the document is too blurry, cropped or dark to read reliably',
          },
          fields_found: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Names of the client fields this specific document supplied values for',
          },
          notes: {
            type: ['string', 'null'],
            description:
              'Short note if the document was unreadable or something looks wrong',
          },
        },
        required: [
          'index',
          'file_name',
          'detected_document_type',
          'readable',
          'fields_found',
          'notes',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['client', 'documents'],
  additionalProperties: false,
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

  DRIVING_LICENCE: `You are extracting information from a DRIVING LICENCE (driver's license).

A South African driving licence card is laid out like this:
- "SURNAME" or "VAN" is printed on its own line - this is the LAST NAME
- "INITIALS" or "VOORLETTERS" is printed separately, often just letters like "S.C."
  These are INITIALS, not a first name.
- The 13-digit national ID number appears on the card, often labelled
  "ID NO", "ID NUMBER" or printed on the same line as the licence details
- The LICENCE NUMBER is a different, shorter alphanumeric code
- Date of birth, sex/gender, issue date, expiry ("VALID") and vehicle codes
  (A, A1, B, C1, C, EB, EC1, EC) also appear

FOCUS ON EXTRACTING:
- Surname into last_name (NOT first_name)
- Initials into initials
- The 13-digit national ID number into id_number and national_id
- The licence number into license_number (never into id_number)
- Date of birth (date_of_birth in YYYY-MM-DD format)
- Sex (gender as "male" or "female" lowercase)
- Issue date (id_issue_date) and expiry date (id_expiry_date)

The card may be a faded photocopy or a scan containing BOTH the front and the
back of the card. Read every card in the image. Look carefully at digits - on
worn cards 0/8, 1/7, 5/6 and 3/9 are easy to confuse.

SET id_type to "drivers_license"
SET detected_document_type to "DRIVING_LICENCE"`,

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
- "DRIVING_LICENCE" for driving licences / driver's licenses
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

/** Rules appended to every extraction prompt. */
const EXTRACTION_RULES = `IMPORTANT EXTRACTION RULES:
1. Read EVERY piece of text visible in the document, including small print, stamps, headers and machine-readable zones (MRZ).
2. Extract ONLY information actually present in the document — never invent or guess a value.
3. If a field is not found or is unclear, return null for that field.
4. Dates MUST be in YYYY-MM-DD format (e.g., "1990-05-15"). Convert from any other format you see.
5. Numbers (salary, amounts) must be numeric values WITHOUT currency symbols, commas or spaces.
6. Gender must be exactly "male" or "female" (lowercase).
7. Split full names into first_name, last_name and middle_name when possible. On a passport MRZ the surname comes first, before the "<<" separator.
8. Return null for fields that do not apply to this document type.
9. Do not copy the example values from these instructions into your answer.
10. A South African ID number is exactly 13 digits (YYMMDDSSSSCAZ). Capture all
    13 digits exactly as printed, with no spaces — the date of birth and gender
    are derived from it, so a single wrong digit matters.
11. NAMES ON IDENTITY DOCUMENTS: the surname is usually printed on its own line,
    above or before the given names. If you can only find ONE name, it is almost
    always the SURNAME — put it in last_name and leave first_name null. Never
    guess a first name from a surname.
12. If the document shows initials rather than full given names, put them in
    initials and leave first_name null.
13. The document may be a faded photocopy, a fax or a scan of several cards on
    one page. Examine every card and every region of the page, including rotated
    or upside-down cards, and read low-contrast text as carefully as you can.
    Report a field as null only after you have genuinely looked for it.`;

/** Extra guidance for reconciling several documents at once. */
const BATCH_RULES = `You are given SEVERAL documents belonging to ONE client. They may be different
document types (ID, passport, payslip, bank statement, proof of address, business
registration, photos), several pages of the same document, or the front and back
of a single card.

YOUR TASK HAS TWO PARTS:

PART 1 — Classify each document.
For every document supplied, in the order given, report its index, the file name
you were told, the document type you detected, whether it was readable, and which
client fields it supplied.

PART 2 — Build ONE reconciled client record.
Merge everything you found across ALL documents into a single "client" object.
Extract as much as the documents support — do not stop at the first document.

RECONCILIATION RULES:
- Prefer the most authoritative source for each field. For identity fields
  (names, date of birth, gender, nationality, ID numbers) trust a passport or
  national ID over a payslip, letter or bill.
- For the current address, prefer the most recent proof of address or bank
  statement over an address printed on an old ID.
- For employment and salary, prefer a payslip or employment letter.
- For bank details, prefer a bank statement.
- If two documents disagree and neither is clearly more authoritative, use the
  value from the more recently dated document.
- Never leave a field null in "client" if ANY supplied document contains it.`;

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

    return this.toProviderConfig(config);
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

    return configs.map(config => this.toProviderConfig(config));
  }

  /**
   * Map a stored config row to the runtime provider config, substituting a
   * replacement model when the stored one has been retired by the provider.
   */
  private toProviderConfig(config: any): AIProviderConfig {
    const providerName: string = config.aiProvider.name;
    const settings = this.parseSettings(config.settings);

    return {
      id: config.aiProvider.id,
      name: providerName,
      displayName: config.aiProvider.displayName,
      baseUrl: config.aiProvider.baseUrl,
      apiKey: config.apiKey,
      modelName: resolveModelName(providerName, config.modelName),
      isLocal: config.aiProvider.isLocal,
      maxTokens: config.maxTokens ?? undefined,
      temperature: config.temperature ?? undefined,
      thinkingLevel:
        typeof settings.thinkingLevel === 'string'
          ? settings.thinkingLevel
          : undefined,
      mediaResolution:
        typeof settings.mediaResolution === 'string'
          ? settings.mediaResolution
          : undefined,
    };
  }

  /** settings is a Json column that has historically held both objects and strings. */
  private parseSettings(settings: unknown): Record<string, unknown> {
    if (!settings) return {};
    if (typeof settings === 'string') {
      try {
        return JSON.parse(settings) as Record<string, unknown>;
      } catch {
        return {};
      }
    }
    if (typeof settings === 'object') {
      return settings as Record<string, unknown>;
    }
    return {};
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
   * List selectable models for a provider: the curated catalog merged with any
   * models a previous discovery run found and persisted on the org's config.
   */
  async getProviderModels(
    organizationId: string,
    providerName: string
  ): Promise<{ models: CatalogModel[]; discoveredAt: string | null }> {
    const config = await prisma.organizationAIConfig.findFirst({
      where: {
        organizationId,
        aiProvider: { name: providerName },
      },
      include: { aiProvider: true },
    });

    const settings = this.parseSettings(config?.settings);
    const discovered = Array.isArray(settings.availableModels)
      ? (settings.availableModels as CatalogModel[])
      : [];

    return {
      models: mergeModels(providerName, discovered),
      discoveredAt:
        typeof settings.modelsDiscoveredAt === 'string'
          ? settings.modelsDiscoveredAt
          : null,
    };
  }

  /**
   * Ask the provider which models the supplied API key can actually use, then
   * persist the result on the organization's config so every user sees it.
   */
  async discoverModels(
    organizationId: string,
    aiProviderId: string,
    overrideApiKey?: string
  ): Promise<{
    models: CatalogModel[];
    discovered: number;
    added: number;
    discoveredAt: string;
  }> {
    const provider = await prisma.aIProvider.findUnique({
      where: { id: aiProviderId },
    });

    if (!provider) {
      throw new Error('AI provider not found');
    }

    const config = await prisma.organizationAIConfig.findUnique({
      where: {
        organizationId_aiProviderId: { organizationId, aiProviderId },
      },
    });

    const apiKey = overrideApiKey || config?.apiKey || undefined;

    if (!apiKey && !provider.isLocal) {
      throw new Error(
        'An API key is required to check which models are available'
      );
    }

    const discovered = await this.listProviderModels(
      provider.name,
      apiKey,
      provider.baseUrl
    );

    const catalogIds = new Set(
      (MODEL_CATALOG[provider.name] || []).map(m => m.id)
    );
    const added = discovered.filter(
      m => !catalogIds.has(m.id) && !(m.id in RETIRED_MODELS)
    ).length;

    const discoveredAt = new Date().toISOString();

    // Persist onto the org config so the whole organization sees the refreshed
    // list. Only possible once the provider has been configured.
    if (config) {
      const settings = this.parseSettings(config.settings);
      await prisma.organizationAIConfig.update({
        where: { id: config.id },
        data: {
          settings: {
            ...settings,
            availableModels: discovered,
            modelsDiscoveredAt: discoveredAt,
          } as any,
        },
      });
    }

    return {
      models: mergeModels(provider.name, discovered),
      discovered: discovered.length,
      added,
      discoveredAt,
    };
  }

  /** Provider-specific "list models" call. */
  private async listProviderModels(
    providerName: string,
    apiKey?: string,
    baseUrl?: string | null
  ): Promise<CatalogModel[]> {
    switch (providerName) {
      case 'gemini':
        return this.listGeminiModels(apiKey!);
      case 'openai':
      case 'deepseek':
        return this.listOpenAICompatibleModels(providerName, apiKey!, baseUrl);
      case 'claude':
        return this.listClaudeModels(apiKey!);
      case 'ollama':
        return this.listOllamaModels(baseUrl);
      default:
        throw new Error(
          `Model discovery is not supported for provider "${providerName}"`
        );
    }
  }

  private async listGeminiModels(apiKey: string): Promise<CatalogModel[]> {
    const ai = new GoogleGenAI({ apiKey });
    const models: CatalogModel[] = [];

    const pager = await ai.models.list();
    for await (const model of pager) {
      const id = (model.name || '').replace(/^models\//, '');
      if (!id) continue;

      // Only models that can actually generate content are useful here.
      const actions = model.supportedActions || [];
      if (
        actions.length > 0 &&
        !actions.some(a =>
          ['generateContent', 'interactions', 'createInteraction'].includes(a)
        )
      ) {
        continue;
      }

      // Skip non-extraction modalities that share the models endpoint.
      if (
        /embedding|imagen|veo|lyria|tts|aqa|robotics|transcribe|live/i.test(id)
      ) {
        continue;
      }

      models.push({
        id,
        name: model.displayName || id,
        description: model.description || 'Discovered from your Gemini account',
        supportsVision: true,
        isPreview: /preview|exp/i.test(id),
        inputTokenLimit: model.inputTokenLimit,
        outputTokenLimit: model.outputTokenLimit,
      });
    }

    return models;
  }

  private async listOpenAICompatibleModels(
    providerName: string,
    apiKey: string,
    baseUrl?: string | null
  ): Promise<CatalogModel[]> {
    const root =
      baseUrl ||
      (providerName === 'deepseek'
        ? 'https://api.deepseek.com'
        : 'https://api.openai.com');
    const url = `${root.replace(/\/$/, '')}/v1/models`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      throw new Error(
        `${providerName} model listing failed: ${response.status} ${response.statusText}`
      );
    }

    const body = (await response.json()) as { data?: Array<{ id: string }> };
    return (body.data || [])
      .filter(m => !/embedding|whisper|tts|dall-e|moderation/i.test(m.id))
      .map(m => ({
        id: m.id,
        name: m.id,
        description: 'Discovered from your account',
        supportsVision: /gpt-4|gpt-5|o\d/i.test(m.id),
      }));
  }

  private async listClaudeModels(apiKey: string): Promise<CatalogModel[]> {
    const response = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    });

    if (!response.ok) {
      throw new Error(
        `Claude model listing failed: ${response.status} ${response.statusText}`
      );
    }

    const body = (await response.json()) as {
      data?: Array<{ id: string; display_name?: string }>;
    };
    return (body.data || []).map(m => ({
      id: m.id,
      name: m.display_name || m.id,
      description: 'Discovered from your account',
      supportsVision: true,
    }));
  }

  private async listOllamaModels(
    baseUrl?: string | null
  ): Promise<CatalogModel[]> {
    const root = baseUrl || 'http://localhost:11434';
    const response = await fetch(`${root.replace(/\/$/, '')}/api/tags`);

    if (!response.ok) {
      throw new Error(
        `Ollama model listing failed: ${response.status} ${response.statusText}`
      );
    }

    const body = (await response.json()) as {
      models?: Array<{ name: string; details?: { family?: string } }>;
    };
    return (body.models || []).map(m => ({
      id: m.name,
      name: m.name,
      description: 'Installed locally',
      supportsVision: /llava|vision|bakllava|moondream/i.test(m.name),
    }));
  }

  /**
   * Rewrite organization configs that still point at a model the provider has
   * shut down. Called once at startup so extraction keeps working after a
   * provider retires a model, instead of failing on every request.
   */
  async migrateRetiredModels(): Promise<number> {
    const configs = await prisma.organizationAIConfig.findMany({
      where: { modelName: { in: Object.keys(RETIRED_MODELS) } },
      include: { aiProvider: true },
    });

    let migrated = 0;

    for (const config of configs) {
      const replacement = RETIRED_MODELS[config.modelName!];
      if (!replacement) continue;

      await prisma.organizationAIConfig.update({
        where: { id: config.id },
        data: { modelName: replacement },
      });

      console.warn(
        `[ai] Model "${config.modelName}" has been retired by ${config.aiProvider.displayName}. ` +
          `Organization ${config.organizationId} migrated to "${replacement}".`
      );
      migrated++;
    }

    return migrated;
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
        settings: config.settings ? (config.settings as any) : undefined,
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
        settings: config.settings ? (config.settings as any) : undefined,
      },
      include: {
        aiProvider: true,
      },
    });
  }

  /**
   * Extract data from a single document using AI with a structured schema.
   * Returns data that maps directly to client form fields.
   */
  async extractFromDocument(
    organizationId: string,
    input: DocumentExtractionInput
  ): Promise<ExtractionResult> {
    if (!input.imageBase64) {
      return this.emptyResult(
        Date.now(),
        'No document content supplied for extraction'
      );
    }

    return this.extractFromDocuments(organizationId, [
      {
        documentType: input.documentType,
        data: input.imageBase64,
        mimeType: input.mimeType,
        fileName: input.fileName || 'document',
      },
    ]);
  }

  /**
   * Extract from one or more documents belonging to the same client.
   *
   * All files are sent to the model in a single interaction so it can
   * cross-reference them — a payslip supplies employment details, an ID
   * supplies identity, a utility bill supplies the current address — and
   * return one reconciled client record plus a per-file classification.
   */
  async extractFromDocuments(
    organizationId: string,
    documents: BatchDocumentInput[]
  ): Promise<ExtractionResult> {
    const startTime = Date.now();

    if (documents.length === 0) {
      return this.emptyResult(startTime, 'No documents supplied');
    }

    const providers = await this.getEnabledProviders(organizationId);

    if (providers.length === 0) {
      return this.emptyResult(
        startTime,
        'No AI providers configured for this organization'
      );
    }

    const errors: string[] = [];

    // Try each provider in order (primary first)
    for (const provider of providers) {
      try {
        const result = await this.extractWithProvider(provider, documents);
        if (result.success) {
          await this.incrementUsage(organizationId, provider.id);
          return result;
        }
        if (result.error) {
          errors.push(`${provider.displayName}: ${result.error}`);
        }
      } catch (error) {
        console.error(`AI extraction failed with ${provider.name}:`, error);
        errors.push(
          `${provider.displayName}: ${this.describeProviderError(error)}`
        );
      }
    }

    return {
      success: false,
      data: null,
      confidence: 0,
      provider: providers[0]?.name || 'none',
      model: providers[0]?.modelName || 'none',
      processingTime: Date.now() - startTime,
      error:
        errors.length > 0
          ? errors.join('; ')
          : 'All AI providers failed to extract data',
    };
  }

  private emptyResult(startTime: number, error: string): ExtractionResult {
    return {
      success: false,
      data: null,
      confidence: 0,
      provider: 'none',
      model: 'none',
      processingTime: Date.now() - startTime,
      error,
    };
  }

  /**
   * Extract using a specific provider with a structured schema
   */
  private async extractWithProvider(
    provider: AIProviderConfig,
    documents: BatchDocumentInput[]
  ): Promise<ExtractionResult> {
    const startTime = Date.now();
    const firstDocument = documents[0];

    if (!firstDocument) {
      return this.emptyResult(startTime, 'No documents supplied');
    }

    try {
      let result: {
        data: ClientFormData | null;
        documents?: DocumentClassification[];
      };
      let confidence = 0;

      // Gemini supports structured schemas and multi-document input natively.
      // Other providers use the prompt-based fallback on the first document.
      switch (provider.name) {
        case 'gemini':
          result = await this.extractWithGemini(provider, documents);
          confidence = result.data ? 0.95 : 0;
          break;

        case 'claude':
          result = {
            data: await this.extractWithClaudeFallback(provider, firstDocument),
          };
          confidence = result.data ? 0.92 : 0;
          break;

        case 'openai':
          result = {
            data: await this.extractWithOpenAIFallback(provider, firstDocument),
          };
          confidence = result.data ? 0.91 : 0;
          break;

        case 'deepseek':
          result = {
            data: await this.extractWithDeepSeekFallback(provider, firstDocument),
          };
          confidence = result.data ? 0.85 : 0;
          break;

        case 'ollama':
          result = {
            data: await this.extractWithOllamaFallback(provider, firstDocument),
          };
          confidence = result.data ? 0.8 : 0;
          break;

        default:
          throw new Error(`Unknown AI provider: ${provider.name}`);
      }

      // An all-null record means the model read nothing useful. Report that
      // rather than presenting an empty form fill as a success.
      if (result.data && !this.hasAnyValue(result.data)) {
        return {
          success: false,
          data: result.data,
          confidence: 0,
          provider: provider.name,
          model: provider.modelName || 'default',
          processingTime: Date.now() - startTime,
          documents: result.documents,
          error:
            'The document was processed but no client details could be read from it. Try a clearer or higher-resolution scan.',
        };
      }

      return {
        success: result.data !== null,
        data: result.data,
        confidence,
        provider: provider.name,
        model: provider.modelName || 'default',
        processingTime: Date.now() - startTime,
        documents: result.documents,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        confidence: 0,
        provider: provider.name,
        model: provider.modelName || 'default',
        processingTime: Date.now() - startTime,
        error: this.describeProviderError(error),
      };
    }
  }

  /** True when at least one client field carries a real value. */
  private hasAnyValue(data: ClientFormData): boolean {
    return Object.entries(data).some(
      ([key, value]) =>
        key !== 'detected_document_type' &&
        value !== null &&
        value !== undefined &&
        value !== ''
    );
  }

  /**
   * Extract using the Gemini Interactions API with a structured JSON schema.
   */
  private async extractWithGemini(
    provider: AIProviderConfig,
    documents: BatchDocumentInput[]
  ): Promise<{
    data: ClientFormData | null;
    documents?: DocumentClassification[];
  }> {
    if (!provider.apiKey) {
      throw new Error('Gemini API key not configured');
    }

    const ai = new GoogleGenAI({ apiKey: provider.apiKey });
    const model = resolveModelName('gemini', provider.modelName);
    const isBatch = documents.length > 1;

    const input: Array<Record<string, unknown>> = [
      { type: 'text', text: this.buildPrompt(documents, isBatch) },
    ];

    documents.forEach((doc, index) => {
      const data = this.stripDataUrl(doc.data);
      const mimeType = doc.mimeType || 'image/jpeg';

      input.push({
        type: 'text',
        text: `--- Document ${index} — file name: "${doc.fileName}"${
          doc.documentType && doc.documentType !== 'OTHER'
            ? `, declared type: ${doc.documentType}`
            : ' (type not declared — detect it)'
        } ---`,
      });

      // PDFs go in as document blocks; everything else as images. The image
      // resolution is applied in callGemini, which is where it can be stepped
      // down if the model turns out not to accept it.
      if (mimeType === 'application/pdf' || mimeType === 'text/csv') {
        input.push({ type: 'document', data, mime_type: mimeType });
      } else {
        input.push({ type: 'image', data, mime_type: mimeType });
      }
    });

    const responseText = await this.callGemini(ai, {
      model,
      input,
      schema: isBatch ? BATCH_DOCUMENT_SCHEMA : SINGLE_DOCUMENT_SCHEMA,
      maxOutputTokens: provider.maxTokens ?? 8192,
      thinkingLevel: provider.thinkingLevel,
      mediaResolution: provider.mediaResolution,
    });

    const parsed = this.parseModelJson(responseText);

    if (isBatch) {
      const client = parsed.client as ClientFormData;
      const classifications: DocumentClassification[] = (
        (parsed.documents as any[]) || []
      ).map((d, i) => ({
        index: typeof d.index === 'number' ? d.index : i,
        fileName: d.file_name || documents[i]?.fileName || 'document',
        detectedDocumentType: d.detected_document_type ?? null,
        fieldsFound: Array.isArray(d.fields_found) ? d.fields_found : [],
        readable: d.readable !== false,
        notes: d.notes ?? null,
      }));

      // Adopt the most identity-bearing detected type for the combined record.
      const primaryType =
        classifications.find(c =>
          ['ID', 'PASSPORT'].includes(c.detectedDocumentType || '')
        )?.detectedDocumentType ||
        classifications[0]?.detectedDocumentType ||
        'OTHER';

      return {
        data: this.postProcessExtractedData(
          { ...client, detected_document_type: primaryType },
          primaryType
        ),
        documents: classifications,
      };
    }

    const data = parsed as ClientFormData;
    const declaredType = documents[0]?.documentType || 'OTHER';
    const effectiveType =
      declaredType !== 'OTHER'
        ? declaredType
        : data.detected_document_type || 'OTHER';

    return {
      data: this.postProcessExtractedData(data, effectiveType),
      documents: [
        {
          index: 0,
          fileName: documents[0]?.fileName || 'document',
          detectedDocumentType: data.detected_document_type ?? null,
          readable: true,
          fieldsFound: Object.entries(data)
            .filter(([, v]) => v !== null && v !== '')
            .map(([k]) => k),
        },
      ],
    };
  }

  /**
   * Call the Gemini Interactions API, adapting to what the model accepts.
   *
   * Models reachable through this API do not all take the same request. Gemma
   * builds reject a response schema outright, and several models accept only
   * some thinking levels. Both come back as a flat 400 that reads, to the
   * operator, as "this document could not be read" - when the document was
   * never the problem.
   *
   * The capability table skips parameters we already know a model refuses;
   * the retry below handles the rest, which is what keeps models discovered
   * after this was written working.
   */
  private async callGemini(
    ai: GoogleGenAI,
    request: {
      model: string;
      input: Array<Record<string, unknown>>;
      schema: unknown;
      maxOutputTokens: number;
      thinkingLevel?: string;
      mediaResolution?: string;
    }
  ): Promise<string> {
    const capabilities = getModelCapabilities(request.model);

    let useSchema = capabilities.supportsStructuredOutput;
    let thinkingLevel: string | null = resolveThinkingLevel(
      request.model,
      request.thinkingLevel,
      capabilities
    );
    // Identity documents are frequently faded photocopies or phone photos
    // where the ID number is only a few pixels tall. The API defaults to a
    // lower resolution, which silently drops that detail, so ask for the
    // highest fidelity this model offers.
    let resolution: string | null = resolveMediaResolution(
      request.model,
      request.mediaResolution,
      capabilities
    );

    // One attempt per parameter we might have to give up, plus the first try.
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const interaction = await ai.interactions.create({
          model: request.model,
          input: request.input.map(part =>
            part.type === 'image' && resolution
              ? { ...part, resolution }
              : part
          ) as any,
          response_format: useSchema
            ? {
                type: 'text',
                mime_type: 'application/json',
                schema: request.schema,
              }
            : { type: 'text', mime_type: 'application/json' },
          generation_config: {
            max_output_tokens: request.maxOutputTokens,
            ...(thinkingLevel ? { thinking_level: thinkingLevel as any } : {}),
          },
        } as any);

        const text = (interaction as any).output_text as string | undefined;
        if (!text) {
          throw new Error('Gemini returned an empty response');
        }
        return text;
      } catch (error) {
        const message = this.describeProviderError(error);
        const retry = this.planGeminiRetry(message, request.model, {
          useSchema,
          thinkingLevel,
          resolution,
        });

        if (!retry) throw error;

        console.warn(
          `[AI] ${request.model} rejected a request parameter (${message}). Retrying ${retry.reason}.`
        );
        useSchema = retry.useSchema;
        thinkingLevel = retry.thinkingLevel;
        resolution = retry.resolution;
      }
    }

    throw new Error(
      `Gemini rejected every supported request shape for model ${request.model}`
    );
  }

  /**
   * Decide how to retry after the provider rejected a request parameter.
   *
   * Returns null when the failure is not about a parameter we can give up - a
   * bad API key or an unreadable document has to surface, not be retried.
   */
  private planGeminiRetry(
    message: string,
    model: string,
    current: {
      useSchema: boolean;
      thinkingLevel: string | null;
      resolution: string | null;
    }
  ): {
    useSchema: boolean;
    thinkingLevel: string | null;
    resolution: string | null;
    reason: string;
  } | null {
    const lower = message.toLowerCase();

    // "The thinking budget 256 is invalid. Please choose a value between 512
    //  and 24576." The level is supported; the budget it implies is too small
    //  for this model, so ask it to think harder rather than not at all.
    if (lower.includes('thinking budget')) {
      const harder = stepUpThinkingLevel(model, current.thinkingLevel);
      if (harder) {
        return {
          ...current,
          thinkingLevel: harder,
          reason: `with thinking level "${harder}"`,
        };
      }
      if (current.thinkingLevel !== null) {
        return {
          ...current,
          thinkingLevel: null,
          reason: 'without a thinking level',
        };
      }
      return null;
    }

    // "'low' is not a supported thinking level for this model.
    //  Allowed values are: high, minimal."
    if (lower.includes('thinking level') || lower.includes('thinking_level')) {
      const [allowed] = parseAllowedThinkingLevels(message);
      if (allowed && allowed !== current.thinkingLevel) {
        return {
          ...current,
          thinkingLevel: allowed,
          reason: `with thinking level "${allowed}"`,
        };
      }
      if (current.thinkingLevel !== null) {
        return {
          ...current,
          thinkingLevel: null,
          reason: 'without a thinking level',
        };
      }
      return null;
    }

    const looksLikeBadArgument =
      lower.includes('invalid argument') ||
      lower.includes('resolution') ||
      lower.includes('response_format') ||
      lower.includes('response schema') ||
      lower.includes('json_schema');

    if (!looksLikeBadArgument) return null;

    // The image resolution first: it is the parameter measured to break a real
    // model (Gemma has no ultra_high), and stepping down a rung costs far less
    // than giving up the schema that keeps extraction accurate.
    if (current.resolution) {
      const lower_resolution = stepDownResolution(current.resolution);
      if (lower_resolution) {
        return {
          ...current,
          resolution: lower_resolution,
          reason: `at image resolution "${lower_resolution}"`,
        };
      }
      return {
        ...current,
        resolution: null,
        reason: 'without an image resolution',
      };
    }

    // Then constrained decoding, which some open-weight builds lack.
    if (current.useSchema) {
      return {
        ...current,
        useSchema: false,
        reason: 'without a response schema',
      };
    }

    // A model that will not take a thinking level at all reports it as a
    // generic invalid argument once the others are already gone.
    if (current.thinkingLevel !== null) {
      return {
        ...current,
        thinkingLevel: null,
        reason: 'without a thinking level',
      };
    }

    return null;
  }

  /**
   * Parse a model's JSON response.
   *
   * Without a schema to constrain it - and sometimes even with one, as
   * gemini-2.5-flash-lite does - a model wraps its JSON in a markdown fence or
   * adds a line of commentary. JSON.parse then fails on a response that
   * actually contains everything we asked for, and the operator is told their
   * document could not be read.
   */
  private parseModelJson(text: string): any {
    const trimmed = text.trim();
    const candidates = [trimmed];

    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) candidates.push(fenced[1].trim());

    // Any prose leading or trailing the object itself.
    const firstObject = trimmed.match(/[{[][\s\S]*[}\]]/);
    if (firstObject?.[0]) candidates.push(firstObject[0]);

    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate);
      } catch {
        // Try the next shape.
      }
    }

    throw new Error(
      `The model returned a response that was not valid JSON: ${trimmed.slice(
        0,
        200
      )}`
    );
  }

  /** Build the instruction text for a single- or multi-document request. */
  private buildPrompt(
    documents: BatchDocumentInput[],
    isBatch: boolean
  ): string {
    if (isBatch) {
      const typeGuidance = Array.from(
        new Set(
          documents
            .map(d => d.documentType)
            .filter((t): t is string => !!t && t !== 'OTHER')
        )
      )
        .map(t => DOCUMENT_EXTRACTION_PROMPTS[t])
        .filter(Boolean)
        .join('\n\n');

      return `${BATCH_RULES}

${typeGuidance ? `GUIDANCE FOR THE DECLARED DOCUMENT TYPES:\n\n${typeGuidance}\n\n` : ''}${EXTRACTION_RULES}

You are being given ${documents.length} documents. Process every one of them.`;
    }

    const docTypePrompt =
      DOCUMENT_EXTRACTION_PROMPTS[documents[0]?.documentType || 'OTHER'] ||
      DOCUMENT_EXTRACTION_PROMPTS.OTHER;

    return `${docTypePrompt}

${EXTRACTION_RULES}

Extract all relevant information from this document and return it in the structured format.`;
  }

  /**
   * Pull a usable message out of a provider SDK error. The Gemini SDK's
   * default message is just "400 API error occurred: {...httpMeta}", which
   * hides the actual complaint, so dig through the common carrier fields.
   */
  private describeProviderError(error: unknown): string {
    if (!error || typeof error !== 'object') {
      return String(error);
    }

    const err = error as Record<string, any>;

    // The Gemini SDK puts the real payload in `body` as a JSON *string*, and
    // sometimes wraps it in an array. Parse it before anything else.
    let parsedBody: any = err.body;
    if (typeof parsedBody === 'string') {
      try {
        parsedBody = JSON.parse(parsedBody);
      } catch {
        // Leave it as the raw string; it is still more useful than nothing.
      }
    }
    if (Array.isArray(parsedBody)) {
      parsedBody = parsedBody[0];
    }

    const fromBody =
      parsedBody?.error?.message ||
      parsedBody?.message ||
      err.error?.message ||
      err.response?.data?.error?.message ||
      err.detail;

    if (typeof fromBody === 'string' && fromBody.trim()) {
      const status = parsedBody?.error?.status;
      const suffix = status && status !== 'INVALID_ARGUMENT' ? ` (${status})` : '';
      return `${fromBody}${suffix}`;
    }

    if (typeof parsedBody === 'string' && parsedBody.trim()) {
      return parsedBody.slice(0, 500);
    }

    // Fall back to whatever structured payload we can serialise.
    for (const key of ['error', 'response']) {
      const value = err[key];
      if (value && typeof value === 'object') {
        const json = JSON.stringify(value);
        if (json && json !== '{}' && json.length < 2000) {
          return `${err.status || err.code || 'error'}: ${json}`;
        }
      }
    }

    return err.message || 'Unknown provider error';
  }

  /** Accept both raw base64 and data-URL encoded payloads. */
  private stripDataUrl(data: string): string {
    return data.includes(',') && data.trimStart().startsWith('data:')
      ? data.slice(data.indexOf(',') + 1)
      : data;
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
      } else if (documentType === 'DRIVING_LICENCE') {
        data.id_type = 'drivers_license';
      }
    }

    // A driving licence number is not an identity number. If the model put it
    // in id_number anyway, move it back so the ID field is not polluted.
    if (
      data.license_number &&
      data.id_number &&
      data.license_number === data.id_number &&
      !data.national_id
    ) {
      data.id_number = null;
    }

    this.reconcileNames(data, documentType);

    // Copy id_number to appropriate field
    if (data.id_number) {
      if (
        (data.id_type === 'national_id' ||
          data.id_type === 'drivers_license') &&
        !data.national_id
      ) {
        data.national_id = data.id_number;
      } else if (data.id_type === 'passport' && !data.passport_number) {
        data.passport_number = data.id_number;
      }
    }

    // Conversely, promote a specific number into the generic id_number field
    if (!data.id_number) {
      data.id_number = data.national_id || data.passport_number || null;
    }

    // For passports only, infer passport_country from nationality if not set.
    // Other document types have no passport, so leave the field empty.
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

    // A South African ID number encodes gender, date of birth and citizenship.
    // Recover them when OCR could not read the printed fields.
    enrichFromSouthAfricanId(data);

    // Build full_name if not present
    if (!data.full_name && (data.first_name || data.last_name)) {
      const parts = [data.first_name, data.middle_name, data.last_name].filter(
        Boolean
      );
      data.full_name = parts.join(' ');
    }

    // Conversely, split full_name when the model only returned the whole name
    if (data.full_name && !data.first_name && !data.last_name) {
      const parts = data.full_name.trim().split(/\s+/);
      if (parts.length >= 2) {
        data.first_name = parts[0] ?? null;
        data.last_name = parts[parts.length - 1] ?? null;
        if (parts.length > 2) {
          data.middle_name = parts.slice(1, -1).join(' ');
        }
      }
    }

    return data;
  }

  /**
   * Straighten out surname / given-name confusion.
   *
   * South African ID cards and driving licences print a SURNAME on one line and
   * INITIALS on another, with no full given name anywhere. Models routinely put
   * that lone surname into first_name, which lands it in the wrong form field.
   */
  private reconcileNames(data: ClientFormData, documentType: string): void {
    // Only identity documents reliably print a surname; on a payslip or letter
    // a lone name is just as likely to be a given name.
    const isIdentityDocument = ['ID', 'PASSPORT', 'DRIVING_LICENCE'].includes(
      documentType
    );

    // "S", "S.C.", "SC", "S C" — letters and dots only, at most 4 letters
    const looksLikeInitials = (value: string): boolean =>
      /^[A-Za-z](\s*\.?\s*[A-Za-z]){0,3}\s*\.?$/.test(value.trim()) &&
      value.replace(/[^A-Za-z]/g, '').length <= 4;

    // The model reported initials in first_name rather than in initials.
    if (
      data.first_name &&
      !data.initials &&
      looksLikeInitials(data.first_name)
    ) {
      data.initials = data.first_name;
      data.first_name = null;
    }

    // A single name plus separate initials means that name is the surname.
    if (data.initials && data.first_name && !data.last_name) {
      data.last_name = data.first_name;
      data.first_name = null;
    }

    // No given name at all, just one name: on an identity document that is the
    // surname, so move it out of first_name where it does not belong.
    if (
      isIdentityDocument &&
      data.first_name &&
      !data.last_name &&
      !data.middle_name &&
      !data.full_name &&
      !data.first_name.trim().includes(' ')
    ) {
      data.last_name = data.first_name;
      data.first_name = null;
    }

    // Never leave initials duplicated as the given name.
    if (
      data.first_name &&
      data.initials &&
      data.first_name.trim().toUpperCase() ===
        data.initials.trim().toUpperCase()
    ) {
      data.first_name = null;
    }
  }

  /**
   * Fallback extraction for Claude (uses prompt-based approach)
   */
  private async extractWithClaudeFallback(
    provider: AIProviderConfig,
    input: BatchDocumentInput
  ): Promise<ClientFormData | null> {
    if (!provider.apiKey) {
      throw new Error('Claude API key not configured');
    }

    const model = provider.modelName || 'claude-sonnet-4-20250514';
    const url = `${provider.baseUrl || 'https://api.anthropic.com'}/v1/messages`;

    const prompt = this.buildFallbackPrompt(input.documentType || 'OTHER');

    const content: any[] = [];
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: input.mimeType,
        data: this.stripDataUrl(input.data),
      },
    });
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
        max_tokens: provider.maxTokens ?? 4096,
        messages: [{ role: 'user', content }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    const text = data.content?.find((c: any) => c.type === 'text')?.text || '';
    return this.parseJsonToClientData(text, input.documentType || 'OTHER');
  }

  /**
   * Fallback extraction for OpenAI
   */
  private async extractWithOpenAIFallback(
    provider: AIProviderConfig,
    input: BatchDocumentInput
  ): Promise<ClientFormData | null> {
    if (!provider.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const model = provider.modelName || 'gpt-4o';
    const url = `${provider.baseUrl || 'https://api.openai.com'}/v1/chat/completions`;
    const prompt = this.buildFallbackPrompt(input.documentType || 'OTHER');

    const content: any[] = [{ type: 'text', text: prompt }];
    content.push({
      type: 'image_url',
      image_url: {
        url: `data:${input.mimeType};base64,${this.stripDataUrl(input.data)}`,
      },
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: provider.maxTokens ?? 4096,
        messages: [{ role: 'user', content }],
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    const text = data.choices?.[0]?.message?.content || '';
    return this.parseJsonToClientData(text, input.documentType || 'OTHER');
  }

  /**
   * Fallback extraction for DeepSeek
   */
  private async extractWithDeepSeekFallback(
    provider: AIProviderConfig,
    input: BatchDocumentInput
  ): Promise<ClientFormData | null> {
    if (!provider.apiKey) {
      throw new Error('DeepSeek API key not configured');
    }

    // DeepSeek doesn't support images well, so this is limited
    const model = provider.modelName || 'deepseek-chat';
    const url = `${provider.baseUrl || 'https://api.deepseek.com'}/v1/chat/completions`;
    const prompt = this.buildFallbackPrompt(input.documentType || 'OTHER');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: provider.maxTokens ?? 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(`DeepSeek API error: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    const text = data.choices?.[0]?.message?.content || '';
    return this.parseJsonToClientData(text, input.documentType || 'OTHER');
  }

  /**
   * Fallback extraction for Ollama
   */
  private async extractWithOllamaFallback(
    provider: AIProviderConfig,
    input: BatchDocumentInput
  ): Promise<ClientFormData | null> {
    const model = provider.modelName || 'llava';
    const baseUrl = provider.baseUrl || 'http://localhost:11434';
    const url = `${baseUrl}/api/generate`;
    const prompt = this.buildFallbackPrompt(input.documentType || 'OTHER');

    const body: any = {
      model,
      prompt,
      stream: false,
      images: [this.stripDataUrl(input.data)],
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    return this.parseJsonToClientData(
      data.response || '',
      input.documentType || 'OTHER'
    );
  }

  /**
   * Build fallback prompt for non-Gemini providers
   */
  private buildFallbackPrompt(documentType: string): string {
    const docTypePrompt =
      DOCUMENT_EXTRACTION_PROMPTS[documentType] ||
      DOCUMENT_EXTRACTION_PROMPTS['OTHER'];

    const fieldList = CLIENT_FIELDS.map(
      ([name, type]) =>
        `  "${name}": ${type === 'number' ? 'number or null' : '"string or null"'}`
    ).join(',\n');

    return `${docTypePrompt}

${EXTRACTION_RULES}

Extract information and return ONLY a valid JSON object with these fields (set to null if not found):

{
${fieldList},
  "detected_document_type": "${DETECTABLE_TYPES.join(' | ')} or null"
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

export { isRetiredModel };
export const aiExtractionService = new AIExtractionService();
