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
 * Flat Rate (Add-On Interest) Calculation Strategy
 *
 * In this method, interest is calculated on the original principal amount
 * for the entire loan term, regardless of payments made. The total interest
 * is then added to the principal and divided by the number of installments.
 *
 * This method results in higher effective interest rates compared to reducing balance.
 *
 * Formula:
 * Total Interest = Principal × Rate × Time
 * EMI = (Principal + Total Interest) ÷ Number of Installments
 */
export class FlatRateStrategy implements ILoanCalculationStrategy {
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

    // Calculate number of payments
    const periodsPerYear =
      LoanCalculationUtils.getPeriodsPerYear(repaymentFrequency);
    const numberOfPayments = Math.ceil(
      (termInMonths * 12) / (12 / (periodsPerYear / 12))
    );

    // Calculate fees
    const processingFee = processingFeeAmount.add(
      principalAmount.mul(processingFeePercentage).div(100)
    );
    const insuranceFee = insuranceFeeAmount.add(
      principalAmount.mul(insuranceFeePercentage).div(100)
    );
    const totalFees = processingFee.add(insuranceFee);

    // Calculate total interest using flat rate method
    // Interest = Principal × Rate × Time (in years)
    const termInYears = new Decimal(termInMonths).div(12);
    const totalInterest = principalAmount
      .mul(annualInterestRate)
      .div(100)
      .mul(termInYears);

    // Calculate total amount to be repaid
    const totalRepaymentAmount = principalAmount.add(totalInterest);

    // Calculate equal installment amount (EMI)
    const installmentAmount = totalRepaymentAmount.div(numberOfPayments);

    // Calculate principal and interest per installment
    const principalPerInstallment = principalAmount.div(numberOfPayments);
    const interestPerInstallment = totalInterest.div(numberOfPayments);

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

      // For flat rate, principal and interest are constant per installment
      let principalAmount = principalPerInstallment;
      let interestAmount = interestPerInstallment;

      // Adjust for rounding in the last installment
      if (i === numberOfPayments) {
        principalAmount = remainingBalance;
        interestAmount = totalInterest.sub(cumulativeInterest);
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

    // Calculate effective interest rate (this is higher than stated rate in flat rate method)
    // Approximate effective rate = (2 × Stated Rate × Number of Payments) / (Number of Payments + 1)
    const approximateEffectiveRate = annualInterestRate
      .mul(2)
      .mul(numberOfPayments)
      .div(numberOfPayments + 1);

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
        approximateEffectiveRate
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
        penaltyAmount = overdueAmount.mul(penaltyRate).div(100);
        break;

      case PenaltyType.PERCENTAGE_OF_INSTALLMENT:
        penaltyAmount = overdueAmount.mul(penaltyRate).div(100);
        break;

      case PenaltyType.COMPOUNDING_DAILY:
        // For flat rate loans, penalty is usually simple
        const dailyPenaltyRate = penaltyRate.div(100).div(365);
        penaltyAmount = overdueAmount.mul(dailyPenaltyRate).mul(overdueDays);
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

    // For flat rate loans, the borrower has already been charged the full interest
    // Early settlement usually involves the 78th rule or rule of 78
    const totalInstallments = originalCalculation.summary.numberOfInstallments;
    const remainingInstallments_ = totalInstallments - paymentsMade;

    // Calculate remaining amounts
    const remainingPrincipal = remainingInstallments.reduce(
      (sum, installment) => sum.add(installment.principalAmount),
      new Decimal(0)
    );

    const remainingInterest = remainingInstallments.reduce(
      (sum, installment) => sum.add(installment.interestAmount),
      new Decimal(0)
    );

    // Apply Rule of 78 for interest rebate
    // Sum of digits for remaining periods
    const sumOfRemainingDigits =
      (remainingInstallments_ * (remainingInstallments_ + 1)) / 2;
    const sumOfAllDigits = (totalInstallments * (totalInstallments + 1)) / 2;

    const rebateRatio = new Decimal(sumOfRemainingDigits).div(sumOfAllDigits);
    const rebateAmount = remainingInterest.mul(rebateRatio);

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
