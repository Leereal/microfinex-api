/**
 * Migration Script: Generate FinancialTransaction Records for Historical Loan Operations
 *
 * This script creates FinancialTransaction records for past disbursements and repayments
 * that were created before the financial integration was implemented.
 *
 * Usage:
 *   npx ts-node scripts/migrate-financial-transactions.ts
 *
 * Prerequisites:
 *   1. Ensure default income/expense categories are seeded for each organization
 *   2. Specify a default paymentMethodId for each organization (or the script will use the first active one)
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

// Get database URL from environment
const databaseUrl =
  process.env.DATABASE_URL ||
  'postgresql://user:password@localhost:5432/microfinex';

// Create PostgreSQL pool
const pool = new Pool({
  connectionString: databaseUrl,
});

// Create Prisma adapter
const adapter = new PrismaPg(pool);

// Create Prisma client with adapter
const prisma = new PrismaClient({ adapter });

interface MigrationStats {
  disbursementsProcessed: number;
  disbursementsSkipped: number;
  repaymentsProcessed: number;
  repaymentsSkipped: number;
  errors: string[];
}

async function generateTransactionNumber(
  organizationId: string
): Promise<string> {
  const today = new Date();
  const year = today.getFullYear().toString().slice(-2);
  const month = (today.getMonth() + 1).toString().padStart(2, '0');
  const day = today.getDate().toString().padStart(2, '0');

  const startOfDay = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  const count = await prisma.financialTransaction.count({
    where: {
      organizationId,
      createdAt: {
        gte: startOfDay,
        lt: endOfDay,
      },
    },
  });

  const sequence = (count + 1).toString().padStart(5, '0');
  return `TXN${year}${month}${day}${sequence}`;
}

async function getDefaultPaymentMethod(
  organizationId: string
): Promise<string | null> {
  const paymentMethod = await prisma.paymentMethod.findFirst({
    where: {
      organizationId,
      isActive: true,
      type: 'CASH', // Prefer cash for historical data
    },
  });

  if (paymentMethod) return paymentMethod.id;

  // Fall back to any active payment method
  const anyPaymentMethod = await prisma.paymentMethod.findFirst({
    where: {
      organizationId,
      isActive: true,
    },
  });

  return anyPaymentMethod?.id || null;
}

async function migrateDisbursements(
  organizationId: string,
  dryRun: boolean = true
): Promise<{ processed: number; skipped: number; errors: string[] }> {
  const stats = { processed: 0, skipped: 0, errors: [] as string[] };

  // Get LOAN_DISBURSEMENT expense category
  const disbursementCategory = await prisma.expenseCategory.findFirst({
    where: {
      organizationId,
      code: 'LOAN_DISBURSEMENT',
    },
  });

  if (!disbursementCategory) {
    stats.errors.push(
      `No LOAN_DISBURSEMENT expense category found for organization ${organizationId}`
    );
    return stats;
  }

  // Get default payment method
  const paymentMethodId = await getDefaultPaymentMethod(organizationId);
  if (!paymentMethodId) {
    stats.errors.push(
      `No active payment method found for organization ${organizationId}`
    );
    return stats;
  }

  // Find all disbursement payments without corresponding financial transactions
  const disbursementPayments = await prisma.payment.findMany({
    where: {
      type: 'LOAN_DISBURSEMENT',
      loan: {
        organizationId,
      },
    },
    include: {
      loan: {
        select: {
          id: true,
          loanNumber: true,
          branchId: true,
          organizationId: true,
          currency: true,
        },
      },
    },
  });

  for (const payment of disbursementPayments) {
    // Check if a financial transaction already exists for this payment
    const existingTransaction = await prisma.financialTransaction.findFirst({
      where: {
        relatedLoanId: payment.loanId,
        type: 'EXPENSE',
        expenseCategoryId: disbursementCategory.id,
        amount: payment.amount,
      },
    });

    if (existingTransaction) {
      stats.skipped++;
      continue;
    }

    if (!dryRun) {
      try {
        const transactionNumber =
          await generateTransactionNumber(organizationId);

        await prisma.financialTransaction.create({
          data: {
            organizationId,
            branchId: payment.loan.branchId,
            transactionNumber,
            type: 'EXPENSE',
            expenseCategoryId: disbursementCategory.id,
            paymentMethodId,
            amount: payment.amount,
            currency: payment.loan.currency || 'USD',
            description: `Historical loan disbursement for ${payment.loan.loanNumber}`,
            relatedLoanId: payment.loanId,
            transactionDate: payment.paymentDate,
            status: 'COMPLETED',
            balanceBefore: 0, // Historical - we don't have exact balance
            balanceAfter: 0, // Historical - we don't have exact balance
            notes: 'Migrated from historical disbursement record',
            processedBy: payment.receivedBy,
          },
        });
        stats.processed++;
      } catch (error) {
        stats.errors.push(
          `Error migrating disbursement ${payment.id}: ${(error as Error).message}`
        );
      }
    } else {
      console.log(
        `[DRY RUN] Would create disbursement transaction for loan ${payment.loan.loanNumber}`
      );
      stats.processed++;
    }
  }

  return stats;
}

async function migrateRepayments(
  organizationId: string,
  dryRun: boolean = true
): Promise<{ processed: number; skipped: number; errors: string[] }> {
  const stats = { processed: 0, skipped: 0, errors: [] as string[] };

  // Get income categories
  const principalCategory = await prisma.incomeCategory.findFirst({
    where: { organizationId, code: 'LOAN_REPAYMENT' },
  });
  const interestCategory = await prisma.incomeCategory.findFirst({
    where: { organizationId, code: 'INTEREST_INCOME' },
  });
  const penaltyCategory = await prisma.incomeCategory.findFirst({
    where: { organizationId, code: 'PENALTY_INCOME' },
  });

  if (!principalCategory) {
    stats.errors.push(
      `No LOAN_REPAYMENT income category found for organization ${organizationId}`
    );
    return stats;
  }

  // Get default payment method
  const paymentMethodId = await getDefaultPaymentMethod(organizationId);
  if (!paymentMethodId) {
    stats.errors.push(
      `No active payment method found for organization ${organizationId}`
    );
    return stats;
  }

  // Find all repayment payments
  const repaymentPayments = await prisma.payment.findMany({
    where: {
      type: 'LOAN_REPAYMENT',
      loan: {
        organizationId,
      },
    },
    include: {
      loan: {
        select: {
          id: true,
          loanNumber: true,
          branchId: true,
          organizationId: true,
          currency: true,
        },
      },
    },
  });

  for (const payment of repaymentPayments) {
    // Check if financial transactions already exist for this payment
    const existingTransaction = await prisma.financialTransaction.findFirst({
      where: {
        relatedPaymentId: payment.id,
      },
    });

    if (existingTransaction) {
      stats.skipped++;
      continue;
    }

    const principalAmount = parseFloat(payment.principalAmount.toString());
    const interestAmount = parseFloat(payment.interestAmount.toString());
    const penaltyAmount = parseFloat(payment.penaltyAmount.toString());

    if (!dryRun) {
      try {
        // Create separate transactions for each component
        if (penaltyAmount > 0 && penaltyCategory) {
          const transactionNumber =
            await generateTransactionNumber(organizationId);
          await prisma.financialTransaction.create({
            data: {
              organizationId,
              branchId: payment.loan.branchId,
              transactionNumber,
              type: 'INCOME',
              incomeCategoryId: penaltyCategory.id,
              paymentMethodId,
              amount: penaltyAmount,
              currency: payment.loan.currency || 'USD',
              description: `Historical penalty payment for ${payment.loan.loanNumber}`,
              relatedLoanId: payment.loanId,
              relatedPaymentId: payment.id,
              transactionDate: payment.paymentDate,
              status: 'COMPLETED',
              balanceBefore: 0,
              balanceAfter: 0,
              notes: 'Migrated from historical repayment record',
              processedBy: payment.receivedBy,
            },
          });
        }

        if (interestAmount > 0 && interestCategory) {
          const transactionNumber =
            await generateTransactionNumber(organizationId);
          await prisma.financialTransaction.create({
            data: {
              organizationId,
              branchId: payment.loan.branchId,
              transactionNumber,
              type: 'INCOME',
              incomeCategoryId: interestCategory.id,
              paymentMethodId,
              amount: interestAmount,
              currency: payment.loan.currency || 'USD',
              description: `Historical interest payment for ${payment.loan.loanNumber}`,
              relatedLoanId: payment.loanId,
              relatedPaymentId: payment.id,
              transactionDate: payment.paymentDate,
              status: 'COMPLETED',
              balanceBefore: 0,
              balanceAfter: 0,
              notes: 'Migrated from historical repayment record',
              processedBy: payment.receivedBy,
            },
          });
        }

        if (principalAmount > 0) {
          const transactionNumber =
            await generateTransactionNumber(organizationId);
          await prisma.financialTransaction.create({
            data: {
              organizationId,
              branchId: payment.loan.branchId,
              transactionNumber,
              type: 'INCOME',
              incomeCategoryId: principalCategory.id,
              paymentMethodId,
              amount: principalAmount,
              currency: payment.loan.currency || 'USD',
              description: `Historical principal repayment for ${payment.loan.loanNumber}`,
              relatedLoanId: payment.loanId,
              relatedPaymentId: payment.id,
              transactionDate: payment.paymentDate,
              status: 'COMPLETED',
              balanceBefore: 0,
              balanceAfter: 0,
              notes: 'Migrated from historical repayment record',
              processedBy: payment.receivedBy,
            },
          });
        }

        stats.processed++;
      } catch (error) {
        stats.errors.push(
          `Error migrating repayment ${payment.id}: ${(error as Error).message}`
        );
      }
    } else {
      console.log(
        `[DRY RUN] Would create repayment transactions for payment ${payment.paymentNumber}`
      );
      stats.processed++;
    }
  }

  return stats;
}

async function main() {
  const dryRun =
    process.argv.includes('--dry-run') || !process.argv.includes('--execute');

  if (dryRun) {
    console.log('='.repeat(60));
    console.log('DRY RUN MODE - No changes will be made to the database');
    console.log('Run with --execute flag to perform actual migration');
    console.log('='.repeat(60));
  } else {
    console.log('='.repeat(60));
    console.log('EXECUTING MIGRATION - Changes will be made to the database');
    console.log('='.repeat(60));
  }

  // Get all organizations
  const organizations = await prisma.organization.findMany({
    select: { id: true, name: true },
  });

  console.log(`\nFound ${organizations.length} organizations to process\n`);

  const globalStats: MigrationStats = {
    disbursementsProcessed: 0,
    disbursementsSkipped: 0,
    repaymentsProcessed: 0,
    repaymentsSkipped: 0,
    errors: [],
  };

  for (const org of organizations) {
    console.log(`\nProcessing organization: ${org.name} (${org.id})`);
    console.log('-'.repeat(50));

    // Migrate disbursements
    console.log('  Migrating disbursements...');
    const disbursementStats = await migrateDisbursements(org.id, dryRun);
    globalStats.disbursementsProcessed += disbursementStats.processed;
    globalStats.disbursementsSkipped += disbursementStats.skipped;
    globalStats.errors.push(...disbursementStats.errors);
    console.log(
      `    Processed: ${disbursementStats.processed}, Skipped: ${disbursementStats.skipped}`
    );

    // Migrate repayments
    console.log('  Migrating repayments...');
    const repaymentStats = await migrateRepayments(org.id, dryRun);
    globalStats.repaymentsProcessed += repaymentStats.processed;
    globalStats.repaymentsSkipped += repaymentStats.skipped;
    globalStats.errors.push(...repaymentStats.errors);
    console.log(
      `    Processed: ${repaymentStats.processed}, Skipped: ${repaymentStats.skipped}`
    );
  }

  console.log('\n' + '='.repeat(60));
  console.log('MIGRATION SUMMARY');
  console.log('='.repeat(60));
  console.log(`Disbursements processed: ${globalStats.disbursementsProcessed}`);
  console.log(`Disbursements skipped: ${globalStats.disbursementsSkipped}`);
  console.log(`Repayments processed: ${globalStats.repaymentsProcessed}`);
  console.log(`Repayments skipped: ${globalStats.repaymentsSkipped}`);

  if (globalStats.errors.length > 0) {
    console.log('\nErrors:');
    globalStats.errors.forEach((error, index) => {
      console.log(`  ${index + 1}. ${error}`);
    });
  }

  console.log('\n' + '='.repeat(60));
  if (dryRun) {
    console.log('This was a DRY RUN. Run with --execute to apply changes.');
  } else {
    console.log('Migration completed.');
  }
  console.log('='.repeat(60));
}

main()
  .catch(error => {
    console.error('Migration failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
