/**
 * Loan Engine Jobs
 *
 * Background jobs for loan processing:
 * - Daily loan engine run
 * - Overdue notifications
 * - Due date reminders
 *
 * These jobs can be triggered manually via API or scheduled via cron
 */

import { prisma } from '../config/database';
import { loanEngineService } from '../services/loan-engine.service';

// Use string literal until after migration - must match Prisma enum values
const LoanStatusValues = {
  ACTIVE: 'ACTIVE' as const,
  DEFAULTED: 'DEFAULTED' as const,
  OVERDUE: 'OVERDUE' as const,
};

// ============================================
// JOB CONFIGURATIONS
// ============================================

interface JobResult {
  jobName: string;
  success: boolean;
  processedCount: number;
  errors: string[];
  startTime: Date;
  endTime: Date;
  duration: number; // in milliseconds
}

// ============================================
// LOAN ENGINE JOB
// ============================================

/**
 * Run the loan engine for all organizations
 * Similar to Django's cron command that runs short_term_calculation
 */
export async function runLoanEngineJob(): Promise<JobResult> {
  const startTime = new Date();
  const errors: string[] = [];
  let processedCount = 0;

  console.log(`[${startTime.toISOString()}] Starting loan engine job...`);

  try {
    // Get all active organizations
    const organizations = await prisma.organization.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    });

    console.log(`Found ${organizations.length} organizations to process`);

    for (const org of organizations) {
      try {
        console.log(`Processing organization: ${org.name} (${org.id})`);

        const result = await loanEngineService.processShortTermLoans(org.id);
        processedCount += result.processedCount;

        if (result.errors.length > 0) {
          for (const error of result.errors) {
            errors.push(`[${org.name}] Loan ${error.loanId}: ${error.error}`);
          }
        }

        console.log(`Processed ${result.processedCount} loans for ${org.name}`);

        // Log individual loan results
        for (const loanResult of result.results) {
          console.log(
            `  - ${loanResult.loanNumber}: ${loanResult.previousStatus} -> ${loanResult.newStatus}` +
              (loanResult.interestAdded ? ` (interest: ${loanResult.interestAdded})` : '') +
              (loanResult.chargesAdded ? ` (charges: ${loanResult.chargesAdded})` : '')
          );
        }
      } catch (error: any) {
        console.error(`Error processing organization ${org.name}:`, error);
        errors.push(`[${org.name}] ${error.message}`);
      }
    }
  } catch (error: any) {
    console.error('Loan engine job failed:', error);
    errors.push(`System error: ${error.message}`);
  }

  const endTime = new Date();
  const duration = endTime.getTime() - startTime.getTime();

  console.log(
    `[${endTime.toISOString()}] Loan engine job completed. ` +
      `Processed: ${processedCount}, Errors: ${errors.length}, Duration: ${duration}ms`
  );

  return {
    jobName: 'loan-engine',
    success: errors.length === 0,
    processedCount,
    errors,
    startTime,
    endTime,
    duration,
  };
}

/**
 * Run the loan engine for a specific organization
 */
export async function runLoanEngineForOrganization(
  organizationId: string
): Promise<JobResult> {
  const startTime = new Date();
  const errors: string[] = [];

  console.log(
    `[${startTime.toISOString()}] Starting loan engine for organization ${organizationId}...`
  );

  try {
    const result = await loanEngineService.processShortTermLoans(organizationId);

    for (const error of result.errors) {
      errors.push(`Loan ${error.loanId}: ${error.error}`);
    }

    const endTime = new Date();
    const duration = endTime.getTime() - startTime.getTime();

    console.log(
      `[${endTime.toISOString()}] Loan engine completed for organization. ` +
        `Processed: ${result.processedCount}, Errors: ${errors.length}, Duration: ${duration}ms`
    );

    return {
      jobName: `loan-engine-${organizationId}`,
      success: errors.length === 0,
      processedCount: result.processedCount,
      errors,
      startTime,
      endTime,
      duration,
    };
  } catch (error: any) {
    const endTime = new Date();
    console.error('Loan engine job failed:', error);

    return {
      jobName: `loan-engine-${organizationId}`,
      success: false,
      processedCount: 0,
      errors: [error.message],
      startTime,
      endTime,
      duration: endTime.getTime() - startTime.getTime(),
    };
  }
}

// ============================================
// OVERDUE NOTIFICATION JOB
// ============================================

/**
 * Send notifications for overdue loans
 */
export async function runOverdueNotificationJob(): Promise<JobResult> {
  const startTime = new Date();
  const errors: string[] = [];
  let processedCount = 0;

  console.log(`[${startTime.toISOString()}] Starting overdue notification job...`);

  try {
    // Get all overdue loans that haven't been notified recently
    const overdueLoans = await prisma.loan.findMany({
      where: {
        status: {
          in: [LoanStatusValues.DEFAULTED, LoanStatusValues.OVERDUE],
        },
        // Add check for last notification if you implement that field
      },
      include: {
        client: {
          select: {
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
          },
        },
        organization: {
          select: { name: true },
        },
        branch: {
          select: { name: true, phone: true },
        },
      },
    });

    console.log(`Found ${overdueLoans.length} overdue loans to notify`);

    for (const loan of overdueLoans) {
      try {
        // Here you would integrate with your notification service
        // For now, just log the notification
        console.log(
          `Notification: ${loan.client.firstName} ${loan.client.lastName} ` +
            `(${loan.client.phone}) - Loan ${loan.loanNumber} is overdue. ` +
            `Balance: ${loan.outstandingBalance}`
        );

        processedCount++;

        // TODO: Integrate with SMS/Email notification service
        // await notificationService.sendOverdueNotification(loan);
      } catch (error: any) {
        errors.push(`Loan ${loan.loanNumber}: ${error.message}`);
      }
    }
  } catch (error: any) {
    console.error('Overdue notification job failed:', error);
    errors.push(`System error: ${error.message}`);
  }

  const endTime = new Date();
  const duration = endTime.getTime() - startTime.getTime();

  console.log(
    `[${endTime.toISOString()}] Overdue notification job completed. ` +
      `Notified: ${processedCount}, Errors: ${errors.length}, Duration: ${duration}ms`
  );

  return {
    jobName: 'overdue-notifications',
    success: errors.length === 0,
    processedCount,
    errors,
    startTime,
    endTime,
    duration,
  };
}

// ============================================
// DUE DATE REMINDER JOB
// ============================================

/**
 * Send reminders for upcoming due dates
 */
export async function runDueDateReminderJob(daysAhead: number = 3): Promise<JobResult> {
  const startTime = new Date();
  const errors: string[] = [];
  let processedCount = 0;

  console.log(
    `[${startTime.toISOString()}] Starting due date reminder job (${daysAhead} days ahead)...`
  );

  try {
    const now = new Date();
    const reminderDate = new Date();
    reminderDate.setDate(reminderDate.getDate() + daysAhead);

    // Get loans with due dates in the reminder window
    const loansWithUpcomingDue = await prisma.loan.findMany({
      where: {
        status: LoanStatusValues.ACTIVE,
        OR: [
          {
            nextDueDate: {
              gte: now,
              lte: reminderDate,
            },
          },
          {
            expectedRepaymentDate: {
              gte: now,
              lte: reminderDate,
            },
          },
        ],
      },
      include: {
        client: {
          select: {
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
          },
        },
        organization: {
          select: { name: true },
        },
      },
    });

    console.log(`Found ${loansWithUpcomingDue.length} loans with upcoming due dates`);

    for (const loan of loansWithUpcomingDue) {
      try {
        const dueDate = loan.nextDueDate || loan.expectedRepaymentDate;

        console.log(
          `Reminder: ${loan.client.firstName} ${loan.client.lastName} ` +
            `(${loan.client.phone}) - Loan ${loan.loanNumber} due on ${dueDate?.toISOString()}. ` +
            `Balance: ${loan.outstandingBalance}`
        );

        processedCount++;

        // TODO: Integrate with SMS/Email notification service
        // await notificationService.sendDueDateReminder(loan);
      } catch (error: any) {
        errors.push(`Loan ${loan.loanNumber}: ${error.message}`);
      }
    }
  } catch (error: any) {
    console.error('Due date reminder job failed:', error);
    errors.push(`System error: ${error.message}`);
  }

  const endTime = new Date();
  const duration = endTime.getTime() - startTime.getTime();

  console.log(
    `[${endTime.toISOString()}] Due date reminder job completed. ` +
      `Reminded: ${processedCount}, Errors: ${errors.length}, Duration: ${duration}ms`
  );

  return {
    jobName: 'due-date-reminders',
    success: errors.length === 0,
    processedCount,
    errors,
    startTime,
    endTime,
    duration,
  };
}

// ============================================
// DAILY SUMMARY JOB
// ============================================

/**
 * Generate and log daily summary statistics
 */
export async function runDailySummaryJob(): Promise<JobResult> {
  const startTime = new Date();
  const errors: string[] = [];
  let processedCount = 0;

  console.log(`[${startTime.toISOString()}] Starting daily summary job...`);

  try {
    const organizations = await prisma.organization.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    });

    for (const org of organizations) {
      try {
        const stats = await loanEngineService.getEngineStatistics(org.id);

        console.log(`\n=== ${org.name} Daily Summary ===`);
        console.log(`Active Loans: ${stats.totalActiveLoans}`);
        console.log(`Default Loans: ${stats.totalDefaultLoans}`);
        console.log(`Overdue Loans: ${stats.totalOverdueLoans}`);
        console.log(`Total Outstanding: ${stats.totalOutstandingBalance}`);
        console.log(`Loans to Process: ${stats.loansToProcess}`);

        processedCount++;
      } catch (error: any) {
        errors.push(`[${org.name}] ${error.message}`);
      }
    }
  } catch (error: any) {
    console.error('Daily summary job failed:', error);
    errors.push(`System error: ${error.message}`);
  }

  const endTime = new Date();
  const duration = endTime.getTime() - startTime.getTime();

  console.log(
    `\n[${endTime.toISOString()}] Daily summary job completed. ` +
      `Organizations: ${processedCount}, Errors: ${errors.length}, Duration: ${duration}ms`
  );

  return {
    jobName: 'daily-summary',
    success: errors.length === 0,
    processedCount,
    errors,
    startTime,
    endTime,
    duration,
  };
}

// ============================================
// ALL-IN-ONE DAILY JOB
// ============================================

/**
 * Run all daily jobs in sequence
 * This is the main entry point for a daily cron job
 */
export async function runDailyJobs(): Promise<{
  results: JobResult[];
  totalDuration: number;
}> {
  const startTime = new Date();
  const results: JobResult[] = [];

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[${startTime.toISOString()}] STARTING DAILY LOAN JOBS`);
  console.log(`${'='.repeat(60)}\n`);

  // 1. Run loan engine
  console.log('\n--- Job 1: Loan Engine ---');
  results.push(await runLoanEngineJob());

  // 2. Send due date reminders
  console.log('\n--- Job 2: Due Date Reminders ---');
  results.push(await runDueDateReminderJob(3));

  // 3. Send overdue notifications
  console.log('\n--- Job 3: Overdue Notifications ---');
  results.push(await runOverdueNotificationJob());

  // 4. Generate daily summary
  console.log('\n--- Job 4: Daily Summary ---');
  results.push(await runDailySummaryJob());

  const endTime = new Date();
  const totalDuration = endTime.getTime() - startTime.getTime();

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[${endTime.toISOString()}] DAILY JOBS COMPLETED`);
  console.log(`Total Duration: ${totalDuration}ms`);
  console.log(
    `Results: ${results.filter((r) => r.success).length}/${results.length} successful`
  );
  console.log(`${'='.repeat(60)}\n`);

  return {
    results,
    totalDuration,
  };
}

// ============================================
// CLI ENTRY POINT
// ============================================

// Allow running jobs directly via command line
// Usage: npx ts-node src/jobs/loan-engine.jobs.ts [job-name]
if (require.main === module) {
  const jobName = process.argv[2] || 'all';

  const runJob = async () => {
    switch (jobName) {
      case 'engine':
        await runLoanEngineJob();
        break;
      case 'reminders':
        await runDueDateReminderJob();
        break;
      case 'overdue':
        await runOverdueNotificationJob();
        break;
      case 'summary':
        await runDailySummaryJob();
        break;
      case 'all':
      default:
        await runDailyJobs();
        break;
    }

    // Disconnect from database
    await prisma.$disconnect();
    process.exit(0);
  };

  runJob().catch((error) => {
    console.error('Job failed:', error);
    process.exit(1);
  });
}
