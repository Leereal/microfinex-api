import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

const prisma = new PrismaClient();

export interface PaymentRecord {
  id: string;
  paymentNumber: string;
  loanId: string;
  amount: number;
  principalAmount: number;
  interestAmount: number;
  penaltyAmount: number;
  type: string;
  method: string;
  status: string;
  transactionRef?: string;
  paymentDate: Date;
  receivedBy: string;
  notes?: string;
}

export interface PaymentAllocation {
  penaltyAmount: number;
  interestAmount: number;
  principalAmount: number;
  remainingAmount: number;
}

export interface PaymentScheduleItem {
  id: string;
  installmentNumber: number;
  dueDate: Date;
  principalAmount: number;
  interestAmount: number;
  totalAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  status: string;
  paymentDate?: Date;
  daysOverdue?: number;
}

// Validation schemas
export const createPaymentSchema = z.object({
  loanId: z.string().uuid('Invalid loan ID'),
  amount: z.number().positive('Amount must be positive'),
  paymentMethod: z.enum([
    'CASH',
    'BANK_TRANSFER',
    'MOBILE_MONEY',
    'CHECK',
    'CARD',
  ]),
  transactionRef: z.string().optional(),
  notes: z.string().optional(),
});

export const bulkPaymentSchema = z.object({
  payments: z.array(
    z.object({
      loanId: z.string().uuid(),
      amount: z.number().positive(),
      paymentMethod: z.enum([
        'CASH',
        'BANK_TRANSFER',
        'MOBILE_MONEY',
        'CHECK',
        'CARD',
      ]),
      transactionRef: z.string().optional(),
      notes: z.string().optional(),
    })
  ),
});

export const reversePaymentSchema = z.object({
  reason: z.string().min(1, 'Reversal reason is required'),
  notes: z.string().optional(),
});

class PaymentService {
  /**
   * Generate unique payment number
   */
  private async generatePaymentNumber(organizationId: string): Promise<string> {
    const today = new Date();
    const year = today.getFullYear().toString().slice(-2);
    const month = (today.getMonth() + 1).toString().padStart(2, '0');
    const day = today.getDate().toString().padStart(2, '0');

    // Get count of payments today
    const startOfDay = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    );
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    const count = await prisma.payment.count({
      where: {
        loan: {
          organizationId,
        },
        createdAt: {
          gte: startOfDay,
          lt: endOfDay,
        },
      },
    });

    const sequence = (count + 1).toString().padStart(4, '0');
    return `PAY${year}${month}${day}${sequence}`;
  }

  /**
   * Process loan payment
   */
  async processPayment(
    paymentData: z.infer<typeof createPaymentSchema>,
    organizationId: string,
    receivedBy: string
  ): Promise<PaymentRecord> {
    // Get loan details with current balances
    const loan = await prisma.loan.findFirst({
      where: {
        id: paymentData.loanId,
        organizationId,
        status: { in: ['ACTIVE', 'OVERDUE'] },
      },
      include: {
        repaymentSchedule: {
          where: {
            status: 'PENDING',
          },
          orderBy: {
            dueDate: 'asc',
          },
        },
      },
    });

    if (!loan) {
      throw new Error('Loan not found or not in active status');
    }

    // Allocate payment amount
    const allocation = this.allocatePayment(
      paymentData.amount,
      parseFloat(loan.penaltyBalance.toString()),
      parseFloat(loan.interestBalance.toString()),
      parseFloat(loan.principalBalance.toString())
    );

    const paymentNumber = await this.generatePaymentNumber(organizationId);

    // Create payment record
    const payment = await prisma.payment.create({
      data: {
        paymentNumber,
        loanId: paymentData.loanId,
        amount: paymentData.amount,
        principalAmount: allocation.principalAmount,
        interestAmount: allocation.interestAmount,
        penaltyAmount: allocation.penaltyAmount,
        type: 'LOAN_REPAYMENT',
        method: paymentData.paymentMethod,
        status: 'COMPLETED',
        transactionRef: paymentData.transactionRef,
        paymentDate: new Date(),
        receivedBy,
        notes: paymentData.notes,
      },
    });

    // Update loan balances
    const newPenaltyBalance = Math.max(
      0,
      parseFloat(loan.penaltyBalance.toString()) - allocation.penaltyAmount
    );
    const newInterestBalance = Math.max(
      0,
      parseFloat(loan.interestBalance.toString()) - allocation.interestAmount
    );
    const newPrincipalBalance = Math.max(
      0,
      parseFloat(loan.principalBalance.toString()) - allocation.principalAmount
    );
    const newOutstandingBalance =
      newPenaltyBalance + newInterestBalance + newPrincipalBalance;

    await prisma.loan.update({
      where: { id: paymentData.loanId },
      data: {
        penaltyBalance: newPenaltyBalance,
        interestBalance: newInterestBalance,
        principalBalance: newPrincipalBalance,
        outstandingBalance: newOutstandingBalance,
        lastPaymentDate: new Date(),
        status: newOutstandingBalance === 0 ? 'COMPLETED' : loan.status,
      },
    });

    // Update repayment schedule
    await this.updateRepaymentSchedule(paymentData.loanId, paymentData.amount);

    return this.mapPaymentToRecord(payment as any);
  }

  /**
   * Allocate payment amount to penalty, interest, and principal
   */
  private allocatePayment(
    paymentAmount: number,
    penaltyBalance: number,
    interestBalance: number,
    principalBalance: number
  ): PaymentAllocation {
    let remainingAmount = paymentAmount;
    let penaltyAmount = 0;
    let interestAmount = 0;
    let principalAmount = 0;

    // First, pay penalties
    if (remainingAmount > 0 && penaltyBalance > 0) {
      penaltyAmount = Math.min(remainingAmount, penaltyBalance);
      remainingAmount -= penaltyAmount;
    }

    // Then, pay interest
    if (remainingAmount > 0 && interestBalance > 0) {
      interestAmount = Math.min(remainingAmount, interestBalance);
      remainingAmount -= interestAmount;
    }

    // Finally, pay principal
    if (remainingAmount > 0 && principalBalance > 0) {
      principalAmount = Math.min(remainingAmount, principalBalance);
      remainingAmount -= principalAmount;
    }

    return {
      penaltyAmount,
      interestAmount,
      principalAmount,
      remainingAmount,
    };
  }

  /**
   * Update repayment schedule based on payment
   */
  private async updateRepaymentSchedule(
    loanId: string,
    paymentAmount: number
  ): Promise<void> {
    const scheduleItems = await prisma.repaymentSchedule.findMany({
      where: {
        loanId,
        outstandingAmount: {
          gt: 0,
        },
      },
      orderBy: {
        dueDate: 'asc',
      },
    });

    let remainingAmount = paymentAmount;

    for (const item of scheduleItems) {
      if (remainingAmount <= 0) break;

      const outstandingAmount = parseFloat(item.outstandingAmount.toString());
      const paymentForThisItem = Math.min(remainingAmount, outstandingAmount);
      const newPaidAmount =
        parseFloat(item.paidAmount.toString()) + paymentForThisItem;
      const newOutstandingAmount = outstandingAmount - paymentForThisItem;

      await prisma.repaymentSchedule.update({
        where: { id: item.id },
        data: {
          paidAmount: newPaidAmount,
          outstandingAmount: newOutstandingAmount,
          status: newOutstandingAmount === 0 ? 'COMPLETED' : 'PENDING',
          paymentDate:
            newOutstandingAmount === 0 ? new Date() : item.paymentDate,
        },
      });

      remainingAmount -= paymentForThisItem;
    }
  }

  /**
   * Get payment history for a loan
   */
  async getPaymentHistory(
    loanId: string,
    organizationId: string,
    page: number = 1,
    limit: number = 10
  ): Promise<{
    payments: PaymentRecord[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const skip = (page - 1) * limit;

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where: {
          loanId,
          loan: {
            organizationId,
          },
        },
        skip,
        take: limit,
        include: {
          receiver: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
        orderBy: {
          paymentDate: 'desc',
        },
      }),
      prisma.payment.count({
        where: {
          loanId,
          loan: {
            organizationId,
          },
        },
      }),
    ]);

    return {
      payments: payments.map(payment => this.mapPaymentToRecord(payment)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get repayment schedule for a loan
   */
  async getRepaymentSchedule(
    loanId: string,
    organizationId: string
  ): Promise<PaymentScheduleItem[]> {
    const schedule = await prisma.repaymentSchedule.findMany({
      where: {
        loanId,
        loan: {
          organizationId,
        },
      },
      orderBy: {
        installmentNumber: 'asc',
      },
    });

    return schedule.map(item => ({
      id: item.id,
      installmentNumber: item.installmentNumber,
      dueDate: item.dueDate,
      principalAmount: parseFloat(item.principalAmount.toString()),
      interestAmount: parseFloat(item.interestAmount.toString()),
      totalAmount: parseFloat(item.totalAmount.toString()),
      paidAmount: parseFloat(item.paidAmount.toString()),
      outstandingAmount: parseFloat(item.outstandingAmount.toString()),
      status: item.status,
      paymentDate: item.paymentDate || undefined,
      daysOverdue:
        item.status === 'PENDING' && item.dueDate < new Date()
          ? Math.floor(
              (new Date().getTime() - item.dueDate.getTime()) /
                (1000 * 60 * 60 * 24)
            )
          : undefined,
    }));
  }

  /**
   * Calculate overdue amounts and penalties
   */
  async calculateOverdueAmounts(
    loanId: string,
    organizationId: string
  ): Promise<{
    overdueAmount: number;
    penaltyAmount: number;
    daysPastDue: number;
    overdueInstallments: number;
  }> {
    const loan = await prisma.loan.findFirst({
      where: {
        id: loanId,
        organizationId,
      },
      include: {
        product: true,
        repaymentSchedule: {
          where: {
            dueDate: {
              lt: new Date(),
            },
            outstandingAmount: {
              gt: 0,
            },
          },
        },
      },
    });

    if (!loan) {
      throw new Error('Loan not found');
    }

    const today = new Date();
    let totalOverdueAmount = 0;
    let daysPastDue = 0;
    let oldestOverdueDate: Date | null = null;

    for (const item of loan.repaymentSchedule!) {
      const overdueAmount = parseFloat(item.outstandingAmount.toString());
      totalOverdueAmount += overdueAmount;

      if (!oldestOverdueDate || item.dueDate < oldestOverdueDate) {
        oldestOverdueDate = item.dueDate;
      }
    }

    if (oldestOverdueDate) {
      daysPastDue = Math.floor(
        (today.getTime() - oldestOverdueDate.getTime()) / (1000 * 60 * 60 * 24)
      );
    }

    // Calculate penalty amount
    const penaltyRate = parseFloat(loan.product!.penaltyRate.toString());
    let penaltyAmount = 0;

    if (daysPastDue > 0 && penaltyRate > 0) {
      // Simple penalty calculation: overdue amount * penalty rate * days overdue / 365
      penaltyAmount =
        (totalOverdueAmount * (penaltyRate / 100) * daysPastDue) / 365;
    }

    return {
      overdueAmount: totalOverdueAmount,
      penaltyAmount,
      daysPastDue,
      overdueInstallments: loan.repaymentSchedule!.length,
    };
  }

  /**
   * Process bulk payments
   */
  async processBulkPayments(
    paymentsData: z.infer<typeof bulkPaymentSchema>,
    organizationId: string,
    receivedBy: string
  ): Promise<{
    successful: PaymentRecord[];
    failed: Array<{ loanId: string; error: string }>;
  }> {
    const successful: PaymentRecord[] = [];
    const failed: Array<{ loanId: string; error: string }> = [];

    for (const paymentData of paymentsData.payments) {
      try {
        const payment = await this.processPayment(
          paymentData,
          organizationId,
          receivedBy
        );
        successful.push(payment);
      } catch (error) {
        failed.push({
          loanId: paymentData.loanId,
          error: (error as Error).message,
        });
      }
    }

    return { successful, failed };
  }

  /**
   * Reverse a payment
   */
  async reversePayment(
    paymentId: string,
    reversalData: z.infer<typeof reversePaymentSchema>,
    organizationId: string,
    reversedBy: string
  ): Promise<PaymentRecord> {
    const payment = await prisma.payment.findFirst({
      where: {
        id: paymentId,
        loan: {
          organizationId,
        },
        status: 'COMPLETED',
      },
      include: {
        loan: true,
      },
    });

    if (!payment) {
      throw new Error('Payment not found or cannot be reversed');
    }

    // Update payment status
    const reversedPayment = await prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: 'CANCELLED',
        notes: `${payment.notes || ''}\n\nREVERSED: ${reversalData.reason}${reversalData.notes ? ' - ' + reversalData.notes : ''}`,
      },
    });

    // Restore loan balances
    const loan = payment.loan;
    await prisma.loan.update({
      where: { id: loan.id },
      data: {
        penaltyBalance:
          parseFloat(loan.penaltyBalance.toString()) +
          parseFloat(payment.penaltyAmount.toString()),
        interestBalance:
          parseFloat(loan.interestBalance.toString()) +
          parseFloat(payment.interestAmount.toString()),
        principalBalance:
          parseFloat(loan.principalBalance.toString()) +
          parseFloat(payment.principalAmount.toString()),
        outstandingBalance:
          parseFloat(loan.outstandingBalance.toString()) +
          parseFloat(payment.amount.toString()),
        status: 'ACTIVE', // Revert to active if it was marked as completed
      },
    });

    // TODO: Update repayment schedule to reverse payment allocation

    return this.mapPaymentToRecord(reversedPayment as any);
  }

  /**
   * Get payment statistics
   */
  async getPaymentStatistics(
    organizationId: string,
    branchId?: string,
    dateFrom?: Date,
    dateTo?: Date
  ): Promise<{
    totalPayments: number;
    totalAmount: number;
    averagePayment: number;
    completedPayments: number;
    cancelledPayments: number;
    paymentsByMethod: Array<{ method: string; count: number; amount: number }>;
  }> {
    const where: any = {
      loan: { organizationId },
    };

    if (branchId) {
      where.loan.branchId = branchId;
    }

    if (dateFrom || dateTo) {
      where.paymentDate = {};
      if (dateFrom) where.paymentDate.gte = dateFrom;
      if (dateTo) where.paymentDate.lte = dateTo;
    }

    const [
      totalPayments,
      completedPayments,
      cancelledPayments,
      aggregates,
      paymentsByMethod,
    ] = await Promise.all([
      prisma.payment.count({ where }),
      prisma.payment.count({ where: { ...where, status: 'COMPLETED' } }),
      prisma.payment.count({ where: { ...where, status: 'CANCELLED' } }),
      prisma.payment.aggregate({
        where,
        _sum: { amount: true },
        _avg: { amount: true },
      }),
      prisma.payment.groupBy({
        by: ['method'],
        where,
        _count: true,
        _sum: { amount: true },
      }),
    ]);

    return {
      totalPayments,
      totalAmount: parseFloat(aggregates._sum.amount?.toString() || '0'),
      averagePayment: parseFloat(aggregates._avg.amount?.toString() || '0'),
      completedPayments,
      cancelledPayments,
      paymentsByMethod: paymentsByMethod.map(item => ({
        method: item.method,
        count: item._count,
        amount: parseFloat(item._sum.amount?.toString() || '0'),
      })),
    };
  }

  /**
   * Map Prisma payment to PaymentRecord
   */
  private mapPaymentToRecord(payment: any): PaymentRecord {
    return {
      id: payment.id,
      paymentNumber: payment.paymentNumber,
      loanId: payment.loanId,
      amount: parseFloat(payment.amount.toString()),
      principalAmount: parseFloat(payment.principalAmount.toString()),
      interestAmount: parseFloat(payment.interestAmount.toString()),
      penaltyAmount: parseFloat(payment.penaltyAmount.toString()),
      type: payment.type,
      method: payment.method,
      status: payment.status,
      transactionRef: payment.transactionRef,
      paymentDate: payment.paymentDate,
      receivedBy: payment.receivedBy,
      notes: payment.notes,
    };
  }
}

export const paymentService = new PaymentService();
