/**
 * Loan Engine Service
 *
 * This service handles automated loan calculations and status updates.
 * Inspired by the Django loan engine (engine.py, loan_engine.py, disburse.py)
 *
 * Key features:
 * - Grace period handling
 * - Due date calculations
 * - Interest recalculation on overdue loans
 * - Automatic charge application based on loan status
 * - Configurable calculation types per organization
 *
 * The calculation type can be configured at the organization level:
 * - SHORT_TERM: Simple interest, period-based (original Django system)
 * - LONG_TERM: Amortized schedule with installments
 * - REDUCING_BALANCE: Interest on reducing balance
 * - FLAT_RATE: Fixed interest for entire term
 * - CUSTOM: Organization-specific custom logic
 */

import { prisma } from '../config/database';
import {
  LoanStatus,
  ChargeCalculationType,
  ChargeType,
  Prisma,
  LoanCalculationEngineType,
  DurationUnit,
  ChargeMode,
  ChargeApplication,
} from '@prisma/client';
import { settingsService } from './settings.service';

// ============================================
// TYPES AND INTERFACES
// ============================================

interface LoanEngineSettings {
  engineType: LoanCalculationEngineType;
  loanApprovalRequired: boolean;
  autoProcessEnabled: boolean;
}

interface DisbursementInput {
  loanId: string;
  paymentMethodId?: string;
  disbursementDate?: Date;
  disbursedBy: string;
  notes?: string;
}

interface LoanProcessingResult {
  loanId: string;
  loanNumber: string;
  previousStatus: LoanStatus;
  newStatus: LoanStatus;
  interestAdded?: number;
  chargesAdded?: number;
  nextDueDate?: Date;
  message: string;
}

interface EngineRunResult {
  processedCount: number;
  results: LoanProcessingResult[];
  errors: { loanId: string; error: string }[];
  timestamp: Date;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get duration delta based on duration and unit
 * Mirrors Django's get_duration_delta function
 */
function getDurationDelta(duration: number, durationUnit: DurationUnit): number {
  const now = new Date();

  switch (durationUnit) {
    case DurationUnit.DAYS:
      return duration * 24 * 60 * 60 * 1000; // days in milliseconds
    case DurationUnit.WEEKS:
      return duration * 7 * 24 * 60 * 60 * 1000; // weeks in milliseconds
    case DurationUnit.MONTHS:
      // Calculate actual days for months (accounting for varying month lengths)
      const futureDate = new Date(now);
      futureDate.setMonth(futureDate.getMonth() + duration);
      return futureDate.getTime() - now.getTime();
    case DurationUnit.YEARS:
      const futureYear = new Date(now);
      futureYear.setFullYear(futureYear.getFullYear() + duration);
      return futureYear.getTime() - now.getTime();
    default:
      return 0;
  }
}

/**
 * Add duration to a date based on duration unit
 */
function addDuration(date: Date, duration: number, durationUnit: DurationUnit): Date {
  const result = new Date(date);

  switch (durationUnit) {
    case DurationUnit.DAYS:
      result.setDate(result.getDate() + duration);
      break;
    case DurationUnit.WEEKS:
      result.setDate(result.getDate() + duration * 7);
      break;
    case DurationUnit.MONTHS:
      result.setMonth(result.getMonth() + duration);
      break;
    case DurationUnit.YEARS:
      result.setFullYear(result.getFullYear() + duration);
      break;
  }

  return result;
}

/**
 * Calculate the final due date including grace period
 * Mirrors Django's calculate_due_date function
 */
function calculateDueDate(
  startDate: Date,
  maxPeriod: number,
  durationUnit: DurationUnit,
  gracePeriodDays: number
): Date {
  const maxPeriodDate = addDuration(startDate, maxPeriod, durationUnit);
  maxPeriodDate.setDate(maxPeriodDate.getDate() + gracePeriodDays);
  return maxPeriodDate;
}

/**
 * Calculate charge amount based on type
 * Mirrors Django's calculate_charge function
 */
function calculateChargeAmount(
  baseAmount: Prisma.Decimal,
  charge: {
    calculationType: ChargeCalculationType;
    defaultAmount: Prisma.Decimal | null;
    defaultPercentage: Prisma.Decimal | null;
  }
): Prisma.Decimal {
  if (charge.calculationType === 'FIXED') {
    return charge.defaultAmount || new Prisma.Decimal(0);
  } else if (charge.calculationType === 'PERCENTAGE') {
    const percentage = charge.defaultPercentage || new Prisma.Decimal(0);
    // Percentage is stored as decimal (e.g., 0.05 for 5%)
    return baseAmount.mul(percentage);
  }
  return new Prisma.Decimal(0);
}

// ============================================
// LOAN ENGINE SERVICE
// ============================================

class LoanEngineService {
  /**
   * Get engine settings for an organization
   */
  async getEngineSettings(organizationId: string): Promise<LoanEngineSettings> {
    const settings = await settingsService.getAll(organizationId);

    return {
      engineType:
        (settings.loan_engine_type as LoanCalculationEngineType) ||
        LoanCalculationEngineType.SHORT_TERM,
      loanApprovalRequired: settings.loan_approval_required ?? true,
      autoProcessEnabled: settings.loan_auto_process_enabled ?? true,
    };
  }

  /**
   * Get balance for a loan based on payments
   * Similar to Django's loan.balance property
   */
  async getLoanBalance(loanId: string): Promise<Prisma.Decimal> {
    const loan = await prisma.loan.findUnique({
      where: { id: loanId },
      select: {
        amount: true,
        interestAmount: true,
        payments: {
          where: { status: 'COMPLETED' },
          select: { principalAmount: true, interestAmount: true, penaltyAmount: true },
        },
        loanCharges: {
          where: { status: 'COMPLETED' },
          select: { amount: true, isDeductedFromPrincipal: true },
        },
      },
    });

    if (!loan) return new Prisma.Decimal(0);

    // Total debits = principal + interest + charges added to loan
    let totalDebit = loan.amount.add(loan.interestAmount);

    // Add charges that are NOT deducted from principal (added to loan)
    for (const charge of loan.loanCharges) {
      if (!charge.isDeductedFromPrincipal) {
        totalDebit = totalDebit.add(charge.amount);
      }
    }

    // Total credits = payments
    let totalCredit = new Prisma.Decimal(0);
    for (const payment of loan.payments) {
      totalCredit = totalCredit.add(payment.principalAmount);
      totalCredit = totalCredit.add(payment.interestAmount);
      totalCredit = totalCredit.add(payment.penaltyAmount);
    }

    return totalDebit.sub(totalCredit);
  }

  /**
   * Calculate and apply interest and due dates after disbursement
   * This should be called by the loan-workflow.service after disbursing a loan
   * 
   * @param loanId The loan ID to calculate for
   * @param disbursementDate The date of disbursement
   * @returns Updated loan with calculated values
   */
  async calculateDisbursementValues(
    loanId: string,
    disbursementDate?: Date
  ): Promise<{
    success: boolean;
    loan?: any;
    error?: string;
    calculations?: {
      interestAmount: number;
      expectedRepaymentDate: Date;
      nextDueDate: Date;
      gracePeriodDays: number;
    };
  }> {
    try {
      const loan = await prisma.loan.findUnique({
        where: { id: loanId },
        include: {
          product: true,
          organization: true,
        },
      });

      if (!loan) {
        return { success: false, error: 'Loan not found' };
      }

      const now = disbursementDate || loan.disbursedDate || new Date();
      const product = loan.product;

      // Calculate interest (simple interest for short-term)
      // Interest = Principal * Rate (where rate is already in decimal form)
      const interestRate = loan.interestRate;
      const interestAmount = loan.amount.mul(interestRate);

      // Get duration settings from product
      const durationUnit = product.durationUnit || DurationUnit.MONTHS;
      // Use loan term (in months) or fall back to product settings
      const loanPeriod = loan.term || product.minPeriod || 1;
      const gracePeriodDays = product.gracePeriodDays || product.gracePeriod || 0;

      // Expected repayment date = start date + loan period
      const expectedRepaymentDate = addDuration(now, loanPeriod, durationUnit);
      
      // Next due date for first payment (could be same as expected for short-term, or first installment for long-term)
      const nextDueDate = expectedRepaymentDate;

      // Update loan with calculated values
      const updatedLoan = await prisma.loan.update({
        where: { id: loanId },
        data: {
          startDate: now,
          expectedRepaymentDate,
          nextDueDate,
          interestAmount,
          interestBalance: interestAmount,
          principalBalance: loan.amount,
          outstandingBalance: loan.amount.add(interestAmount),
          gracePeriodDays,
        },
        include: {
          product: true,
          client: { select: { firstName: true, lastName: true, phone: true } },
        },
      });

      return {
        success: true,
        loan: updatedLoan,
        calculations: {
          interestAmount: parseFloat(interestAmount.toString()),
          expectedRepaymentDate,
          nextDueDate,
          gracePeriodDays,
        },
      };
    } catch (error: any) {
      console.error('Disbursement calculation error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * @deprecated Use loan-workflow.service.ts disburseLoan instead, 
   * then call calculateDisbursementValues to set dates and interest.
   * This method is kept for backwards compatibility but should not be used directly.
   * 
   * Perform disbursement with interest and charges calculation
   * Mirrors Django's perform_disbursement function
   */
  async disburseLoan(input: DisbursementInput): Promise<{
    success: boolean;
    loan?: any;
    error?: string;
  }> {
    const { loanId, paymentMethodId, disbursementDate, disbursedBy, notes } = input;

    try {
      const loan = await prisma.loan.findUnique({
        where: { id: loanId },
        include: {
          product: true,
          organization: true,
          branch: true,
        },
      });

      if (!loan) {
        return { success: false, error: 'Loan not found' };
      }

      // Check organization settings for approval requirement
      const settings = await this.getEngineSettings(loan.organizationId);

      if (
        settings.loanApprovalRequired &&
        loan.status !== LoanStatus.APPROVED &&
        loan.status !== LoanStatus.PENDING_DISBURSEMENT
      ) {
        return {
          success: false,
          error: `Loan must be in APPROVED or PENDING_DISBURSEMENT status. Current: ${loan.status}`,
        };
      }

      const now = disbursementDate || new Date();
      const product = loan.product;

      // Calculate interest (simple interest for short-term)
      // Interest = Principal * Rate (where rate is already in decimal form)
      const interestRate = loan.interestRate;
      const interestAmount = loan.amount.mul(interestRate);

      // Calculate expected repayment date based on product term
      const durationUnit = product.durationUnit;
      const minPeriod = product.minPeriod;
      const gracePeriodDays = product.gracePeriodDays || product.gracePeriod || 0;

      // Expected repayment date = start date + min period
      const expectedRepaymentDate = addDuration(now, minPeriod, durationUnit);

      // Update loan with disbursement details
      const updatedLoan = await prisma.$transaction(async (tx) => {
        // Create disbursement payment record
        await tx.payment.create({
          data: {
            paymentNumber: `DISB-${loan.loanNumber}`,
            loanId,
            amount: loan.amount,
            principalAmount: loan.amount,
            interestAmount: new Prisma.Decimal(0),
            penaltyAmount: new Prisma.Decimal(0),
            type: 'LOAN_DISBURSEMENT',
            method: paymentMethodId ? 'BANK_TRANSFER' : 'CASH',
            status: 'COMPLETED',
            paymentDate: now,
            receivedBy: disbursedBy,
            notes: notes || 'Loan disbursement',
          },
        });

        // Apply automatic charges for ACTIVE status
        await this.applyAutoCharges(tx, loan, LoanStatus.ACTIVE);

        // Update loan with all the calculated values
        return tx.loan.update({
          where: { id: loanId },
          data: {
            status: LoanStatus.ACTIVE,
            disbursedDate: now,
            startDate: now,
            expectedRepaymentDate,
            interestAmount,
            interestRate,
            interestBalance: interestAmount,
            principalBalance: loan.amount,
            outstandingBalance: loan.amount.add(interestAmount),
            gracePeriodDays,
          },
          include: {
            product: true,
            client: { select: { firstName: true, lastName: true, phone: true } },
          },
        });
      });

      return { success: true, loan: updatedLoan };
    } catch (error: any) {
      console.error('Disbursement error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Apply automatic charges based on loan status
   * Mirrors Django's add_charges function
   */
  private async applyAutoCharges(
    tx: Prisma.TransactionClient,
    loan: any,
    targetStatus: LoanStatus
  ): Promise<Prisma.Decimal> {
    // Get auto charges for this status
    const charges = await tx.charge.findMany({
      where: {
        organizationId: loan.organizationId,
        chargeMode: ChargeMode.AUTO,
        triggerStatus: targetStatus,
        isActive: true,
      },
      include: { chargeRates: true },
    });

    let totalCharges = new Prisma.Decimal(0);
    const balance = await this.getLoanBalance(loan.id);

    for (const charge of charges) {
      // Determine base amount based on charge application
      const baseAmount =
        charge.chargeApplication === ChargeApplication.PRINCIPAL
          ? loan.amount
          : balance;

      const chargeAmount = calculateChargeAmount(baseAmount, charge);

      if (chargeAmount.gt(0)) {
        // Create loan charge record
        await tx.loanCharge.create({
          data: {
            loanId: loan.id,
            chargeId: charge.id,
            chargeName: charge.name,
            chargeType: charge.type,
            calculationType: charge.calculationType,
            currency: loan.currency,
            baseAmount,
            calculatedAmount: chargeAmount,
            amount: chargeAmount,
            isDeductedFromPrincipal: charge.isDeductedFromPrincipal,
            status: 'COMPLETED',
            appliedBy: loan.loanOfficerId,
            paidAmount: charge.isDeductedFromPrincipal ? chargeAmount : new Prisma.Decimal(0),
            paidAt: charge.isDeductedFromPrincipal ? new Date() : null,
          },
        });

        totalCharges = totalCharges.add(chargeAmount);
      }
    }

    return totalCharges;
  }

  /**
   * Process short-term loans
   * This is the main engine calculation that mirrors Django's short_term_calculation
   */
  async processShortTermLoans(organizationId?: string): Promise<EngineRunResult> {
    const results: LoanProcessingResult[] = [];
    const errors: { loanId: string; error: string }[] = [];
    const now = new Date();

    try {
      // Get loans that are eligible for auto-calculations
      // Similar to Django: Loan.objects.filter(status__allow_auto_calculations=True, status__is_active=True)
      const whereClause: Prisma.LoanWhereInput = {
        status: {
          in: [LoanStatus.ACTIVE, LoanStatus.DEFAULTED],
        },
        product: {
          allowAutoCalculations: true,
          isActive: true,
        },
      };

      if (organizationId) {
        whereClause.organizationId = organizationId;
      }

      const loans = await prisma.loan.findMany({
        where: whereClause,
        include: {
          product: true,
          organization: true,
        },
      });

      console.log(`Processing ${loans.length} loans for short-term calculation`);

      for (const loan of loans) {
        try {
          const result = await this.processShortTermLoan(loan, now);
          if (result) {
            results.push(result);
          }
        } catch (error: any) {
          console.error(`Error processing loan ${loan.id}:`, error);
          errors.push({ loanId: loan.id, error: error.message });
        }
      }

      return {
        processedCount: results.length,
        results,
        errors,
        timestamp: now,
      };
    } catch (error: any) {
      console.error('Engine run error:', error);
      return {
        processedCount: 0,
        results: [],
        errors: [{ loanId: 'system', error: error.message }],
        timestamp: now,
      };
    }
  }

  /**
   * Process a single short-term loan
   * Mirrors Django's short_term_calculation logic for individual loans
   */
  private async processShortTermLoan(
    loan: any,
    now: Date
  ): Promise<LoanProcessingResult | null> {
    const product = loan.product;
    const gracePeriodDays = product.gracePeriodDays || product.gracePeriod || 0;

    // Calculate target date with grace period
    // target_date = loan.next_due_date or loan.expected_repayment_date
    // target_date += grace_period_delta
    let targetDate = loan.nextDueDate || loan.expectedRepaymentDate;

    if (!targetDate) {
      console.log(`Loan ${loan.loanNumber} has no due date set, skipping`);
      return null;
    }

    targetDate = new Date(targetDate);
    targetDate.setDate(targetDate.getDate() + gracePeriodDays);

    // Check if we've passed the target date
    if (now <= targetDate) {
      console.log(`Loan ${loan.loanNumber} not yet due (target: ${targetDate})`);
      return null;
    }

    console.log(`Processing overdue loan ${loan.loanNumber}`);

    const durationUnit = product.durationUnit;
    const maxPeriod = product.maxPeriod;
    const minPeriod = product.minPeriod;

    // Calculate final due date before moving to overdue
    // final_due_date = loan.start_date + max_period_delta + grace_period_delta
    const startDate = loan.startDate || loan.disbursedDate;
    if (!startDate) {
      return null;
    }

    const finalDueDate = calculateDueDate(
      new Date(startDate),
      maxPeriod,
      durationUnit,
      gracePeriodDays
    );

    let newStatus = loan.status;
    let interestAdded = 0;
    let chargesAdded = 0;
    let nextDueDate = loan.nextDueDate;

    return await prisma.$transaction(async (tx) => {
      if (now > finalDueDate) {
        // Move to OVERDUE status (final state before write-off)
        newStatus = LoanStatus.OVERDUE;

        // Apply overdue charges
        const charges = await this.applyAutoChargesInTx(tx, loan, LoanStatus.OVERDUE);
        chargesAdded = charges.toNumber();
      } else {
        // Handle DEFAULT status transitions
        if (loan.status === LoanStatus.ACTIVE) {
          // First missed payment - move to DEFAULT
          newStatus = LoanStatus.DEFAULTED;

          // Set next due date
          const expectedRepaymentDate = new Date(loan.expectedRepaymentDate);
          nextDueDate = addDuration(expectedRepaymentDate, minPeriod, durationUnit);
        } else {
          // Already in DEFAULT, extend next due date
          nextDueDate = addDuration(new Date(loan.nextDueDate!), minPeriod, durationUnit);
        }

        // Recalculate interest on balance
        // interest = (loan.interest_rate / 100) * loan.balance
        const balance = await this.getLoanBalanceInTx(tx, loan.id);
        const interestRate = parseFloat(loan.interestRate.toString());
        const interest = new Prisma.Decimal(
          (balance.toNumber() * interestRate).toFixed(2)
        );
        interestAdded = interest.toNumber();

        // Create interest transaction (as a loan charge or update loan)
        const currentInterest = loan.interestAmount || new Prisma.Decimal(0);
        const newInterestAmount = currentInterest.add(interest);

        // Apply charges based on current status
        const charges = await this.applyAutoChargesInTx(tx, loan, newStatus);
        chargesAdded = charges.toNumber();

        // Update loan with new values
        await tx.loan.update({
          where: { id: loan.id },
          data: {
            status: newStatus,
            nextDueDate,
            interestAmount: newInterestAmount,
            interestBalance: loan.interestBalance.add(interest),
            outstandingBalance: balance.add(interest),
          },
        });
      }

      // Update loan status if changed to OVERDUE
      if (newStatus === LoanStatus.OVERDUE) {
        await tx.loan.update({
          where: { id: loan.id },
          data: { status: newStatus },
        });
      }

      return {
        loanId: loan.id,
        loanNumber: loan.loanNumber,
        previousStatus: loan.status,
        newStatus,
        interestAdded,
        chargesAdded,
        nextDueDate,
        message: `Loan ${loan.loanNumber} processed: ${loan.status} -> ${newStatus}`,
      };
    });
  }

  /**
   * Apply auto charges within a transaction
   */
  private async applyAutoChargesInTx(
    tx: Prisma.TransactionClient,
    loan: any,
    targetStatus: LoanStatus
  ): Promise<Prisma.Decimal> {
    const charges = await tx.charge.findMany({
      where: {
        organizationId: loan.organizationId,
        chargeMode: ChargeMode.AUTO,
        triggerStatus: targetStatus,
        isActive: true,
      },
    });

    let totalCharges = new Prisma.Decimal(0);
    const balance = await this.getLoanBalanceInTx(tx, loan.id);

    for (const charge of charges) {
      const baseAmount =
        charge.chargeApplication === ChargeApplication.PRINCIPAL
          ? loan.amount
          : balance;

      const chargeAmount = calculateChargeAmount(baseAmount, charge);

      if (chargeAmount.gt(0)) {
        await tx.loanCharge.create({
          data: {
            loanId: loan.id,
            chargeId: charge.id,
            chargeName: charge.name,
            chargeType: charge.type,
            calculationType: charge.calculationType,
            currency: loan.currency,
            baseAmount,
            calculatedAmount: chargeAmount,
            amount: chargeAmount,
            isDeductedFromPrincipal: charge.isDeductedFromPrincipal,
            status: 'PENDING',
            appliedBy: loan.loanOfficerId,
          },
        });

        totalCharges = totalCharges.add(chargeAmount);
      }
    }

    return totalCharges;
  }

  /**
   * Get loan balance within a transaction
   */
  private async getLoanBalanceInTx(
    tx: Prisma.TransactionClient,
    loanId: string
  ): Promise<Prisma.Decimal> {
    const loan = await tx.loan.findUnique({
      where: { id: loanId },
      select: {
        amount: true,
        interestAmount: true,
        payments: {
          where: { status: 'COMPLETED' },
          select: { principalAmount: true, interestAmount: true, penaltyAmount: true },
        },
        loanCharges: {
          where: { status: 'COMPLETED' },
          select: { amount: true, isDeductedFromPrincipal: true },
        },
      },
    });

    if (!loan) return new Prisma.Decimal(0);

    let totalDebit = loan.amount.add(loan.interestAmount);

    for (const charge of loan.loanCharges) {
      if (!charge.isDeductedFromPrincipal) {
        totalDebit = totalDebit.add(charge.amount);
      }
    }

    let totalCredit = new Prisma.Decimal(0);
    for (const payment of loan.payments) {
      totalCredit = totalCredit.add(payment.principalAmount);
      totalCredit = totalCredit.add(payment.interestAmount);
      totalCredit = totalCredit.add(payment.penaltyAmount);
    }

    return totalDebit.sub(totalCredit);
  }

  /**
   * Get loans that need processing
   */
  async getLoansForProcessing(organizationId?: string): Promise<any[]> {
    const whereClause: Prisma.LoanWhereInput = {
      status: {
        in: [LoanStatus.ACTIVE, LoanStatus.DEFAULTED],
      },
      product: {
        allowAutoCalculations: true,
        isActive: true,
      },
    };

    if (organizationId) {
      whereClause.organizationId = organizationId;
    }

    return prisma.loan.findMany({
      where: whereClause,
      include: {
        product: { select: { name: true, durationUnit: true, minPeriod: true, maxPeriod: true, gracePeriodDays: true } },
        client: { select: { firstName: true, lastName: true, phone: true } },
        branch: { select: { name: true } },
      },
      orderBy: { nextDueDate: 'asc' },
    });
  }

  /**
   * Get overdue loans
   */
  async getOverdueLoans(organizationId?: string): Promise<any[]> {
    const now = new Date();

    const whereClause: Prisma.LoanWhereInput = {
      status: {
        in: [LoanStatus.ACTIVE, LoanStatus.DEFAULTED],
      },
      OR: [
        { nextDueDate: { lt: now } },
        { expectedRepaymentDate: { lt: now } },
      ],
    };

    if (organizationId) {
      whereClause.organizationId = organizationId;
    }

    return prisma.loan.findMany({
      where: whereClause,
      include: {
        product: true,
        client: { select: { firstName: true, lastName: true, phone: true } },
        branch: { select: { name: true } },
      },
      orderBy: [{ nextDueDate: 'asc' }, { expectedRepaymentDate: 'asc' }],
    });
  }

  /**
   * Get engine statistics
   */
  async getEngineStatistics(organizationId: string): Promise<{
    totalActiveLoans: number;
    totalDefaultLoans: number;
    totalOverdueLoans: number;
    totalOutstandingBalance: number;
    loansToProcess: number;
  }> {
    const now = new Date();

    const [active, defaulted, overdue, loansToProcess] = await Promise.all([
      prisma.loan.count({
        where: { organizationId, status: LoanStatus.ACTIVE },
      }),
      prisma.loan.count({
        where: { organizationId, status: LoanStatus.DEFAULTED },
      }),
      prisma.loan.count({
        where: { organizationId, status: LoanStatus.OVERDUE },
      }),
      prisma.loan.count({
        where: {
          organizationId,
          status: { in: [LoanStatus.ACTIVE, LoanStatus.DEFAULTED] },
          OR: [
            { nextDueDate: { lt: now } },
            { expectedRepaymentDate: { lt: now } },
          ],
          product: { allowAutoCalculations: true },
        },
      }),
    ]);

    const balanceResult = await prisma.loan.aggregate({
      where: {
        organizationId,
        status: { in: [LoanStatus.ACTIVE, LoanStatus.DEFAULTED, LoanStatus.OVERDUE] },
      },
      _sum: { outstandingBalance: true },
    });

    return {
      totalActiveLoans: active,
      totalDefaultLoans: defaulted,
      totalOverdueLoans: overdue,
      totalOutstandingBalance: balanceResult._sum.outstandingBalance?.toNumber() || 0,
      loansToProcess,
    };
  }
}

export const loanEngineService = new LoanEngineService();
export { LoanEngineService };
