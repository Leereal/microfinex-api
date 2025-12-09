-- Add missing columns to charges table to match Prisma schema

-- Add code column
ALTER TABLE charges ADD COLUMN IF NOT EXISTS code VARCHAR(50);
UPDATE charges SET code = UPPER(REPLACE(name, ' ', '_')) WHERE code IS NULL;
ALTER TABLE charges ALTER COLUMN code SET NOT NULL;

-- Add calculationType enum and column
DO $$ BEGIN
    CREATE TYPE "ChargeCalculationType" AS ENUM ('PERCENTAGE', 'FIXED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
ALTER TABLE charges ADD COLUMN IF NOT EXISTS "calculationType" "ChargeCalculationType" DEFAULT 'FIXED';

-- Add defaultAmount column (rename from amount if exists)
ALTER TABLE charges ADD COLUMN IF NOT EXISTS "defaultAmount" DECIMAL(15, 2);
UPDATE charges SET "defaultAmount" = amount WHERE "defaultAmount" IS NULL AND amount IS NOT NULL;

-- Add defaultPercentage column (rename from percentage if exists)
ALTER TABLE charges ADD COLUMN IF NOT EXISTS "defaultPercentage" DECIMAL(5, 4);
UPDATE charges SET "defaultPercentage" = percentage WHERE "defaultPercentage" IS NULL AND percentage IS NOT NULL;

-- Add appliesAt enum and column
DO $$ BEGIN
    CREATE TYPE "ChargeAppliesAt" AS ENUM ('DISBURSEMENT', 'REPAYMENT', 'OVERDUE', 'CLOSURE', 'MANUAL');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
ALTER TABLE charges ADD COLUMN IF NOT EXISTS "appliesAt" "ChargeAppliesAt" DEFAULT 'DISBURSEMENT';

-- Add isDeductedFromPrincipal column
ALTER TABLE charges ADD COLUMN IF NOT EXISTS "isDeductedFromPrincipal" BOOLEAN DEFAULT false;

-- Add isMandatory column
ALTER TABLE charges ADD COLUMN IF NOT EXISTS "isMandatory" BOOLEAN DEFAULT false;

-- Add createdBy and updatedBy columns
ALTER TABLE charges ADD COLUMN IF NOT EXISTS "createdBy" VARCHAR(255);
ALTER TABLE charges ADD COLUMN IF NOT EXISTS "updatedBy" VARCHAR(255);

-- Create unique constraint on organizationId and code
DO $$ BEGIN
    ALTER TABLE charges ADD CONSTRAINT charges_org_code_unique UNIQUE ("organizationId", code);
EXCEPTION
    WHEN duplicate_table THEN null;
    WHEN duplicate_object THEN null;
END $$;

-- Create charge_rates table if not exists
CREATE TABLE IF NOT EXISTS charge_rates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "chargeId" UUID NOT NULL REFERENCES charges(id) ON DELETE CASCADE,
    currency VARCHAR(10) NOT NULL,
    amount DECIMAL(15, 2),
    percentage DECIMAL(5, 4),
    "minAmount" DECIMAL(15, 2),
    "maxAmount" DECIMAL(15, 2),
    "isActive" BOOLEAN DEFAULT true,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE("chargeId", currency)
);
