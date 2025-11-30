import { Decimal } from '@prisma/client/runtime/library';
import {
  ILoanCalculationStrategy,
  LoanCalculationInput,
  LoanCalculationResult,
  LoanInstallment,
  PenaltyCalculationResult,
  EarlySettlementResult,
  PenaltyType,
  LoanCalculationUtils,
} from './types';

/**
 * Simple Interest Calculation Strategy
 *
 * Simple interest is calculated only on the principal amount.
 * Interest = Principal × Rate × Time
 *
 * This method is straightforward and often used for short-term loans
 * or when the borrower pays interest separately from principal.
 */
export class SimpleInterestStrategy implements ILoanCalculationStrategy {
  calculateLoan(input: LoanCalculationInput): LoanCalculationResult {
    const {
      principalAmount,
      annualInterestRate,
      termInMonths,
      repaymentFrequency,
      gracePeriodDays = 0,
      processingFeeAmount = new Decimal(0),
      processingFeePercentage = new Decimal(0),
      insuranceFeeAmount = new Decimal(0),
      insuranceFeePercentage = new Decimal(0),
      disbursementDate = new Date(),
    } = input;

    // Calculate fees
    const processingFee = processingFeeAmount.add(
      principalAmount.mul(processingFeePercentage).div(100)
    );
    const insuranceFee = insuranceFeeAmount.add(
      principalAmount.mul(insuranceFeePercentage).div(100)
    );
    const totalFees = processingFee.add(insuranceFee);

    // Calculate simple interest
    const termInYears = new Decimal(termInMonths).div(12);
    const totalInterest = principalAmount
      .mul(annualInterestRate)
      .div(100)
      .mul(termInYears);

    // Calculate number of payments
    const periodsPerYear =
      LoanCalculationUtils.getPeriodsPerYear(repaymentFrequency);
    const numberOfPayments = Math.ceil(
      (termInMonths * 12) / (12 / (periodsPerYear / 12))
    );

    // For simple interest, we can structure payments in different ways:
    // 1. Interest-only payments with principal at maturity
    // 2. Equal installments of principal + proportional interest
    // 3. Balloon payment with interest distributed equally

    // Using equal installments approach
    const principalPerInstallment = principalAmount.div(numberOfPayments);
    const interestPerInstallment = totalInterest.div(numberOfPayments);
    const installmentAmount = principalPerInstallment.add(
      interestPerInstallment
    );

    // Generate repayment schedule
    const repaymentSchedule: LoanInstallment[] = [];
    let remainingBalance = principalAmount;
    let cumulativePrincipal = new Decimal(0);
    let cumulativeInterest = new Decimal(0);

    // Calculate first payment date (considering grace period)
    let currentDate = new Date(disbursementDate);
    if (gracePeriodDays > 0) {
      currentDate.setDate(currentDate.getDate() + gracePeriodDays);
    }

    for (let i = 1; i <= numberOfPayments; i++) {
      // Calculate due date
      const dueDate = LoanCalculationUtils.addPeriod(
        currentDate,
        i - 1,
        repaymentFrequency
      );

      let principalPayment = principalPerInstallment;
      let interestPayment = interestPerInstallment;

      // Adjust for rounding in the last installment
      if (i === numberOfPayments) {
        principalPayment = remainingBalance;
        interestPayment = totalInterest.sub(cumulativeInterest);
      }

      // Calculate fees (usually applied to first installment)
      const feesAmount = i === 1 ? totalFees : new Decimal(0);

      // Total amount for this installment
      const installmentTotal = principalPayment
        .add(interestPayment)
        .add(feesAmount);

      // Update balances
      remainingBalance = remainingBalance.sub(principalPayment);
      cumulativePrincipal = cumulativePrincipal.add(principalPayment);
      cumulativeInterest = cumulativeInterest.add(interestPayment);

      // Add to schedule
      repaymentSchedule.push({
        installmentNumber: i,
        dueDate,
        principalAmount: LoanCalculationUtils.roundDecimal(principalPayment),
        interestAmount: LoanCalculationUtils.roundDecimal(interestPayment),
        feesAmount: LoanCalculationUtils.roundDecimal(feesAmount),
        totalAmount: LoanCalculationUtils.roundDecimal(installmentTotal),
        remainingBalance: LoanCalculationUtils.roundDecimal(remainingBalance),
        cumulativePrincipal:
          LoanCalculationUtils.roundDecimal(cumulativePrincipal),
        cumulativeInterest:
          LoanCalculationUtils.roundDecimal(cumulativeInterest),
      });
    }

    // Calculate totals
    const totalAmount = principalAmount.add(totalInterest).add(totalFees);

    // For simple interest, effective rate equals stated rate
    const effectiveInterestRate = annualInterestRate;
    const apr = totalAmount.div(principalAmount).sub(1).mul(100);

    // Calculate average monthly payment
    const totalPayments = repaymentSchedule.reduce(
      (sum, installment) => sum.add(installment.totalAmount),
      new Decimal(0)
    );
    const averagePayment = totalPayments.div(numberOfPayments);

    return {
      principalAmount,
      totalInterest: LoanCalculationUtils.roundDecimal(totalInterest),
      totalFees: LoanCalculationUtils.roundDecimal(totalFees),
      totalAmount: LoanCalculationUtils.roundDecimal(totalAmount),
      monthlyInstallment: LoanCalculationUtils.roundDecimal(installmentAmount),
      effectiveInterestRate: LoanCalculationUtils.roundDecimal(
        effectiveInterestRate
      ),
      apr: LoanCalculationUtils.roundDecimal(apr),
      repaymentSchedule,
      calculationMethod: input.calculationMethod,
      summary: {
        numberOfInstallments: numberOfPayments,
        firstPaymentDate: repaymentSchedule[0]?.dueDate || currentDate,
        lastPaymentDate:
          repaymentSchedule[numberOfPayments - 1]?.dueDate || currentDate,
        totalInterestPaid: LoanCalculationUtils.roundDecimal(totalInterest),
        totalFeesPaid: LoanCalculationUtils.roundDecimal(totalFees),
        averageMonthlyPayment:
          LoanCalculationUtils.roundDecimal(averagePayment),
      },
    };
  }

  calculatePenalty(
    overdueDays: number,
    overdueAmount: Decimal,
    penaltyRate: Decimal,
    penaltyType: PenaltyType
  ): PenaltyCalculationResult {
    let penaltyAmount = new Decimal(0);
    const calculationDate = new Date();

    switch (penaltyType) {
      case PenaltyType.FIXED_AMOUNT:
        penaltyAmount = penaltyRate;
        break;

      case PenaltyType.PERCENTAGE_OF_OVERDUE:
        // Simple interest penalty: Amount × Rate × Time
        const annualPenaltyRate = penaltyRate.div(100);
        const timeInYears = new Decimal(overdueDays).div(365);
        penaltyAmount = overdueAmount.mul(annualPenaltyRate).mul(timeInYears);
        break;

      case PenaltyType.PERCENTAGE_OF_INSTALLMENT:
        penaltyAmount = overdueAmount.mul(penaltyRate).div(100);
        break;

      case PenaltyType.COMPOUNDING_DAILY:
        // For simple interest loans, usually keep penalty simple
        const dailyRate = penaltyRate.div(100).div(365);
        penaltyAmount = overdueAmount.mul(dailyRate).mul(overdueDays);
        break;

      default:
        // Default to simple interest calculation
        const defaultRate = penaltyRate.div(100);
        const defaultTime = new Decimal(overdueDays).div(365);
        penaltyAmount = overdueAmount.mul(defaultRate).mul(defaultTime);
    }

    return {
      penaltyAmount: LoanCalculationUtils.roundDecimal(penaltyAmount),
      penaltyDays: overdueDays,
      penaltyRate,
      penaltyType,
      calculationDate,
    };
  }

  calculateEarlySettlement(
    originalCalculation: LoanCalculationResult,
    settlementDate: Date,
    paymentsMade: number
  ): EarlySettlementResult {
    const remainingInstallments =
      originalCalculation.repaymentSchedule.slice(paymentsMade);

    // Calculate remaining principal and interest
    const remainingPrincipal = remainingInstallments.reduce(
      (sum, installment) => sum.add(installment.principalAmount),
      new Decimal(0)
    );

    const remainingInterest = remainingInstallments.reduce(
      (sum, installment) => sum.add(installment.interestAmount),
      new Decimal(0)
    );

    // For simple interest, calculate actual interest owed based on time elapsed
    const totalInstallments = originalCalculation.summary.numberOfInstallments;
    const firstPaymentDate = originalCalculation.summary.firstPaymentDate;

    // Calculate actual time-based interest
    const daysFromStart = LoanCalculationUtils.daysBetween(
      firstPaymentDate,
      settlementDate
    );
    const totalDays = LoanCalculationUtils.daysBetween(
      firstPaymentDate,
      originalCalculation.summary.lastPaymentDate
    );

    // Proportional interest based on actual time
    const timeBasedInterestRatio = new Decimal(daysFromStart).div(totalDays);
    const actualInterestOwed = originalCalculation.totalInterest.mul(
      timeBasedInterestRatio
    );

    // Interest already paid
    const interestPaid = originalCalculation.repaymentSchedule
      .slice(0, paymentsMade)
      .reduce(
        (sum, installment) => sum.add(installment.interestAmount),
        new Decimal(0)
      );

    // Additional interest owed
    const additionalInterestOwed = actualInterestOwed.sub(interestPaid);

    // Rebate is the difference between scheduled remaining interest and actual interest owed
    const rebateAmount = remainingInterest.sub(additionalInterestOwed).gt(0)
      ? remainingInterest.sub(additionalInterestOwed)
      : new Decimal(0);

    // Settlement amount = remaining principal + additional interest owed
    const totalSettlementAmount = remainingPrincipal.add(
      additionalInterestOwed
    );

    // Calculate savings
    const originalRemainingPayments = remainingInstallments.reduce(
      (sum, installment) => sum.add(installment.totalAmount),
      new Decimal(0)
    );
    const savingsFromEarlySettlement = originalRemainingPayments.sub(
      totalSettlementAmount
    );

    return {
      settlementDate,
      remainingPrincipal: LoanCalculationUtils.roundDecimal(remainingPrincipal),
      remainingInterest: LoanCalculationUtils.roundDecimal(
        additionalInterestOwed
      ),
      rebateAmount: LoanCalculationUtils.roundDecimal(rebateAmount),
      penaltyAmount: new Decimal(0),
      totalSettlementAmount: LoanCalculationUtils.roundDecimal(
        totalSettlementAmount
      ),
      savingsFromEarlySettlement: LoanCalculationUtils.roundDecimal(
        savingsFromEarlySettlement
      ),
    };
  }
}
