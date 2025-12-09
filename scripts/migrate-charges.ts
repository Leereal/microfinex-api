/**
 * Migration Script: Add Charge Management System
 *
 * This script adds:
 * 1. New enums: ChargeCalculationType, ChargeAppliesAt
 * 2. New values to ChargeType enum
 * 3. New columns to charges table
 * 4. charge_rates table for currency-specific rates
 * 5. New columns to loan_charges table
 */

import { Pool } from 'pg';
import { config } from '../src/config';

async function runMigration() {
  const pool = new Pool({
    connectionString: config.databaseUrl,
  });

  const client = await pool.connect();

  try {
    console.log('Starting charge system migration...\n');

    await client.query('BEGIN');

    // 1. Create ChargeCalculationType enum
    console.log('1. Creating ChargeCalculationType enum...');
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE "ChargeCalculationType" AS ENUM ('PERCENTAGE', 'FIXED');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    console.log('   ✓ ChargeCalculationType enum created/exists\n');

    // 2. Create ChargeAppliesAt enum
    console.log('2. Creating ChargeAppliesAt enum...');
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE "ChargeAppliesAt" AS ENUM ('DISBURSEMENT', 'REPAYMENT', 'OVERDUE', 'CLOSURE', 'MANUAL');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    console.log('   ✓ ChargeAppliesAt enum created/exists\n');

    // 3. Add new values to ChargeType enum
    console.log('3. Adding new values to ChargeType enum...');
    const newChargeTypes = [
      'ADMIN_FEE',
      'SERVICE_FEE',
      'APPLICATION_FEE',
      'LEGAL_FEE',
      'INSURANCE_FEE',
      'DOCUMENTATION_FEE',
      'DISBURSEMENT_FEE',
      'EARLY_REPAYMENT_FEE',
      'LATE_PAYMENT_FEE',
      'PENALTY_FEE',
      'PROCESSING_FEE',
      'VALUATION_FEE',
      'COLLECTION_FEE',
      'OTHER',
    ];

    for (const chargeType of newChargeTypes) {
      try {
        await client.query(
          `ALTER TYPE "ChargeType" ADD VALUE IF NOT EXISTS '${chargeType}'`
        );
        console.log(`   ✓ Added ${chargeType}`);
      } catch (e: any) {
        if (e.code === '42710') {
          console.log(`   - ${chargeType} already exists`);
        } else {
          throw e;
        }
      }
    }
    console.log('');

    // 4. Add new columns to charges table
    console.log('4. Adding new columns to charges table...');

    // calculationType column
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE charges ADD COLUMN "calculationType" "ChargeCalculationType" DEFAULT 'FIXED';
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);
    console.log('   ✓ calculationType column added/exists');

    // appliesAt column
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE charges ADD COLUMN "appliesAt" "ChargeAppliesAt" DEFAULT 'DISBURSEMENT';
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);
    console.log('   ✓ appliesAt column added/exists');

    // percentageValue column
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE charges ADD COLUMN "percentageValue" DECIMAL(10, 4) DEFAULT 0;
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);
    console.log('   ✓ percentageValue column added/exists');

    // isMandatory column
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE charges ADD COLUMN "isMandatory" BOOLEAN DEFAULT false;
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);
    console.log('   ✓ isMandatory column added/exists');

    // isActive column
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE charges ADD COLUMN "isActive" BOOLEAN DEFAULT true;
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);
    console.log('   ✓ isActive column added/exists');

    // minAmount column
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE charges ADD COLUMN "minAmount" DECIMAL(18, 2);
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);
    console.log('   ✓ minAmount column added/exists');

    // maxAmount column
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE charges ADD COLUMN "maxAmount" DECIMAL(18, 2);
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);
    console.log('   ✓ maxAmount column added/exists');

    // taxable column
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE charges ADD COLUMN "taxable" BOOLEAN DEFAULT false;
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);
    console.log('   ✓ taxable column added/exists');

    // taxRate column
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE charges ADD COLUMN "taxRate" DECIMAL(10, 4) DEFAULT 0;
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);
    console.log('   ✓ taxRate column added/exists\n');

    // 5. Create charge_rates table for currency-specific rates
    console.log('5. Creating charge_rates table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS charge_rates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "chargeId" TEXT NOT NULL REFERENCES charges(id) ON DELETE CASCADE,
        currency VARCHAR(10) NOT NULL DEFAULT 'USD',
        "fixedAmount" DECIMAL(18, 2) DEFAULT 0,
        "percentageValue" DECIMAL(10, 4) DEFAULT 0,
        "minAmount" DECIMAL(18, 2),
        "maxAmount" DECIMAL(18, 2),
        "isActive" BOOLEAN DEFAULT true,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_charge_currency UNIQUE ("chargeId", currency)
      );
    `);
    console.log('   ✓ charge_rates table created/exists');

    // Create index
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_charge_rates_charge_id ON charge_rates("chargeId");
    `);
    console.log('   ✓ Index on chargeId created/exists');

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_charge_rates_currency ON charge_rates(currency);
    `);
    console.log('   ✓ Index on currency created/exists\n');

    // 6. Add new columns to loan_charges table
    console.log('6. Adding new columns to loan_charges table...');

    // financialTransactionId column (TEXT to match financial_transactions.id)
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE loan_charges ADD COLUMN "financialTransactionId" TEXT REFERENCES financial_transactions(id);
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);
    console.log('   ✓ financialTransactionId column added/exists');

    // calculationType column
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE loan_charges ADD COLUMN "calculationType" "ChargeCalculationType";
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);
    console.log('   ✓ calculationType column added/exists');

    // percentageValue column
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE loan_charges ADD COLUMN "percentageValue" DECIMAL(10, 4);
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);
    console.log('   ✓ percentageValue column added/exists');

    // baseAmount column (the amount the percentage was calculated on)
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE loan_charges ADD COLUMN "baseAmount" DECIMAL(18, 2);
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);
    console.log('   ✓ baseAmount column added/exists');

    // taxAmount column
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE loan_charges ADD COLUMN "taxAmount" DECIMAL(18, 2) DEFAULT 0;
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);
    console.log('   ✓ taxAmount column added/exists');

    // appliedAt column
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE loan_charges ADD COLUMN "appliedAt" "ChargeAppliesAt";
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);
    console.log('   ✓ appliedAt column added/exists');

    // Create index for financial transaction lookup
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_loan_charges_financial_tx ON loan_charges("financialTransactionId");
    `);
    console.log('   ✓ Index on financialTransactionId created/exists\n');

    await client.query('COMMIT');
    console.log('✅ Migration completed successfully!');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
