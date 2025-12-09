import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function addMissingColumns() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log('Adding missing columns to charges table...\n');

    // Check current columns
    const columnsResult = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'charges' 
      AND table_schema = 'public'
      ORDER BY ordinal_position
    `);

    const existingColumns = columnsResult.rows.map((r: any) => r.column_name);
    console.log('Existing columns:', existingColumns);

    // Add missing columns if they don't exist
    const alterStatements: string[] = [];

    // Add code column
    if (!existingColumns.includes('code')) {
      alterStatements.push(`
        ALTER TABLE "charges" 
        ADD COLUMN "code" VARCHAR(50);
      `);
      // We'll generate codes from name after adding the column
    }

    // Rename amount to defaultAmount if amount exists and defaultAmount doesn't
    if (
      existingColumns.includes('amount') &&
      !existingColumns.includes('defaultAmount')
    ) {
      alterStatements.push(`
        ALTER TABLE "charges" 
        RENAME COLUMN "amount" TO "defaultAmount";
      `);
    }

    // Rename percentage/percentageValue to defaultPercentage
    if (
      existingColumns.includes('percentageValue') &&
      !existingColumns.includes('defaultPercentage')
    ) {
      alterStatements.push(`
        ALTER TABLE "charges" 
        RENAME COLUMN "percentageValue" TO "defaultPercentage";
      `);
    } else if (
      existingColumns.includes('percentage') &&
      !existingColumns.includes('defaultPercentage')
    ) {
      alterStatements.push(`
        ALTER TABLE "charges" 
        RENAME COLUMN "percentage" TO "defaultPercentage";
      `);
    }

    // Add isDeductedFromPrincipal if it doesn't exist
    if (!existingColumns.includes('isDeductedFromPrincipal')) {
      alterStatements.push(`
        ALTER TABLE "charges" 
        ADD COLUMN "isDeductedFromPrincipal" BOOLEAN NOT NULL DEFAULT false;
      `);
    }

    // Add createdBy if it doesn't exist
    if (!existingColumns.includes('createdBy')) {
      alterStatements.push(`
        ALTER TABLE "charges" 
        ADD COLUMN "createdBy" VARCHAR(255);
      `);
    }

    // Add updatedBy if it doesn't exist
    if (!existingColumns.includes('updatedBy')) {
      alterStatements.push(`
        ALTER TABLE "charges" 
        ADD COLUMN "updatedBy" VARCHAR(255);
      `);
    }

    // Drop currency column if it exists (it should be in ChargeRate, not Charge)
    if (existingColumns.includes('currency')) {
      alterStatements.push(`
        ALTER TABLE "charges" 
        DROP COLUMN IF EXISTS "currency";
      `);
    }

    // Drop isPercentage column if it exists (replaced by calculationType)
    if (existingColumns.includes('isPercentage')) {
      alterStatements.push(`
        ALTER TABLE "charges" 
        DROP COLUMN IF EXISTS "isPercentage";
      `);
    }

    // Drop minAmount and maxAmount from charges (should be in ChargeRate)
    if (existingColumns.includes('minAmount')) {
      alterStatements.push(`
        ALTER TABLE "charges" 
        DROP COLUMN IF EXISTS "minAmount";
      `);
    }

    if (existingColumns.includes('maxAmount')) {
      alterStatements.push(`
        ALTER TABLE "charges" 
        DROP COLUMN IF EXISTS "maxAmount";
      `);
    }

    // Drop taxable and taxRate (not in schema)
    if (existingColumns.includes('taxable')) {
      alterStatements.push(`
        ALTER TABLE "charges" 
        DROP COLUMN IF EXISTS "taxable";
      `);
    }

    if (existingColumns.includes('taxRate')) {
      alterStatements.push(`
        ALTER TABLE "charges" 
        DROP COLUMN IF EXISTS "taxRate";
      `);
    }

    // Execute alter statements
    for (const stmt of alterStatements) {
      console.log('Executing:', stmt.trim());
      try {
        await pool.query(stmt);
        console.log('✓ Success\n');
      } catch (err: any) {
        console.error('✗ Error:', err.message, '\n');
      }
    }

    // Generate code values for existing records
    const codeUpdateResult = await pool.query(`
      UPDATE "charges" 
      SET "code" = UPPER(REPLACE(REPLACE(REPLACE("name", ' ', '_'), '-', '_'), '.', ''))
      WHERE "code" IS NULL;
    `);
    console.log(
      `Updated ${codeUpdateResult.rowCount} rows with generated codes`
    );

    // Make code column NOT NULL after populating
    try {
      await pool.query(
        `ALTER TABLE "charges" ALTER COLUMN "code" SET NOT NULL;`
      );
      console.log('✓ Made code column NOT NULL');
    } catch (err: any) {
      console.log(
        'Could not set NOT NULL (may already be set or have null values):',
        err.message
      );
    }

    // Add unique constraint on (organizationId, code)
    try {
      await pool.query(`
        ALTER TABLE "charges" 
        ADD CONSTRAINT "charges_organizationId_code_key" 
        UNIQUE ("organizationId", "code");
      `);
      console.log('✓ Added unique constraint on (organizationId, code)');
    } catch (err: any) {
      console.log(
        'Could not add unique constraint (may already exist):',
        err.message
      );
    }

    // Verify final columns
    const finalColumns = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'charges' 
      AND table_schema = 'public'
      ORDER BY ordinal_position
    `);

    console.log('\nFinal columns in charges table:');
    finalColumns.rows.forEach((r: any) => {
      console.log(
        `  ${r.column_name}: ${r.data_type} (nullable: ${r.is_nullable})`
      );
    });

    console.log('\n✅ Migration complete!');
  } catch (err) {
    console.error('Migration failed:', err);
    throw err;
  } finally {
    await pool.end();
  }
}

addMissingColumns();
