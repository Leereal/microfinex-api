/**
 * Seed: Client Management Default Data
 *
 * This script seeds:
 * 1. AI Providers (global)
 * 2. Document Types (per organization)
 * 3. Collateral Types (per organization)
 *
 * Run with: npx tsx scripts/seed-client-management.ts
 */

import { prisma } from '../src/config/database';

const AI_PROVIDERS = [
  {
    id: '550e8400-e29b-41d4-a716-446655440001',
    name: 'gemini',
    displayName: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    isActive: true,
    isLocal: false,
    capabilities: [
      'document_extraction',
      'image_analysis',
      'text_generation',
      'structured_output',
    ],
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440002',
    name: 'claude',
    displayName: 'Anthropic Claude',
    baseUrl: 'https://api.anthropic.com',
    isActive: true,
    isLocal: false,
    capabilities: [
      'document_extraction',
      'image_analysis',
      'text_generation',
      'structured_output',
    ],
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440003',
    name: 'openai',
    displayName: 'OpenAI GPT',
    baseUrl: 'https://api.openai.com',
    isActive: true,
    isLocal: false,
    capabilities: [
      'document_extraction',
      'image_analysis',
      'text_generation',
      'structured_output',
    ],
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440004',
    name: 'deepseek',
    displayName: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    isActive: true,
    isLocal: false,
    capabilities: [
      'document_extraction',
      'text_generation',
      'structured_output',
    ],
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440005',
    name: 'ollama',
    displayName: 'Ollama (Local)',
    baseUrl: 'http://localhost:11434',
    isActive: true,
    isLocal: true,
    capabilities: ['document_extraction', 'image_analysis', 'text_generation'],
  },
];

const DEFAULT_DOCUMENT_TYPES = [
  {
    name: 'National ID',
    code: 'ID',
    description: 'Zimbabwe National Identity Card',
    isRequired: true,
    sortOrder: 1,
    validityDays: null,
  },
  {
    name: 'Passport',
    code: 'PASSPORT',
    description: 'Valid Passport',
    isRequired: false,
    sortOrder: 2,
    validityDays: null,
  },
  {
    name: 'Proof of Address',
    code: 'POA',
    description:
      'Utility bill or bank statement showing residential address (not older than 90 days)',
    isRequired: true,
    sortOrder: 3,
    validityDays: 90,
  },
  {
    name: 'Bank Statement',
    code: 'BANK_STATEMENT',
    description: '3-month bank statement',
    isRequired: false,
    sortOrder: 4,
    validityDays: 30,
  },
  {
    name: 'Payslip',
    code: 'PAYSLIP',
    description: 'Recent payslip (last 3 months)',
    isRequired: false,
    sortOrder: 5,
    validityDays: 30,
  },
  {
    name: 'Employment Letter',
    code: 'EMPLOYMENT_LETTER',
    description: 'Employment confirmation letter from employer',
    isRequired: false,
    sortOrder: 6,
    validityDays: 90,
  },
  {
    name: 'Tax Clearance',
    code: 'TAX_CLEARANCE',
    description: 'Tax clearance certificate from ZIMRA',
    isRequired: false,
    sortOrder: 7,
    validityDays: 365,
  },
  {
    name: 'Business Registration',
    code: 'BIZ_REG',
    description: 'CR6 or Certificate of Incorporation',
    isRequired: false,
    sortOrder: 8,
    validityDays: null,
  },
  {
    name: 'Profile Picture',
    code: 'PROFILE_PIC',
    description: 'Client photograph',
    isRequired: true,
    sortOrder: 9,
    validityDays: null,
  },
  {
    name: 'Collateral Document',
    code: 'COLLATERAL',
    description: 'Document related to pledged collateral',
    isRequired: false,
    sortOrder: 10,
    validityDays: null,
  },
  {
    name: 'Loan Application Form',
    code: 'APPLICATION',
    description: 'Signed loan application form',
    isRequired: false,
    sortOrder: 11,
    validityDays: null,
  },
  {
    name: 'Other Document',
    code: 'OTHER',
    description: 'Other supporting documents',
    isRequired: false,
    sortOrder: 12,
    validityDays: null,
  },
];

const DEFAULT_COLLATERAL_TYPES = [
  {
    name: 'Motor Vehicle',
    code: 'VEHICLE',
    description: 'Cars, trucks, motorcycles',
    sortOrder: 1,
    requiredFields: ['registration_number', 'make', 'model', 'year'],
  },
  {
    name: 'Real Estate Property',
    code: 'PROPERTY',
    description: 'Land, houses, commercial buildings',
    sortOrder: 2,
    requiredFields: ['location', 'title_deed_number'],
  },
  {
    name: 'Equipment',
    code: 'EQUIPMENT',
    description: 'Machinery, tools, office equipment',
    sortOrder: 3,
    requiredFields: ['serial_number', 'make', 'model'],
  },
  {
    name: 'Inventory',
    code: 'INVENTORY',
    description: 'Stock, raw materials, finished goods',
    sortOrder: 4,
    requiredFields: ['description', 'quantity'],
  },
  {
    name: 'Accounts Receivable',
    code: 'RECEIVABLES',
    description: 'Outstanding invoices, debtors',
    sortOrder: 5,
    requiredFields: ['debtor_name', 'invoice_details'],
  },
  {
    name: 'Securities',
    code: 'SECURITIES',
    description: 'Shares, bonds, investments',
    sortOrder: 6,
    requiredFields: ['security_type', 'certificate_number'],
  },
  {
    name: 'Livestock',
    code: 'LIVESTOCK',
    description: 'Cattle, goats, poultry',
    sortOrder: 7,
    requiredFields: ['animal_type', 'quantity', 'brand'],
  },
  {
    name: 'Other',
    code: 'OTHER',
    description: 'Other valuable assets',
    sortOrder: 8,
    requiredFields: ['description'],
  },
];

async function seedAIProviders() {
  console.log('🤖 Seeding AI Providers...');

  for (const provider of AI_PROVIDERS) {
    await prisma.aIProvider.upsert({
      where: { name: provider.name },
      update: {
        displayName: provider.displayName,
        baseUrl: provider.baseUrl,
        isActive: provider.isActive,
        isLocal: provider.isLocal,
        capabilities: provider.capabilities,
      },
      create: provider,
    });
    console.log(`  ✅ ${provider.displayName}`);
  }
}

async function seedDocumentTypesForOrganization(organizationId: string) {
  console.log(
    `📄 Seeding Document Types for organization ${organizationId}...`
  );

  for (const docType of DEFAULT_DOCUMENT_TYPES) {
    await prisma.documentType.upsert({
      where: {
        organizationId_code: {
          organizationId,
          code: docType.code,
        },
      },
      update: {
        name: docType.name,
        description: docType.description,
        isRequired: docType.isRequired,
        sortOrder: docType.sortOrder,
        validityDays: docType.validityDays,
      },
      create: {
        organizationId,
        ...docType,
      },
    });
    console.log(`  ✅ ${docType.name}`);
  }
}

async function seedCollateralTypesForOrganization(organizationId: string) {
  console.log(
    `🏠 Seeding Collateral Types for organization ${organizationId}...`
  );

  for (const collateralType of DEFAULT_COLLATERAL_TYPES) {
    await prisma.collateralType.upsert({
      where: {
        organizationId_code: {
          organizationId,
          code: collateralType.code,
        },
      },
      update: {
        name: collateralType.name,
        description: collateralType.description,
        sortOrder: collateralType.sortOrder,
        requiredFields: collateralType.requiredFields,
      },
      create: {
        organizationId,
        ...collateralType,
      },
    });
    console.log(`  ✅ ${collateralType.name}`);
  }
}

async function seedAllOrganizations() {
  console.log('🏢 Seeding default data for all organizations...');

  const organizations = await prisma.organization.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  });

  for (const org of organizations) {
    console.log(`\n📌 Processing organization: ${org.name}`);
    await seedDocumentTypesForOrganization(org.id);
    await seedCollateralTypesForOrganization(org.id);
  }
}

async function main() {
  console.log('🚀 Starting Client Management Seed...\n');

  try {
    // Seed global AI providers
    await seedAIProviders();

    // Seed organization-specific data
    await seedAllOrganizations();

    console.log('\n✨ Seed completed successfully!');
  } catch (error) {
    console.error('❌ Seed failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Export functions for use in bootstrap script
export {
  seedAIProviders,
  seedDocumentTypesForOrganization,
  seedCollateralTypesForOrganization,
  seedAllOrganizations,
  DEFAULT_DOCUMENT_TYPES,
  DEFAULT_COLLATERAL_TYPES,
  AI_PROVIDERS,
};

// Run if called directly
if (require.main === module) {
  main();
}
