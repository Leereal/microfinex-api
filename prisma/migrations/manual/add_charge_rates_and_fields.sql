-- Migration: Add charge rates and expanded charge fields
-- Version: 2024-01-XX
-- Description: Adds ChargeCalculationType, ChargeAppliesAt enums, ChargeRate table, and extended charge fields

-- ==========================================
-- 1. CREATE NEW ENUMS
-- ==========================================

-- Create ChargeCalculationType enum
DO $$ BEGIN
    CREATE TYPE "ChargeCalculationType" AS ENUM ('FIXED', 'PERCENTAGE', 'PERCENTAGE_BALANCE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create ChargeAppliesAt enum
DO $$ BEGIN
    CREATE TYPE "ChargeAppliesAt" AS ENUM ('DISBURSEMENT', 'APPROVAL', 'SETTLEMENT', 'LATE_PAYMENT', 'MONTHLY', 'MANUAL');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ==========================================
-- 2. ADD NEW VALUES TO ChargeType ENUM
-- ==========================================

-- Add new ChargeType values (PostgreSQL doesn't allow IF NOT EXISTS for ALTER TYPE)
DO $$ 
BEGIN
    -- Check if ADMIN_FEE exists, if not add it
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'ADMIN_FEE' AND enumtypid = 'ChargeType'::regtype) THEN
        ALTER TYPE "ChargeType" ADD VALUE 'ADMIN_FEE';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'APPLICATION_FEE' AND enumtypid = 'ChargeType'::regtype) THEN
        ALTER TYPE "ChargeType" ADD VALUE 'APPLICATION_FEE';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'LEGAL_FEE' AND enumtypid = 'ChargeType'::regtype) THEN
        ALTER TYPE "ChargeType" ADD VALUE 'LEGAL_FEE';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'DOCUMENTATION_FEE' AND enumtypid = 'ChargeType'::regtype) THEN
        ALTER TYPE "ChargeType" ADD VALUE 'DOCUMENTATION_FEE';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'INSURANCE_FEE' AND enumtypid = 'ChargeType'::regtype) THEN
        ALTER TYPE "ChargeType" ADD VALUE 'INSURANCE_FEE';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'STAMP_DUTY' AND enumtypid = 'ChargeType'::regtype) THEN
        ALTER TYPE "ChargeType" ADD VALUE 'STAMP_DUTY';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'EARLY_SETTLEMENT_FEE' AND enumtypid = 'ChargeType'::regtype) THEN
        ALTER TYPE "ChargeType" ADD VALUE 'EARLY_SETTLEMENT_FEE';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'COLLECTION_FEE' AND enumtypid = 'ChargeType'::regtype) THEN
        ALTER TYPE "ChargeType" ADD VALUE 'COLLECTION_FEE';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'RESTRUCTURE_FEE' AND enumtypid = 'ChargeType'::regtype) THEN
        ALTER TYPE "ChargeType" ADD VALUE 'RESTRUCTURE_FEE';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'OTHER' AND enumtypid = 'ChargeType'::regtype) THEN
        ALTER TYPE "ChargeType" ADD VALUE 'OTHER';
    END IF;
EXCEPTION
    WHEN others THEN 
        RAISE NOTICE 'Some enum values may already exist, continuing...';
END $$;

-- ==========================================
-- 3. ALTER CHARGES TABLE
-- ==========================================

-- Add new columns to charges table
ALTER TABLE "charges" 
    ADD COLUMN IF NOT EXISTS "code" TEXT,
    ADD COLUMN IF NOT EXISTS "calculationType" "ChargeCalculationType" DEFAULT 'FIXED',
    ADD COLUMN IF NOT EXISTS "defaultAmount" DECIMAL(15, 2),
    ADD COLUMN IF NOT EXISTS "defaultPercentage" DECIMAL(5, 4),
    ADD COLUMN IF NOT EXISTS "appliesAt" "ChargeAppliesAt" DEFAULT 'DISBURSEMENT',
    ADD COLUMN IF NOT EXISTS "isDeductedFromPrincipal" BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS "isMandatory" BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS "createdBy" TEXT,
    ADD COLUMN IF NOT EXISTS "updatedBy" TEXT;

-- Migrate existing data: set code from name (uppercase, underscored)
UPDATE "charges" 
SET "code" = UPPER(REGEXP_REPLACE("name", '[^a-zA-Z0-9]', '_', 'g'))
WHERE "code" IS NULL;

-- Migrate existing percentage/amount data
UPDATE "charges"
SET 
    "calculationType" = CASE 
        WHEN "isPercentage" = true THEN 'PERCENTAGE'::"ChargeCalculationType"
        ELSE 'FIXED'::"ChargeCalculationType"
    END,
    "defaultAmount" = CASE WHEN "isPercentage" = false THEN "amount" ELSE NULL END,
    "defaultPercentage" = CASE WHEN "isPercentage" = true THEN "percentage" / 100 ELSE NULL END
WHERE "calculationType" IS NULL OR "calculationType" = 'FIXED';

-- Add unique constraint on organization + code (if not exists)
DO $$ BEGIN
    ALTER TABLE "charges" ADD CONSTRAINT "charges_organizationId_code_key" UNIQUE ("organizationId", "code");
EXCEPTION
    WHEN duplicate_table THEN null;
    WHEN duplicate_object THEN null;
END $$;

-- ==========================================
-- 4. CREATE CHARGE_RATES TABLE
-- ==========================================

CREATE TABLE IF NOT EXISTS "charge_rates" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "chargeId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "amount" DECIMAL(15, 2),
    "percentage" DECIMAL(5, 4),
    "minAmount" DECIMAL(15, 2),
    "maxAmount" DECIMAL(15, 2),
    "isActive" BOOLEAN DEFAULT true,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "charge_rates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "charge_rates_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "charges"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Add unique constraint on charge + currency
DO $$ BEGIN
    ALTER TABLE "charge_rates" ADD CONSTRAINT "charge_rates_chargeId_currency_key" UNIQUE ("chargeId", "currency");
EXCEPTION
    WHEN duplicate_table THEN null;
    WHEN duplicate_object THEN null;
END $$;

-- Create index on chargeId
CREATE INDEX IF NOT EXISTS "charge_rates_chargeId_idx" ON "charge_rates"("chargeId");

-- ==========================================
-- 5. ALTER LOAN_CHARGES TABLE
-- ==========================================

-- Add new columns to loan_charges table
ALTER TABLE "loan_charges" 
    ADD COLUMN IF NOT EXISTS "chargeName" TEXT,
    ADD COLUMN IF NOT EXISTS "chargeType" "ChargeType",
    ADD COLUMN IF NOT EXISTS "calculationType" "ChargeCalculationType" DEFAULT 'FIXED',
    ADD COLUMN IF NOT EXISTS "currency" "Currency",
    ADD COLUMN IF NOT EXISTS "baseAmount" DECIMAL(15, 2),
    ADD COLUMN IF NOT EXISTS "calculatedAmount" DECIMAL(15, 2),
    ADD COLUMN IF NOT EXISTS "isDeductedFromPrincipal" BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS "isWaived" BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS "waivedBy" TEXT,
    ADD COLUMN IF NOT EXISTS "waivedAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "waiverReason" TEXT,
    ADD COLUMN IF NOT EXISTS "appliedBy" TEXT,
    ADD COLUMN IF NOT EXISTS "financialTransactionId" TEXT;

-- Migrate existing loan_charges data: populate denormalized fields
UPDATE "loan_charges" lc
SET 
    "chargeName" = c."name",
    "chargeType" = c."type",
    "calculationType" = COALESCE(c."calculationType", 'FIXED'::"ChargeCalculationType"),
    "baseAmount" = lc."amount",
    "calculatedAmount" = lc."amount"
FROM "charges" c
WHERE lc."chargeId" = c."id" AND lc."chargeName" IS NULL;

-- Set currency from loan's currency for existing loan_charges
UPDATE "loan_charges" lc
SET "currency" = l."currency"
FROM "loans" l
WHERE lc."loanId" = l."id" AND lc."currency" IS NULL;

-- ==========================================
-- 6. CREATE INDEXES
-- ==========================================

CREATE INDEX IF NOT EXISTS "charges_organizationId_isActive_idx" ON "charges"("organizationId", "isActive");
CREATE INDEX IF NOT EXISTS "charges_appliesAt_idx" ON "charges"("appliesAt");
CREATE INDEX IF NOT EXISTS "loan_charges_loanId_idx" ON "loan_charges"("loanId");
CREATE INDEX IF NOT EXISTS "loan_charges_status_idx" ON "loan_charges"("status");

-- ==========================================
-- DONE
-- ==========================================
