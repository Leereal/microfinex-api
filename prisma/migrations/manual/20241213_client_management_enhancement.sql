-- =====================================================
-- CLIENT MANAGEMENT SYSTEM ENHANCEMENT
-- Migration: client_management_enhancement
-- Date: December 2024
-- =====================================================
-- This migration adds support for:
-- - Document management with AI extraction
-- - Multiple client addresses and contacts
-- - Business client information
-- - Collateral tracking
-- - CSV/Excel import functionality
-- =====================================================

-- New Enums
CREATE TYPE "AddressType" AS ENUM ('RESIDENTIAL', 'BUSINESS', 'POSTAL', 'PREVIOUS');
CREATE TYPE "ContactType" AS ENUM ('MOBILE', 'LANDLINE', 'EMAIL', 'FAX');
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'UPLOADED', 'VERIFIED', 'REJECTED', 'EXPIRED');
CREATE TYPE "BusinessType" AS ENUM ('SOLE_PROPRIETOR', 'PARTNERSHIP', 'PRIVATE_LIMITED', 'PUBLIC_LIMITED', 'COOPERATIVE', 'TRUST', 'NGO', 'OTHER');
CREATE TYPE "OwnershipStatus" AS ENUM ('FULLY_OWNED', 'FINANCED', 'LEASED', 'JOINT_OWNERSHIP');
CREATE TYPE "CollateralStatus" AS ENUM ('AVAILABLE', 'PLEDGED', 'RELEASED', 'REPOSSESSED', 'SOLD');
CREATE TYPE "ImportType" AS ENUM ('CLIENTS', 'LOANS', 'PAYMENTS', 'GROUPS', 'EMPLOYERS');
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'VALIDATING', 'PROCESSING', 'COMPLETED', 'FAILED', 'PARTIALLY_COMPLETED');

-- Add BWP to Currency enum (if not exists)
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'BWP';

-- =====================================================
-- Document Types Table
-- =====================================================
CREATE TABLE "document_types" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "validityDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_types_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "document_types_organizationId_code_key" ON "document_types"("organizationId", "code");

ALTER TABLE "document_types" ADD CONSTRAINT "document_types_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =====================================================
-- AI Providers Table
-- =====================================================
CREATE TABLE "ai_providers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "baseUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isLocal" BOOLEAN NOT NULL DEFAULT false,
    "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_providers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_providers_name_key" ON "ai_providers"("name");

-- =====================================================
-- Organization AI Configs Table
-- =====================================================
CREATE TABLE "organization_ai_configs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "aiProviderId" TEXT NOT NULL,
    "apiKey" TEXT,
    "modelName" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "maxTokens" INTEGER,
    "temperature" DOUBLE PRECISION,
    "settings" JSONB,
    "usageThisMonth" INTEGER NOT NULL DEFAULT 0,
    "usageLimit" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_ai_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organization_ai_configs_organizationId_aiProviderId_key" ON "organization_ai_configs"("organizationId", "aiProviderId");

ALTER TABLE "organization_ai_configs" ADD CONSTRAINT "organization_ai_configs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_ai_configs" ADD CONSTRAINT "organization_ai_configs_aiProviderId_fkey" FOREIGN KEY ("aiProviderId") REFERENCES "ai_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================
-- Client Addresses Table
-- =====================================================
CREATE TABLE "client_addresses" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "addressType" "AddressType" NOT NULL DEFAULT 'RESIDENTIAL',
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "suburb" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT,
    "zipCode" TEXT,
    "country" TEXT NOT NULL DEFAULT 'Zimbabwe',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_addresses_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "client_addresses" ADD CONSTRAINT "client_addresses_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =====================================================
-- Client Contacts Table
-- =====================================================
CREATE TABLE "client_contacts" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "contactType" "ContactType" NOT NULL DEFAULT 'MOBILE',
    "contactValue" TEXT NOT NULL,
    "label" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isWhatsApp" BOOLEAN NOT NULL DEFAULT false,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_contacts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =====================================================
-- Client Documents Table
-- =====================================================
CREATE TABLE "client_documents" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "documentTypeId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "storageUrl" TEXT,
    "documentNumber" TEXT,
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "issuingAuthority" TEXT,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "aiExtractionData" JSONB,
    "aiConfidence" DOUBLE PRECISION,
    "extractedAt" TIMESTAMP(3),
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_documents_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "client_documents" ADD CONSTRAINT "client_documents_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_documents" ADD CONSTRAINT "client_documents_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES "document_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================
-- Client Business Table
-- =====================================================
CREATE TABLE "client_businesses" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "tradingName" TEXT,
    "registrationNumber" TEXT,
    "taxNumber" TEXT,
    "vatNumber" TEXT,
    "businessType" "BusinessType" NOT NULL DEFAULT 'SOLE_PROPRIETOR',
    "industry" TEXT,
    "sector" TEXT,
    "yearEstablished" INTEGER,
    "numberOfEmployees" INTEGER,
    "monthlyTurnover" DECIMAL(15,2),
    "annualRevenue" DECIMAL(15,2),
    "businessAddress" TEXT,
    "businessPhone" TEXT,
    "businessEmail" TEXT,
    "website" TEXT,
    "bankName" TEXT,
    "bankAccountNumber" TEXT,
    "bankBranchCode" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_businesses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "client_businesses_clientId_key" ON "client_businesses"("clientId");

ALTER TABLE "client_businesses" ADD CONSTRAINT "client_businesses_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =====================================================
-- Collateral Types Table
-- =====================================================
CREATE TABLE "collateral_types" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "requiredFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collateral_types_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "collateral_types_organizationId_code_key" ON "collateral_types"("organizationId", "code");

ALTER TABLE "collateral_types" ADD CONSTRAINT "collateral_types_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =====================================================
-- Client Collaterals Table
-- =====================================================
CREATE TABLE "client_collaterals" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "collateralTypeId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "estimatedValue" DECIMAL(15,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'USD',
    "valuationDate" TIMESTAMP(3),
    "valuator" TEXT,
    "registrationNumber" TEXT,
    "serialNumber" TEXT,
    "make" TEXT,
    "model" TEXT,
    "year" INTEGER,
    "location" TEXT,
    "ownershipStatus" "OwnershipStatus" NOT NULL DEFAULT 'FULLY_OWNED',
    "ownershipDetails" TEXT,
    "insuranceProvider" TEXT,
    "insurancePolicyNo" TEXT,
    "insuranceExpiryDate" TIMESTAMP(3),
    "status" "CollateralStatus" NOT NULL DEFAULT 'AVAILABLE',
    "loanId" TEXT,
    "pledgedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "notes" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_collaterals_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "client_collaterals" ADD CONSTRAINT "client_collaterals_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_collaterals" ADD CONSTRAINT "client_collaterals_collateralTypeId_fkey" FOREIGN KEY ("collateralTypeId") REFERENCES "collateral_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "client_collaterals" ADD CONSTRAINT "client_collaterals_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =====================================================
-- Collateral Documents Table
-- =====================================================
CREATE TABLE "collateral_documents" (
    "id" TEXT NOT NULL,
    "collateralId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collateral_documents_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "collateral_documents" ADD CONSTRAINT "collateral_documents_collateralId_fkey" FOREIGN KEY ("collateralId") REFERENCES "client_collaterals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =====================================================
-- Import Jobs Table
-- =====================================================
CREATE TABLE "import_jobs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "importType" "ImportType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "totalRows" INTEGER,
    "processedRows" INTEGER NOT NULL DEFAULT 0,
    "successfulRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "errorLog" JSONB,
    "mapping" JSONB,
    "createdBy" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =====================================================
-- Indexes for Performance
-- =====================================================
CREATE INDEX "client_addresses_clientId_idx" ON "client_addresses"("clientId");
CREATE INDEX "client_contacts_clientId_idx" ON "client_contacts"("clientId");
CREATE INDEX "client_documents_clientId_idx" ON "client_documents"("clientId");
CREATE INDEX "client_documents_documentTypeId_idx" ON "client_documents"("documentTypeId");
CREATE INDEX "client_collaterals_clientId_idx" ON "client_collaterals"("clientId");
CREATE INDEX "client_collaterals_loanId_idx" ON "client_collaterals"("loanId");
CREATE INDEX "client_collaterals_status_idx" ON "client_collaterals"("status");
CREATE INDEX "import_jobs_organizationId_idx" ON "import_jobs"("organizationId");
CREATE INDEX "import_jobs_status_idx" ON "import_jobs"("status");
