import 'dotenv/config';
import { prisma } from '../src/config/database';

async function runMigration() {
  console.log("Adding 5C's assessment fields to loan_assessments table...");

  try {
    // Add columns if they don't exist (PostgreSQL syntax)
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "loan_assessments" 
      ADD COLUMN IF NOT EXISTS "clientCharacter" VARCHAR(50),
      ADD COLUMN IF NOT EXISTS "clientCapacity" VARCHAR(50),
      ADD COLUMN IF NOT EXISTS "collateralQuality" VARCHAR(50),
      ADD COLUMN IF NOT EXISTS "conditions" VARCHAR(50),
      ADD COLUMN IF NOT EXISTS "capitalAdequacy" VARCHAR(50),
      ADD COLUMN IF NOT EXISTS "recommendedAmount" DECIMAL(15,2),
      ADD COLUMN IF NOT EXISTS "recommendation" VARCHAR(50)
    `);

    console.log(
      "✅ Migration successful! 5C's fields added to loan_assessments table."
    );
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runMigration();
