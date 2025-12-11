/**
 * Seed Loan Engine Settings
 *
 * Creates default organization settings for the loan engine.
 * These settings allow organizations to choose their loan calculation method.
 *
 * Usage: npx tsx scripts/seed-loan-engine-settings.ts
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

// Create PostgreSQL pool and Prisma client for script
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Enum type (also available from @prisma/client after generate)
const LoanCalculationEngineType = {
  SHORT_TERM: 'SHORT_TERM',
  LONG_TERM: 'LONG_TERM',
  REDUCING_BALANCE: 'REDUCING_BALANCE',
  FLAT_RATE: 'FLAT_RATE',
  CUSTOM: 'CUSTOM',
} as const;

// Default loan engine settings
const LOAN_ENGINE_SETTINGS = [
  {
    key: 'loan_engine_type',
    value: LoanCalculationEngineType.SHORT_TERM,
    description:
      'The loan calculation engine type to use. Options: SHORT_TERM (simple interest, period-based), LONG_TERM (amortized), REDUCING_BALANCE, FLAT_RATE, CUSTOM',
  },
  {
    key: 'loan_approval_required',
    value: true,
    description: 'Whether loan approval is required before disbursement',
  },
  {
    key: 'loan_auto_process_enabled',
    value: true,
    description: 'Whether the loan engine should auto-process loans (for status updates, interest, charges)',
  },
  {
    key: 'loan_default_grace_period_days',
    value: 7,
    description: 'Default grace period in days before marking loans as default',
  },
  {
    key: 'loan_overdue_notification_enabled',
    value: true,
    description: 'Whether to send notifications for overdue loans',
  },
  {
    key: 'loan_due_date_reminder_days',
    value: 3,
    description: 'Days before due date to send reminders',
  },
  {
    key: 'loan_interest_calculation_on_overdue',
    value: true,
    description: 'Whether to recalculate interest when loan becomes overdue',
  },
];

async function seedSystemSettings() {
  console.log('Seeding system-level loan engine settings...');

  for (const setting of LOAN_ENGINE_SETTINGS) {
    await prisma.systemSettings.upsert({
      where: { settingKey: setting.key },
      update: {
        settingValue: setting.value,
        description: setting.description,
      },
      create: {
        settingKey: setting.key,
        settingValue: setting.value,
        description: setting.description,
      },
    });

    console.log(`  - ${setting.key}: ${JSON.stringify(setting.value)}`);
  }

  console.log('System settings seeded successfully!');
}

async function seedOrganizationSettings(organizationId?: string) {
  let organizations;

  if (organizationId) {
    organizations = await prisma.organization.findMany({
      where: { id: organizationId },
    });
  } else {
    organizations = await prisma.organization.findMany({
      where: { isActive: true },
    });
  }

  console.log(`\nSeeding loan engine settings for ${organizations.length} organizations...`);

  for (const org of organizations) {
    console.log(`\n  Organization: ${org.name}`);

    for (const setting of LOAN_ENGINE_SETTINGS) {
      // Check if setting already exists
      const existing = await prisma.organizationSettings.findUnique({
        where: {
          organizationId_settingKey: {
            organizationId: org.id,
            settingKey: setting.key,
          },
        },
      });

      if (!existing) {
        await prisma.organizationSettings.create({
          data: {
            organizationId: org.id,
            settingKey: setting.key,
            settingValue: setting.value,
            description: setting.description,
          },
        });
        console.log(`    + ${setting.key}: ${JSON.stringify(setting.value)}`);
      } else {
        console.log(`    ~ ${setting.key}: already set`);
      }
    }
  }

  console.log('\nOrganization settings seeded successfully!');
}

async function main() {
  try {
    console.log('='.repeat(60));
    console.log('Loan Engine Settings Seeder');
    console.log('='.repeat(60));

    // Seed system-level defaults
    await seedSystemSettings();

    // Seed organization-level settings (with system defaults)
    const orgId = process.argv[2]; // Optional org ID argument
    await seedOrganizationSettings(orgId);

    console.log('\n' + '='.repeat(60));
    console.log('Seeding completed!');
    console.log('='.repeat(60));
  } catch (error) {
    console.error('Seeding failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
