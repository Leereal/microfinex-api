/**
 * Notification Jobs
 * Scheduled tasks for sending reminders, overdue notices, and processing queue
 */

import { prisma } from '../config/database';
import { notificationService } from '../services/notification.service';

/**
 * Job scheduler interface
 */
export interface ScheduledJob {
  name: string;
  schedule: string; // Cron expression
  description: string;
  run: () => Promise<JobResult>;
}

export interface JobResult {
  success: boolean;
  processed: number;
  details?: Record<string, any>;
  error?: string;
}

/**
 * Process notification queue
 * Should run every minute to send queued notifications
 */
export async function processNotificationQueue(): Promise<JobResult> {
  try {
    const result = await notificationService.processQueue(50);
    
    console.log(`[Job] Queue processed: ${result.processed} notifications, ${result.successful} sent, ${result.failed} failed`);
    
    return {
      success: true,
      processed: result.processed,
      details: result,
    };
  } catch (error: any) {
    console.error('[Job] Queue processing failed:', error);
    return {
      success: false,
      processed: 0,
      error: error.message,
    };
  }
}

/**
 * Send payment reminders
 * Should run daily, typically in the morning
 * Sends reminders for payments due in the next 3 days
 */
export async function sendPaymentReminders(): Promise<JobResult> {
  const now = new Date();
  const threeDaysFromNow = new Date();
  threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

  let processed = 0;
  let successful = 0;
  let failed = 0;

  try {
    // Get all active loans with upcoming payments
    const loans = await prisma.loan.findMany({
      where: {
        status: 'ACTIVE',
      },
      include: {
        client: true,
        repaymentSchedule: {
          where: {
            status: 'PENDING',
            dueDate: {
              gte: now,
              lte: threeDaysFromNow,
            },
          },
          orderBy: { dueDate: 'asc' },
          take: 1,
        },
        product: true,
      },
    });

    for (const loan of loans) {
      if (loan.repaymentSchedule.length === 0) continue;

      const upcomingPayment = loan.repaymentSchedule[0]!;
      const client = loan.client;

      // Check if client has phone number
      if (!client.phone) continue;

      processed++;

      try {
        // Queue SMS reminder
        await notificationService.queueNotification({
          type: 'SMS',
          to: client.phone,
          templateId: 'PAYMENT_REMINDER',
          data: {
            clientName: `${client.firstName} ${client.lastName}`,
            loanNumber: loan.loanNumber,
            currency: loan.currency || 'USD',
            amount: Number(upcomingPayment.totalAmount),
            dueDate: upcomingPayment.dueDate,
            outstandingBalance: Number(loan.outstandingBalance),
          },
          priority: 'HIGH',
        });

        // Queue email if client has email
        if (client.email) {
          await notificationService.queueNotification({
            type: 'EMAIL',
            to: client.email,
            templateId: 'PAYMENT_REMINDER',
            data: {
              clientName: `${client.firstName} ${client.lastName}`,
              loanNumber: loan.loanNumber,
              currency: loan.currency || 'USD',
              amount: Number(upcomingPayment.totalAmount),
              dueDate: upcomingPayment.dueDate,
              outstandingBalance: Number(loan.outstandingBalance),
            },
            priority: 'HIGH',
          });
        }

        successful++;
      } catch (error) {
        failed++;
        console.error(`[Job] Failed to queue reminder for loan ${loan.loanNumber}:`, error);
      }
    }

    console.log(`[Job] Payment reminders: ${processed} processed, ${successful} queued, ${failed} failed`);

    return {
      success: true,
      processed,
      details: { successful, failed, totalLoans: loans.length },
    };
  } catch (error: any) {
    console.error('[Job] Payment reminders failed:', error);
    return {
      success: false,
      processed: 0,
      error: error.message,
    };
  }
}

/**
 * Send overdue notices
 * Should run daily
 * Sends notices for payments that are past due
 */
export async function sendOverdueNotices(): Promise<JobResult> {
  const now = new Date();
  
  let processed = 0;
  let successful = 0;
  let failed = 0;

  try {
    // Get all loans with overdue payments
    const overdueSchedules = await prisma.repaymentSchedule.findMany({
      where: {
        status: 'PENDING',
        dueDate: {
          lt: now,
        },
        loan: {
          status: 'ACTIVE',
        },
      },
      include: {
        loan: {
          include: {
            client: true,
            product: true,
          },
        },
      },
      orderBy: { dueDate: 'asc' },
    });

    // Group by loan to avoid sending multiple notices for the same loan
    const loanMap = new Map<string, typeof overdueSchedules>();
    for (const schedule of overdueSchedules) {
      if (!loanMap.has(schedule.loanId)) {
        loanMap.set(schedule.loanId, []);
      }
      loanMap.get(schedule.loanId)!.push(schedule);
    }

    for (const [loanId, schedules] of loanMap) {
      if (schedules.length === 0) continue;
      const firstSchedule = schedules[0]!;
      const loan = firstSchedule.loan;
      const client = loan.client;

      if (!client.phone) continue;

      // Calculate total overdue
      const totalOverdue = schedules.reduce(
        (sum, s) => sum + Number(s.outstandingAmount),
        0
      );

      // Calculate days overdue from oldest
      const oldestDue = firstSchedule.dueDate;
      const daysOverdue = Math.floor((now.getTime() - oldestDue.getTime()) / (1000 * 60 * 60 * 24));

      // Calculate penalty from loan penalty balance
      const penaltyAmount = Number(loan.penaltyBalance || 0);

      processed++;

      try {
        // Queue SMS overdue notice
        await notificationService.queueNotification({
          type: 'SMS',
          to: client.phone,
          templateId: 'OVERDUE_NOTICE',
          data: {
            clientName: `${client.firstName} ${client.lastName}`,
            loanNumber: loan.loanNumber,
            daysOverdue,
            currency: loan.currency || 'USD',
            overdueAmount: totalOverdue,
            penaltyAmount,
            totalDue: totalOverdue + penaltyAmount,
          },
          priority: daysOverdue > 30 ? 'URGENT' : 'HIGH',
        });

        // Queue email if available
        if (client.email) {
          await notificationService.queueNotification({
            type: 'EMAIL',
            to: client.email,
            templateId: 'OVERDUE_NOTICE',
            data: {
              clientName: `${client.firstName} ${client.lastName}`,
              loanNumber: loan.loanNumber,
              daysOverdue,
              currency: loan.currency || 'USD',
              overdueAmount: totalOverdue,
              penaltyAmount,
              totalDue: totalOverdue + penaltyAmount,
            },
            priority: daysOverdue > 30 ? 'URGENT' : 'HIGH',
          });
        }

        successful++;
      } catch (error) {
        failed++;
        console.error(`[Job] Failed to queue overdue notice for loan ${loan.loanNumber}:`, error);
      }
    }

    console.log(`[Job] Overdue notices: ${processed} processed, ${successful} queued, ${failed} failed`);

    return {
      success: true,
      processed,
      details: { successful, failed, overdueLoans: loanMap.size },
    };
  } catch (error: any) {
    console.error('[Job] Overdue notices failed:', error);
    return {
      success: false,
      processed: 0,
      error: error.message,
    };
  }
}

/**
 * Update loan statuses
 * Should run daily
 * Marks loans as OVERDUE if they have payments past due beyond grace period
 */
export async function updateLoanStatuses(): Promise<JobResult> {
  const now = new Date();
  const gracePeriodDays = parseInt(process.env.LOAN_GRACE_PERIOD_DAYS || '7');
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - gracePeriodDays);

  let processed = 0;

  try {
    // Find active loans with overdue payments beyond grace period
    const loansToMarkOverdue = await prisma.loan.findMany({
      where: {
        status: 'ACTIVE',
        repaymentSchedule: {
          some: {
            status: 'PENDING',
            dueDate: {
              lt: cutoffDate,
            },
          },
        },
      },
    });

    // Update loan status to OVERDUE
    if (loansToMarkOverdue.length > 0) {
      await prisma.loan.updateMany({
        where: {
          id: {
            in: loansToMarkOverdue.map((l) => l.id),
          },
        },
        data: {
          status: 'OVERDUE',
        },
      });
      processed = loansToMarkOverdue.length;
    }

    // Also check for loans that should be reactivated (all payments caught up)
    const loansToReactivate = await prisma.loan.findMany({
      where: {
        status: 'OVERDUE',
        repaymentSchedule: {
          none: {
            status: 'PENDING',
            dueDate: {
              lt: now,
            },
          },
        },
      },
    });

    if (loansToReactivate.length > 0) {
      await prisma.loan.updateMany({
        where: {
          id: {
            in: loansToReactivate.map((l) => l.id),
          },
        },
        data: {
          status: 'ACTIVE',
        },
      });
      processed += loansToReactivate.length;
    }

    console.log(`[Job] Loan status update: ${loansToMarkOverdue.length} marked overdue, ${loansToReactivate.length} reactivated`);

    return {
      success: true,
      processed,
      details: {
        markedOverdue: loansToMarkOverdue.length,
        reactivated: loansToReactivate.length,
      },
    };
  } catch (error: any) {
    console.error('[Job] Loan status update failed:', error);
    return {
      success: false,
      processed: 0,
      error: error.message,
    };
  }
}

/**
 * Calculate and apply penalties
 * Should run daily
 * Applies penalty charges to overdue payments
 */
export async function applyPenalties(): Promise<JobResult> {
  const now = new Date();
  let processed = 0;

  try {
    // Get overdue schedules that haven't had penalty calculated today
    const overdueSchedules = await prisma.repaymentSchedule.findMany({
      where: {
        status: 'PENDING',
        dueDate: {
          lt: now,
        },
        loan: {
          status: { in: ['ACTIVE', 'OVERDUE'] },
        },
      },
      include: {
        loan: {
          include: {
            product: true,
          },
        },
      },
    });

    for (const schedule of overdueSchedules) {
      const loan = schedule.loan;
      const product = loan.product;

      // Calculate days overdue
      const daysOverdue = Math.floor(
        (now.getTime() - schedule.dueDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysOverdue <= 0) continue;

      // Get penalty rate from product or default
      const penaltyRate = Number(product?.penaltyRate) || 0.05; // 5% default
      const penaltyBasis = Number(schedule.outstandingAmount);
      
      if (penaltyBasis <= 0) continue;

      // Calculate penalty (simple daily calculation)
      const dailyPenalty = (penaltyBasis * penaltyRate) / 365;
      const newPenalty = dailyPenalty * daysOverdue;

      // Update loan penalty balance (RepaymentSchedule doesn't have penaltyAmount field)
      await prisma.loan.update({
        where: { id: schedule.loanId },
        data: {
          penaltyBalance: newPenalty,
        },
      });

      processed++;
    }

    console.log(`[Job] Penalties applied to ${processed} schedules`);

    return {
      success: true,
      processed,
    };
  } catch (error: any) {
    console.error('[Job] Penalty application failed:', error);
    return {
      success: false,
      processed: 0,
      error: error.message,
    };
  }
}

/**
 * All scheduled jobs
 */
export const scheduledJobs: ScheduledJob[] = [
  {
    name: 'processNotificationQueue',
    schedule: '* * * * *', // Every minute
    description: 'Process queued notifications',
    run: processNotificationQueue,
  },
  {
    name: 'sendPaymentReminders',
    schedule: '0 8 * * *', // 8 AM daily
    description: 'Send payment reminders for upcoming dues',
    run: sendPaymentReminders,
  },
  {
    name: 'sendOverdueNotices',
    schedule: '0 9 * * *', // 9 AM daily
    description: 'Send overdue payment notices',
    run: sendOverdueNotices,
  },
  {
    name: 'updateLoanStatuses',
    schedule: '0 0 * * *', // Midnight daily
    description: 'Update loan statuses based on payment status',
    run: updateLoanStatuses,
  },
  {
    name: 'applyPenalties',
    schedule: '0 1 * * *', // 1 AM daily
    description: 'Calculate and apply penalty charges',
    run: applyPenalties,
  },
];

/**
 * Run a specific job manually
 */
export async function runJob(jobName: string): Promise<JobResult> {
  const job = scheduledJobs.find((j) => j.name === jobName);
  if (!job) {
    return {
      success: false,
      processed: 0,
      error: `Job not found: ${jobName}`,
    };
  }
  return job.run();
}

/**
 * Get all job definitions
 */
export function getJobDefinitions(): Array<{
  name: string;
  schedule: string;
  description: string;
}> {
  return scheduledJobs.map((job) => ({
    name: job.name,
    schedule: job.schedule,
    description: job.description,
  }));
}
