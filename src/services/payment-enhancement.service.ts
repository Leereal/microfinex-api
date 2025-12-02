/**
 * Payment Enhancement Service
 * Advanced payment features: reversals, branch-aware, calculation strategies
 */

import { z } from 'zod';
import { Prisma, PaymentStatus } from '@prisma/client';
import { prisma } from '../config/database';

// Calculation strategies for payment allocation
export type AllocationStrategy = 
  | 'PENALTY_INTEREST_PRINCIPAL'  // Default: Penalty first, then interest, then principal
  | 'PRINCIPAL_INTEREST_PENALTY'  // Principal first (reduces outstanding faster)
  | 'PRO_RATA'                    // Proportional allocation
  | 'OLDEST_FIRST';               // Pay oldest installments first

export interface PaymentReversalRequest {
  paymentId: string;
  reason: string;
  notes?: string;
  approvedBy?: string;
}

export interface PaymentReversalResult {
  success: boolean;
  reversalId?: string;
  originalPaymentId: string;
  amount: number;
  reason: string;
  reversedAt: Date;
  error?: string;
}

export interface AllocationResult {
  penaltyAmount: number;
  interestAmount: number;
  principalAmount: number;
  remainingAmount: number;
  installmentsAffected: number;
}

export interface BranchPaymentSummary {
  branchId: string;
  branchName: string;
  totalPayments: number;
  totalAmount: number;
  byMethod: Record<string, { count: number; amount: number }>;
  period: { start: Date; end: Date };
}

class PaymentEnhancementService {
  /**
   * Reverse a payment
   */
  async reversePayment(
    request: PaymentReversalRequest,
    organizationId: string,
    reversedBy: string
  ): Promise<PaymentReversalResult> {
    const { paymentId, reason, notes, approvedBy } = request;

    try {
      // Find the original payment
      const payment = await prisma.payment.findFirst({
        where: {
          id: paymentId,
          status: 'COMPLETED',
          loan: {
            organizationId,
          },
        },
        include: {
          loan: true,
        },
      });

      if (!payment) {
        return {
          success: false,
          originalPaymentId: paymentId,
          amount: 0,
          reason,
          reversedAt: new Date(),
          error: 'Payment not found or already reversed',
        };
      }

      // Check if payment can be reversed (within 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      if (payment.paymentDate < thirtyDaysAgo) {
        return {
          success: false,
          originalPaymentId: paymentId,
          amount: Number(payment.amount),
          reason,
          reversedAt: new Date(),
          error: 'Payment is too old to reverse (>30 days)',
        };
      }

      const result = await prisma.$transaction(async (tx) => {
        // Update original payment status to CANCELLED (REVERSED is not a valid PaymentStatus)
        await tx.payment.update({
          where: { id: paymentId },
          data: {
            status: 'CANCELLED',
            notes: `${payment.notes || ''}\n[REVERSED: ${reason}]`.trim(),
          },
        });

        // Restore loan balances
        const principalReversed = Number(payment.principalAmount || 0);
        const interestReversed = Number(payment.interestAmount || 0);
        const penaltyReversed = Number(payment.penaltyAmount || 0);

        await tx.loan.update({
          where: { id: payment.loanId },
          data: {
            principalBalance: {
              increment: principalReversed,
            },
            interestBalance: {
              increment: interestReversed,
            },
            penaltyBalance: {
              increment: penaltyReversed,
            },
            outstandingBalance: {
              increment: principalReversed + interestReversed + penaltyReversed,
            },
          },
        });

        // Revert schedule items that were marked as paid
        await tx.repaymentSchedule.updateMany({
          where: {
            loanId: payment.loanId,
            status: 'COMPLETED',
            paymentDate: payment.paymentDate,
          },
          data: {
            status: 'PENDING',
            paymentDate: null,
            paidAmount: 0,
          },
        });

        // Log reversal to AuditLog
        const auditLog = await tx.auditLog.create({
          data: {
            userId: reversedBy,
            organizationId,
            action: 'PAYMENT_REVERSAL',
            resource: 'payment',
            resourceId: paymentId,
            previousValue: {
              status: 'COMPLETED',
              amount: Number(payment.amount),
              principalAmount: principalReversed,
              interestAmount: interestReversed,
              penaltyAmount: penaltyReversed,
            },
            newValue: {
              status: 'CANCELLED',
            },
            changes: {
              loanId: payment.loanId,
              reason,
              notes,
              approvedBy,
              principalReversed,
              interestReversed,
              penaltyReversed,
            },
            status: 'SUCCESS',
            timestamp: new Date(),
          },
        });

        return auditLog;
      });

      return {
        success: true,
        reversalId: result.id,
        originalPaymentId: paymentId,
        amount: Number(payment.amount),
        reason,
        reversedAt: new Date(),
      };
    } catch (error: any) {
      console.error('Payment reversal error:', error);
      return {
        success: false,
        originalPaymentId: paymentId,
        amount: 0,
        reason,
        reversedAt: new Date(),
        error: error.message,
      };
    }
  }

  /**
   * Allocate payment with different strategies
   */
  allocatePaymentWithStrategy(
    amount: number,
    penaltyBalance: number,
    interestBalance: number,
    principalBalance: number,
    strategy: AllocationStrategy = 'PENALTY_INTEREST_PRINCIPAL'
  ): AllocationResult {
    let remaining = amount;
    let penaltyAmount = 0;
    let interestAmount = 0;
    let principalAmount = 0;

    switch (strategy) {
      case 'PENALTY_INTEREST_PRINCIPAL':
        // Default: Penalty → Interest → Principal
        penaltyAmount = Math.min(remaining, penaltyBalance);
        remaining -= penaltyAmount;
        
        interestAmount = Math.min(remaining, interestBalance);
        remaining -= interestAmount;
        
        principalAmount = Math.min(remaining, principalBalance);
        remaining -= principalAmount;
        break;

      case 'PRINCIPAL_INTEREST_PENALTY':
        // Principal first (faster balance reduction)
        principalAmount = Math.min(remaining, principalBalance);
        remaining -= principalAmount;
        
        interestAmount = Math.min(remaining, interestBalance);
        remaining -= interestAmount;
        
        penaltyAmount = Math.min(remaining, penaltyBalance);
        remaining -= penaltyAmount;
        break;

      case 'PRO_RATA':
        // Proportional allocation
        const total = penaltyBalance + interestBalance + principalBalance;
        if (total > 0) {
          penaltyAmount = Math.min((amount * penaltyBalance) / total, penaltyBalance);
          interestAmount = Math.min((amount * interestBalance) / total, interestBalance);
          principalAmount = Math.min((amount * principalBalance) / total, principalBalance);
          remaining = amount - (penaltyAmount + interestAmount + principalAmount);
        }
        break;

      case 'OLDEST_FIRST':
        // Same as default for now - would need schedule data
        penaltyAmount = Math.min(remaining, penaltyBalance);
        remaining -= penaltyAmount;
        
        interestAmount = Math.min(remaining, interestBalance);
        remaining -= interestAmount;
        
        principalAmount = Math.min(remaining, principalBalance);
        remaining -= principalAmount;
        break;
    }

    return {
      penaltyAmount: Math.round(penaltyAmount * 100) / 100,
      interestAmount: Math.round(interestAmount * 100) / 100,
      principalAmount: Math.round(principalAmount * 100) / 100,
      remainingAmount: Math.round(remaining * 100) / 100,
      installmentsAffected: 0, // Would be calculated based on schedule
    };
  }

  /**
   * Get branch payment summary
   */
  async getBranchPaymentSummary(
    branchId: string,
    organizationId: string,
    startDate: Date,
    endDate: Date
  ): Promise<BranchPaymentSummary | null> {
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, organizationId },
    });

    if (!branch) return null;

    const payments = await prisma.payment.findMany({
      where: {
        status: 'COMPLETED',
        paymentDate: { gte: startDate, lte: endDate },
        loan: { 
          branchId,
          organizationId,
        },
      },
    });

    const byMethod: Record<string, { count: number; amount: number }> = {};

    for (const payment of payments) {
      const method = payment.method || 'OTHER';
      if (!byMethod[method]) {
        byMethod[method] = { count: 0, amount: 0 };
      }
      byMethod[method].count++;
      byMethod[method].amount += Number(payment.amount);
    }

    return {
      branchId,
      branchName: branch.name,
      totalPayments: payments.length,
      totalAmount: payments.reduce((sum, p) => sum + Number(p.amount), 0),
      byMethod,
      period: { start: startDate, end: endDate },
    };
  }

  /**
   * Get all branch payment summaries
   */
  async getAllBranchPaymentSummaries(
    organizationId: string,
    startDate: Date,
    endDate: Date
  ): Promise<BranchPaymentSummary[]> {
    const branches = await prisma.branch.findMany({
      where: { organizationId, isActive: true },
    });

    const summaries: BranchPaymentSummary[] = [];

    for (const branch of branches) {
      const summary = await this.getBranchPaymentSummary(
        branch.id,
        organizationId,
        startDate,
        endDate
      );
      if (summary) {
        summaries.push(summary);
      }
    }

    return summaries.sort((a, b) => b.totalAmount - a.totalAmount);
  }

  /**
   * Calculate early payoff amount
   */
  async calculateEarlyPayoff(
    loanId: string,
    organizationId: string,
    payoffDate: Date = new Date()
  ): Promise<{
    principalBalance: number;
    interestBalance: number;
    penaltyBalance: number;
    interestRebate: number;
    totalPayoff: number;
  } | null> {
    const loan = await prisma.loan.findFirst({
      where: {
        id: loanId,
        organizationId,
        status: { in: ['ACTIVE', 'OVERDUE'] },
      },
      include: {
        repaymentSchedule: {
          where: { status: 'PENDING' },
          orderBy: { dueDate: 'asc' },
        },
        product: true,
      },
    });

    if (!loan) return null;

    const principalBalance = Number(loan.principalBalance);
    const interestBalance = Number(loan.interestBalance);
    const penaltyBalance = Number(loan.penaltyBalance);

    // Calculate interest rebate for future installments
    let interestRebate = 0;
    const today = payoffDate;

    for (const schedule of loan.repaymentSchedule) {
      if (schedule.dueDate > today) {
        // Future installment - rebate some interest
        const interestDue = Number(schedule.interestAmount) - Number(schedule.paidAmount);
        // Rebate calculation (simplified - typically pro-rated)
        const daysUntilDue = Math.floor(
          (schedule.dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
        );
        const rebatePercent = Math.min(daysUntilDue / 30 * 0.5, 0.5); // Up to 50% rebate
        interestRebate += interestDue * rebatePercent;
      }
    }

    const totalPayoff = principalBalance + interestBalance + penaltyBalance - interestRebate;

    return {
      principalBalance,
      interestBalance,
      penaltyBalance,
      interestRebate: Math.round(interestRebate * 100) / 100,
      totalPayoff: Math.round(totalPayoff * 100) / 100,
    };
  }

  /**
   * Process bulk payments for an employer (payroll deduction)
   */
  async processPayrollPayments(
    employerId: string,
    organizationId: string,
    payments: Array<{
      clientId: string;
      loanId: string;
      amount: number;
      reference?: string;
    }>,
    processedBy: string
  ): Promise<{
    processed: number;
    failed: number;
    totalAmount: number;
    results: Array<{ clientId: string; loanId: string; success: boolean; error?: string }>;
  }> {
    let processed = 0;
    let failed = 0;
    let totalAmount = 0;
    const results: Array<{ clientId: string; loanId: string; success: boolean; error?: string }> = [];

    for (const payment of payments) {
      try {
        // Verify loan belongs to client and is active
        const loan = await prisma.loan.findFirst({
          where: {
            id: payment.loanId,
            clientId: payment.clientId,
            organizationId,
            status: { in: ['ACTIVE', 'OVERDUE'] },
          },
          include: {
            client: {
              include: {
                employers: {
                  where: { isActive: true },
                },
              },
            },
          },
        });

        if (!loan) {
          failed++;
          results.push({
            clientId: payment.clientId,
            loanId: payment.loanId,
            success: false,
            error: 'Loan not found or not active',
          });
          continue;
        }

        // Verify client is employed by the employer
        const isEmployed = loan.client.employers.some(e => e.employerId === employerId);
        if (!isEmployed) {
          failed++;
          results.push({
            clientId: payment.clientId,
            loanId: payment.loanId,
            success: false,
            error: 'Client not employed by this employer',
          });
          continue;
        }

        // Create payment (simplified - would use full payment service)
        const paymentNumber = `PRL${Date.now()}${Math.random().toString(36).substr(2, 4)}`;
        
        await prisma.payment.create({
          data: {
            loanId: payment.loanId,
            paymentNumber,
            amount: payment.amount,
            method: 'PAYROLL_DEDUCTION',
            transactionRef: payment.reference || `EMP-${employerId}`,
            paymentDate: new Date(),
            receivedBy: processedBy,
            status: 'COMPLETED',
            notes: `Payroll deduction from employer ${employerId}`,
            createdAt: new Date(),
          },
        });

        // Update loan balances (simplified)
        await prisma.loan.update({
          where: { id: payment.loanId },
          data: {
            outstandingBalance: { decrement: payment.amount },
          },
        });

        processed++;
        totalAmount += payment.amount;
        results.push({
          clientId: payment.clientId,
          loanId: payment.loanId,
          success: true,
        });
      } catch (error: any) {
        failed++;
        results.push({
          clientId: payment.clientId,
          loanId: payment.loanId,
          success: false,
          error: error.message,
        });
      }
    }

    return { processed, failed, totalAmount, results };
  }
}

export const paymentEnhancementService = new PaymentEnhancementService();
