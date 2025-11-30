import { Prisma } from '@prisma/client';
type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;
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
 * Reducing Balance (Diminishing Balance) Calculation Strategy
 *
 * This is the most common method where interest is calculated only on the
 * outstanding principal balance. As payments are made, the principal reduces,
 * and subsequent interest calculations are based on the remaining balance.
 *
 * Formula: EMI = P * r * (1+r)^n / ((1+r)^n - 1)
 * Where: P = Principal, r = Monthly interest rate, n = Number of installments
 */
export class ReducingBalanceStrategy implements ILoanCalculationStrategy {
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

    // Calculate periodic interest rate
    const periodsPerYear =
      LoanCalculationUtils.getPeriodsPerYear(repaymentFrequency);
    const numberOfPayments = Math.ceil(
      (termInMonths * 12) / (12 / (periodsPerYear / 12))
    );
    const periodicRate = LoanCalculationUtils.getPeriodicRate(
      annualInterestRate,
      repaymentFrequency
    );

    // Calculate fees
    const processingFee = processingFeeAmount.add(
      principalAmount.mul(processingFeePercentage).div(100)
    );
    const insuranceFee = insuranceFeeAmount.add(
      principalAmount.mul(insuranceFeePercentage).div(100)
    );
    const totalFees = processingFee.add(insuranceFee);

    // Calculate EMI using reducing balance formula
    const periodicRateNum = parseFloat(periodicRate.toString());
    let emi: Decimal;

    if (periodicRateNum === 0) {
      // If interest rate is 0, EMI is simply principal divided by number of payments
      emi = principalAmount.div(numberOfPayments);
    } else {
      // Standard EMI formula
      const numerator = principalAmount
        .mul(periodicRate)
        .mul(new Decimal(Math.pow(1 + periodicRateNum, numberOfPayments)));
      const denominator = new Decimal(
        Math.pow(1 + periodicRateNum, numberOfPayments)
      ).sub(1);
      emi = numerator.div(denominator);
    }

    // Round EMI to 2 decimal places
    emi = LoanCalculationUtils.roundDecimal(emi, 2);

    // Generate repayment schedule
    const repaymentSchedule: LoanInstallment[] = [];
    let remainingBalance = principalAmount;
    let cumulativePrincipal = new Decimal(0);
    let cumulativeInterest = new Decimal(0);
    let totalInterest = new Decimal(0);

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

      // Calculate interest for this period
      const interestAmount = remainingBalance.mul(periodicRate);

      // Calculate principal for this period
      let principalAmount: Decimal;
      if (i === numberOfPayments) {
        // Last payment: pay remaining balance
        principalAmount = remainingBalance;
      } else {
        principalAmount = emi.sub(interestAmount);
      }

      // Ensure principal is not negative
      if (principalAmount.lt(0)) {
        principalAmount = new Decimal(0);
      }

      // Calculate fees (usually applied to first installment)
      const feesAmount = i === 1 ? totalFees : new Decimal(0);

      // Total amount for this installment
      const installmentTotal = principalAmount
        .add(interestAmount)
        .add(feesAmount);

      // Update balances
      remainingBalance = remainingBalance.sub(principalAmount);
      cumulativePrincipal = cumulativePrincipal.add(principalAmount);
      cumulativeInterest = cumulativeInterest.add(interestAmount);
      totalInterest = totalInterest.add(interestAmount);

      // Add to schedule
      repaymentSchedule.push({
        installmentNumber: i,
        dueDate,
        principalAmount: LoanCalculationUtils.roundDecimal(principalAmount),
        interestAmount: LoanCalculationUtils.roundDecimal(interestAmount),
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

    // Calculate effective interest rate (APR)
    const effectiveRate = totalInterest.div(principalAmount).mul(100);
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
      monthlyInstallment: LoanCalculationUtils.roundDecimal(emi),
      effectiveInterestRate: LoanCalculationUtils.roundDecimal(effectiveRate),
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
        penaltyAmount = penaltyRate; // penaltyRate is the fixed amount
        break;

      case PenaltyType.PERCENTAGE_OF_OVERDUE:
        penaltyAmount = overdueAmount.mul(penaltyRate).div(100);
        break;

      case PenaltyType.PERCENTAGE_OF_INSTALLMENT:
        penaltyAmount = overdueAmount.mul(penaltyRate).div(100);
        break;

      case PenaltyType.COMPOUNDING_DAILY:
        // Compound daily penalty = overdueAmount * (1 + dailyRate)^days - overdueAmount
        const dailyRate = penaltyRate.div(100).div(365);
        const compoundFactor = new Decimal(
          Math.pow(1 + parseFloat(dailyRate.toString()), overdueDays)
        );
        penaltyAmount = overdueAmount.mul(compoundFactor).sub(overdueAmount);
        break;

      default:
        penaltyAmount = overdueAmount.mul(penaltyRate).div(100);
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

    // Calculate rebate (usually 78th rule or actuarial method)
    // Using simple proportional rebate for this example
    const totalTerm = originalCalculation.summary.numberOfInstallments;
    const remainingTerm = totalTerm - paymentsMade;
    const rebatePercentage = new Decimal(remainingTerm).div(totalTerm);
    const rebateAmount = remainingInterest.mul(rebatePercentage).mul(0.8); // 80% rebate

    // Settlement amount = remaining principal + remaining interest - rebate
    const totalSettlementAmount = remainingPrincipal
      .add(remainingInterest)
      .sub(rebateAmount);

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
      remainingInterest: LoanCalculationUtils.roundDecimal(remainingInterest),
      rebateAmount: LoanCalculationUtils.roundDecimal(rebateAmount),
      penaltyAmount: new Decimal(0), // No penalty for early settlement
      totalSettlementAmount: LoanCalculationUtils.roundDecimal(
        totalSettlementAmount
      ),
      savingsFromEarlySettlement: LoanCalculationUtils.roundDecimal(
        savingsFromEarlySettlement
      ),
    };
  }
}
