/**
 * Loan Adjustment Service
 * Handles manual adjustments, writeoffs, and rescheduling
 * Uses AuditLog for tracking since dedicated adjustment tables don't exist
 */

import { Prisma, LoanStatus } from '@prisma/client';
import { prisma } from '../config/database';

export type AdjustmentType = 
  | 'PRINCIPAL_INCREASE'
  | 'PRINCIPAL_DECREASE'
  | 'INTEREST_INCREASE'
  | 'INTEREST_DECREASE'
  | 'PENALTY_WAIVER'
  | 'INTEREST_WAIVER'
  | 'FEE_ADDITION'
  | 'FEE_WAIVER';

export interface AdjustmentRequest {
  loanId: string;
  type: AdjustmentType;
  amount: number;
  reason: string;
  notes?: string;
  effectiveDate?: Date;
}

export interface AdjustmentResult {
  success: boolean;
  adjustmentId?: string;
  loanId: string;
  type: AdjustmentType;
  amount: number;
  previousBalance: number;
  newBalance: number;
  error?: string;
}

export interface WriteoffRequest {
  loanId: string;
  reason: string;
  writeoffType: 'FULL' | 'PARTIAL';
  amount?: number; // For partial writeoff
  notes?: string;
  recoveryExpected: boolean;
  recoveryAmount?: number;
}

export interface WriteoffResult {
  success: boolean;
  writeoffId?: string;
  loanId: string;
  amountWrittenOff: number;
  previousBalance: number;
  newBalance: number;
  error?: string;
}

export interface RescheduleRequest {
  loanId: string;
  newTerm: number; // New term in months
  newInterestRate?: number;
  reason: string;
  newStartDate?: Date;
  graceperiodMonths?: number;
  notes?: string;
}

export interface RescheduleResult {
  success: boolean;
  rescheduleId?: string;
  loanId: string;
  oldTerm: number;
  newTerm: number;
  oldRate: number;
  newRate: number;
  newMonthlyPayment: number;
  error?: string;
}

class LoanAdjustmentService {
  /**
   * Create a manual adjustment
   */
  async createAdjustment(
    request: AdjustmentRequest,
    organizationId: string,
    adjustedBy: string
  ): Promise<AdjustmentResult> {
    const { loanId, type, amount, reason, notes, effectiveDate } = request;

    try {
      const loan = await prisma.loan.findFirst({
        where: {
          id: loanId,
          organizationId,
        },
      });

      if (!loan) {
        return {
          success: false,
          loanId,
          type,
          amount,
          previousBalance: 0,
          newBalance: 0,
          error: 'Loan not found',
        };
      }

      const previousBalance = Number(loan.outstandingBalance);
      let balanceChange = 0;
      let principalChange = 0;
      let interestChange = 0;
      let penaltyChange = 0;

      // Calculate balance changes based on adjustment type
      switch (type) {
        case 'PRINCIPAL_INCREASE':
          principalChange = amount;
          balanceChange = amount;
          break;
        case 'PRINCIPAL_DECREASE':
          principalChange = -amount;
          balanceChange = -amount;
          break;
        case 'INTEREST_INCREASE':
          interestChange = amount;
          balanceChange = amount;
          break;
        case 'INTEREST_DECREASE':
        case 'INTEREST_WAIVER':
          interestChange = -Math.min(amount, Number(loan.interestBalance));
          balanceChange = interestChange;
          break;
        case 'PENALTY_WAIVER':
          penaltyChange = -Math.min(amount, Number(loan.penaltyBalance));
          balanceChange = penaltyChange;
          break;
        case 'FEE_ADDITION':
          penaltyChange = amount;
          balanceChange = amount;
          break;
        case 'FEE_WAIVER':
          penaltyChange = -amount;
          balanceChange = -amount;
          break;
      }

      const newBalance = previousBalance + balanceChange;

      const result = await prisma.$transaction(async (tx) => {
        // Update loan balances
        await tx.loan.update({
          where: { id: loanId },
          data: {
            principalBalance: {
              increment: principalChange,
            },
            interestBalance: {
              increment: interestChange,
            },
            penaltyBalance: {
              increment: penaltyChange,
            },
            outstandingBalance: {
              increment: balanceChange,
            },
            updatedAt: new Date(),
          },
        });

        // Log adjustment to AuditLog
        const auditLog = await tx.auditLog.create({
          data: {
            userId: adjustedBy,
            organizationId,
            action: 'LOAN_ADJUSTMENT',
            resource: 'loan',
            resourceId: loanId,
            previousValue: {
              principalBalance: Number(loan.principalBalance),
              interestBalance: Number(loan.interestBalance),
              penaltyBalance: Number(loan.penaltyBalance),
              outstandingBalance: previousBalance,
            },
            newValue: {
              principalBalance: Number(loan.principalBalance) + principalChange,
              interestBalance: Number(loan.interestBalance) + interestChange,
              penaltyBalance: Number(loan.penaltyBalance) + penaltyChange,
              outstandingBalance: newBalance,
            },
            changes: {
              type,
              amount,
              principalChange,
              interestChange,
              penaltyChange,
              reason,
              notes,
              effectiveDate: effectiveDate || new Date(),
            },
            status: 'SUCCESS',
            timestamp: new Date(),
          },
        });

        return auditLog;
      });

      return {
        success: true,
        adjustmentId: result.id,
        loanId,
        type,
        amount,
        previousBalance,
        newBalance,
      };
    } catch (error: any) {
      console.error('Adjustment error:', error);
      return {
        success: false,
        loanId,
        type,
        amount,
        previousBalance: 0,
        newBalance: 0,
        error: error.message,
      };
    }
  }

  /**
   * Write off a loan (full or partial)
   */
  async writeoffLoan(
    request: WriteoffRequest,
    organizationId: string,
    approvedBy: string
  ): Promise<WriteoffResult> {
    const { loanId, reason, writeoffType, amount, notes, recoveryExpected, recoveryAmount } = request;

    try {
      const loan = await prisma.loan.findFirst({
        where: {
          id: loanId,
          organizationId,
          status: { in: ['ACTIVE', 'OVERDUE'] },
        },
      });

      if (!loan) {
        return {
          success: false,
          loanId,
          amountWrittenOff: 0,
          previousBalance: 0,
          newBalance: 0,
          error: 'Loan not found or not in eligible status',
        };
      }

      const previousBalance = Number(loan.outstandingBalance);
      let writeoffAmount: number;
      let newBalance: number;
      let newStatus: LoanStatus;

      if (writeoffType === 'FULL') {
        writeoffAmount = previousBalance;
        newBalance = 0;
        newStatus = 'WRITTEN_OFF';
      } else {
        writeoffAmount = Math.min(amount || 0, previousBalance);
        newBalance = previousBalance - writeoffAmount;
        newStatus = newBalance === 0 ? 'WRITTEN_OFF' : loan.status;
      }

      const result = await prisma.$transaction(async (tx) => {
        // Update loan
        await tx.loan.update({
          where: { id: loanId },
          data: {
            status: newStatus,
            outstandingBalance: newBalance,
            principalBalance: writeoffType === 'FULL' ? 0 : loan.principalBalance,
            interestBalance: writeoffType === 'FULL' ? 0 : loan.interestBalance,
            penaltyBalance: 0, // Always clear penalties on writeoff
            updatedAt: new Date(),
          },
        });

        // Mark remaining schedules as cancelled (WRITTEN_OFF is not a valid PaymentStatus)
        if (writeoffType === 'FULL') {
          await tx.repaymentSchedule.updateMany({
            where: {
              loanId,
              status: 'PENDING',
            },
            data: {
              status: 'CANCELLED',
            },
          });
        }

        // Log writeoff to AuditLog
        const auditLog = await tx.auditLog.create({
          data: {
            userId: approvedBy,
            organizationId,
            action: 'LOAN_WRITEOFF',
            resource: 'loan',
            resourceId: loanId,
            previousValue: {
              status: loan.status,
              principalBalance: Number(loan.principalBalance),
              interestBalance: Number(loan.interestBalance),
              penaltyBalance: Number(loan.penaltyBalance),
              outstandingBalance: previousBalance,
            },
            newValue: {
              status: newStatus,
              outstandingBalance: newBalance,
            },
            changes: {
              writeoffType,
              amountWrittenOff: writeoffAmount,
              principalWrittenOff: Math.min(writeoffAmount, Number(loan.principalBalance)),
              interestWrittenOff: Math.min(
                writeoffAmount - Number(loan.principalBalance),
                Number(loan.interestBalance)
              ),
              penaltyWrittenOff: Number(loan.penaltyBalance),
              reason,
              notes,
              recoveryExpected,
              expectedRecoveryAmount: recoveryAmount || 0,
            },
            status: 'SUCCESS',
            timestamp: new Date(),
          },
        });

        return auditLog;
      });

      return {
        success: true,
        writeoffId: result.id,
        loanId,
        amountWrittenOff: writeoffAmount,
        previousBalance,
        newBalance,
      };
    } catch (error: any) {
      console.error('Writeoff error:', error);
      return {
        success: false,
        loanId,
        amountWrittenOff: 0,
        previousBalance: 0,
        newBalance: 0,
        error: error.message,
      };
    }
  }

  /**
   * Reschedule a loan
   */
  async rescheduleLoan(
    request: RescheduleRequest,
    organizationId: string,
    rescheduledBy: string
  ): Promise<RescheduleResult> {
    const { loanId, newTerm, newInterestRate, reason, newStartDate, graceperiodMonths, notes } = request;

    try {
      const loan = await prisma.loan.findFirst({
        where: {
          id: loanId,
          organizationId,
          status: { in: ['ACTIVE', 'OVERDUE'] },
        },
        include: {
          product: true,
        },
      });

      if (!loan) {
        return {
          success: false,
          loanId,
          oldTerm: 0,
          newTerm,
          oldRate: 0,
          newRate: newInterestRate || 0,
          newMonthlyPayment: 0,
          error: 'Loan not found or not in eligible status',
        };
      }

      const oldTerm = loan.term;
      const oldRate = Number(loan.interestRate);
      const effectiveRate = newInterestRate ?? oldRate;
      const outstandingPrincipal = Number(loan.principalBalance);
      
      // Calculate new monthly payment
      const monthlyRate = effectiveRate / 100 / 12;
      let newMonthlyPayment: number;
      
      if (monthlyRate > 0) {
        newMonthlyPayment = (outstandingPrincipal * monthlyRate * Math.pow(1 + monthlyRate, newTerm)) /
          (Math.pow(1 + monthlyRate, newTerm) - 1);
      } else {
        newMonthlyPayment = outstandingPrincipal / newTerm;
      }

      const startDate = newStartDate || new Date();
      const gracePeriod = graceperiodMonths || 0;

      const result = await prisma.$transaction(async (tx) => {
        // Delete old pending schedules
        await tx.repaymentSchedule.deleteMany({
          where: {
            loanId,
            status: 'PENDING',
          },
        });

        // Generate new schedule
        let scheduleDate = new Date(startDate);
        if (gracePeriod > 0) {
          scheduleDate.setMonth(scheduleDate.getMonth() + gracePeriod);
        }

        const schedules: Prisma.RepaymentScheduleCreateManyInput[] = [];
        let remainingPrincipal = outstandingPrincipal;

        for (let i = 1; i <= newTerm; i++) {
          scheduleDate = new Date(scheduleDate);
          scheduleDate.setMonth(scheduleDate.getMonth() + 1);

          const interestDue = remainingPrincipal * monthlyRate;
          const principalDue = newMonthlyPayment - interestDue;
          remainingPrincipal -= principalDue;

          schedules.push({
            loanId,
            installmentNumber: i,
            dueDate: new Date(scheduleDate),
            principalAmount: Math.max(0, principalDue),
            interestAmount: Math.max(0, interestDue),
            totalAmount: newMonthlyPayment,
            paidAmount: 0,
            outstandingAmount: newMonthlyPayment,
            status: 'PENDING',
            createdAt: new Date(),
          });
        }

        await tx.repaymentSchedule.createMany({
          data: schedules,
        });

        // Update loan
        await tx.loan.update({
          where: { id: loanId },
          data: {
            term: newTerm,
            interestRate: effectiveRate,
            installmentAmount: newMonthlyPayment,
            status: 'ACTIVE',
            updatedAt: new Date(),
          },
        });

        // Log reschedule to AuditLog
        const auditLog = await tx.auditLog.create({
          data: {
            userId: rescheduledBy,
            organizationId,
            action: 'LOAN_RESCHEDULE',
            resource: 'loan',
            resourceId: loanId,
            previousValue: {
              term: oldTerm,
              interestRate: oldRate,
              installmentAmount: Number(loan.installmentAmount),
            },
            newValue: {
              term: newTerm,
              interestRate: effectiveRate,
              installmentAmount: newMonthlyPayment,
            },
            changes: {
              oldTerm,
              newTerm,
              oldInterestRate: oldRate,
              newInterestRate: effectiveRate,
              oldMonthlyPayment: Number(loan.installmentAmount),
              newMonthlyPayment,
              outstandingBalanceAtReschedule: Number(loan.outstandingBalance),
              reason,
              notes,
              gracePeriodMonths: gracePeriod,
              newStartDate: startDate,
            },
            status: 'SUCCESS',
            timestamp: new Date(),
          },
        });

        return auditLog;
      });

      return {
        success: true,
        rescheduleId: result.id,
        loanId,
        oldTerm,
        newTerm,
        oldRate,
        newRate: effectiveRate,
        newMonthlyPayment: Math.round(newMonthlyPayment * 100) / 100,
      };
    } catch (error: any) {
      console.error('Reschedule error:', error);
      return {
        success: false,
        loanId,
        oldTerm: 0,
        newTerm,
        oldRate: 0,
        newRate: newInterestRate || 0,
        newMonthlyPayment: 0,
        error: error.message,
      };
    }
  }

  /**
   * Get adjustment history for a loan (from AuditLog)
   */
  async getAdjustmentHistory(
    loanId: string,
    organizationId: string
  ): Promise<any[]> {
    const adjustments = await prisma.auditLog.findMany({
      where: { 
        resourceId: loanId, 
        organizationId,
        action: 'LOAN_ADJUSTMENT',
      },
      include: {
        user: {
          select: { firstName: true, lastName: true },
        },
      },
      orderBy: { timestamp: 'desc' },
    });

    return adjustments.map(a => ({
      id: a.id,
      loanId: a.resourceId,
      type: (a.changes as any)?.type,
      amount: (a.changes as any)?.amount,
      principalChange: (a.changes as any)?.principalChange,
      interestChange: (a.changes as any)?.interestChange,
      penaltyChange: (a.changes as any)?.penaltyChange,
      previousBalance: (a.previousValue as any)?.outstandingBalance,
      newBalance: (a.newValue as any)?.outstandingBalance,
      reason: (a.changes as any)?.reason,
      notes: (a.changes as any)?.notes,
      effectiveDate: (a.changes as any)?.effectiveDate,
      adjustedBy: a.user,
      createdAt: a.timestamp,
    }));
  }

  /**
   * Get writeoff history (from AuditLog)
   */
  async getWriteoffHistory(
    organizationId: string,
    options: {
      startDate?: Date;
      endDate?: Date;
      branchId?: string;
    } = {}
  ): Promise<any[]> {
    const where: Prisma.AuditLogWhereInput = { 
      organizationId,
      action: 'LOAN_WRITEOFF',
    };

    if (options.startDate || options.endDate) {
      where.timestamp = {};
      if (options.startDate) {
        where.timestamp.gte = options.startDate;
      }
      if (options.endDate) {
        where.timestamp.lte = options.endDate;
      }
    }

    if (options.branchId) {
      where.branchId = options.branchId;
    }

    const writeoffs = await prisma.auditLog.findMany({
      where,
      include: {
        user: {
          select: { firstName: true, lastName: true },
        },
      },
      orderBy: { timestamp: 'desc' },
    });

    // Fetch loan details for each writeoff
    const loanIds = writeoffs.map(w => w.resourceId).filter(Boolean) as string[];
    const loans = await prisma.loan.findMany({
      where: { id: { in: loanIds } },
      include: {
        client: {
          select: { firstName: true, lastName: true, clientNumber: true },
        },
      },
    });
    const loanMap = new Map(loans.map(l => [l.id, l]));

    return writeoffs.map(w => ({
      id: w.id,
      loanId: w.resourceId,
      writeoffType: (w.changes as any)?.writeoffType,
      amountWrittenOff: (w.changes as any)?.amountWrittenOff,
      principalWrittenOff: (w.changes as any)?.principalWrittenOff,
      interestWrittenOff: (w.changes as any)?.interestWrittenOff,
      penaltyWrittenOff: (w.changes as any)?.penaltyWrittenOff,
      previousBalance: (w.previousValue as any)?.outstandingBalance,
      newBalance: (w.newValue as any)?.outstandingBalance,
      reason: (w.changes as any)?.reason,
      notes: (w.changes as any)?.notes,
      recoveryExpected: (w.changes as any)?.recoveryExpected,
      expectedRecoveryAmount: (w.changes as any)?.expectedRecoveryAmount,
      loan: loanMap.get(w.resourceId || ''),
      approvedBy: w.user,
      writeoffDate: w.timestamp,
    }));
  }

  /**
   * Get reschedule history (from AuditLog)
   */
  async getRescheduleHistory(
    loanId: string,
    organizationId: string
  ): Promise<any[]> {
    const reschedules = await prisma.auditLog.findMany({
      where: { 
        resourceId: loanId, 
        organizationId,
        action: 'LOAN_RESCHEDULE',
      },
      include: {
        user: {
          select: { firstName: true, lastName: true },
        },
      },
      orderBy: { timestamp: 'desc' },
    });

    return reschedules.map(r => ({
      id: r.id,
      loanId: r.resourceId,
      oldTerm: (r.changes as any)?.oldTerm,
      newTerm: (r.changes as any)?.newTerm,
      oldInterestRate: (r.changes as any)?.oldInterestRate,
      newInterestRate: (r.changes as any)?.newInterestRate,
      oldMonthlyPayment: (r.changes as any)?.oldMonthlyPayment,
      newMonthlyPayment: (r.changes as any)?.newMonthlyPayment,
      outstandingBalanceAtReschedule: (r.changes as any)?.outstandingBalanceAtReschedule,
      reason: (r.changes as any)?.reason,
      notes: (r.changes as any)?.notes,
      gracePeriodMonths: (r.changes as any)?.gracePeriodMonths,
      newStartDate: (r.changes as any)?.newStartDate,
      rescheduledBy: r.user,
      rescheduleDate: r.timestamp,
    }));
  }
}

export const loanAdjustmentService = new LoanAdjustmentService();
