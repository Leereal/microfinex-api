import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function checkSchema() {
  try {
    // Check charges table columns
    const chargesColumns = await prisma.$queryRaw<any[]>`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'charges' 
      ORDER BY ordinal_position
    `;
    console.log('\n=== CHARGES TABLE ===');
    console.table(chargesColumns);

    // Check loan_charges table columns
    const loanChargesColumns = await prisma.$queryRaw<any[]>`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'loan_charges' 
      ORDER BY ordinal_position
    `;
    console.log('\n=== LOAN_CHARGES TABLE ===');
    console.table(loanChargesColumns);

    // Check if charge_rates table exists
    const chargeRatesExists = await prisma.$queryRaw<any[]>`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'charge_rates'
      ) as exists
    `;
    console.log('\n=== CHARGE_RATES TABLE EXISTS ===');
    console.log(chargeRatesExists);

    // Check enums
    const enums = await prisma.$queryRaw<any[]>`
      SELECT t.typname as enum_name, e.enumlabel as enum_value
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      WHERE t.typname IN ('ChargeType', 'ChargeCalculationType', 'ChargeAppliesAt')
      ORDER BY t.typname, e.enumsortorder
    `;
    console.log('\n=== CHARGE ENUMS ===');
    console.table(enums);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkSchema();
