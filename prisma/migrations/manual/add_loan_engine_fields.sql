-- CreateEnum
CREATE TYPE "LoanCalculationEngineType" AS ENUM ('SHORT_TERM', 'LONG_TERM', 'REDUCING_BALANCE', 'FLAT_RATE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "DurationUnit" AS ENUM ('DAYS', 'WEEKS', 'MONTHS', 'YEARS');

-- CreateEnum
CREATE TYPE "ChargeMode" AS ENUM ('MANUAL', 'AUTO');

-- CreateEnum
CREATE TYPE "ChargeApplication" AS ENUM ('PRINCIPAL', 'BALANCE', 'OTHER');

-- AlterEnum
-- Adding DEFAULT status to LoanStatus enum
ALTER TYPE "LoanStatus" ADD VALUE IF NOT EXISTS 'DEFAULT';

-- AlterTable - Add new fields to loans table
ALTER TABLE "loans" 
ADD COLUMN IF NOT EXISTS "startDate" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "expectedRepaymentDate" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "nextDueDate" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "interestAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "gracePeriodDays" INTEGER NOT NULL DEFAULT 0;

-- AlterTable - Add new fields to loan_products table
ALTER TABLE "loan_products"
ADD COLUMN IF NOT EXISTS "gracePeriodDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "durationUnit" "DurationUnit" NOT NULL DEFAULT 'MONTHS',
ADD COLUMN IF NOT EXISTS "minPeriod" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS "maxPeriod" INTEGER NOT NULL DEFAULT 12,
ADD COLUMN IF NOT EXISTS "engineType" "LoanCalculationEngineType" NOT NULL DEFAULT 'SHORT_TERM',
ADD COLUMN IF NOT EXISTS "allowAutoCalculations" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable - Add new fields to charges table
ALTER TABLE "charges"
ADD COLUMN IF NOT EXISTS "triggerStatus" "LoanStatus",
ADD COLUMN IF NOT EXISTS "chargeMode" "ChargeMode" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN IF NOT EXISTS "chargeApplication" "ChargeApplication" NOT NULL DEFAULT 'PRINCIPAL';

-- Add indexes for loan engine queries
CREATE INDEX IF NOT EXISTS "loans_nextDueDate_idx" ON "loans"("nextDueDate");
CREATE INDEX IF NOT EXISTS "loans_expectedRepaymentDate_idx" ON "loans"("expectedRepaymentDate");
CREATE INDEX IF NOT EXISTS "loans_status_nextDueDate_idx" ON "loans"("status", "nextDueDate");
CREATE INDEX IF NOT EXISTS "charges_triggerStatus_idx" ON "charges"("triggerStatus");
CREATE INDEX IF NOT EXISTS "charges_chargeMode_idx" ON "charges"("chargeMode");
