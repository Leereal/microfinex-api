import { Decimal } from '@prisma/client/runtime/library';

// Loan calculation method types
export enum LoanCalculationMethod {
  FLAT_RATE = 'FLAT_RATE',
  REDUCING_BALANCE = 'REDUCING_BALANCE',
  SIMPLE_INTEREST = 'SIMPLE_INTEREST',
  COMPOUND_INTEREST = 'COMPOUND_INTEREST',
  ANNUITY = 'ANNUITY',
  BALLOON_PAYMENT = 'BALLOON_PAYMENT',
  CUSTOM_FORMULA = 'CUSTOM_FORMULA',
}

// Repayment frequency options
export enum RepaymentFrequency {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  BIWEEKLY = 'BIWEEKLY',
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  SEMI_ANNUAL = 'SEMI_ANNUAL',
  ANNUAL = 'ANNUAL',
}

// Interest calculation basis
export enum InterestBasis {
  ACTUAL_365 = 'ACTUAL_365',
  ACTUAL_360 = 'ACTUAL_360',
  THIRTY_360 = 'THIRTY_360',
}

// Penalty calculation types
export enum PenaltyType {
  FIXED_AMOUNT = 'FIXED_AMOUNT',
  PERCENTAGE_OF_OVERDUE = 'PERCENTAGE_OF_OVERDUE',
  PERCENTAGE_OF_INSTALLMENT = 'PERCENTAGE_OF_INSTALLMENT',
  COMPOUNDING_DAILY = 'COMPOUNDING_DAILY',
}

// Input parameters for loan calculation
export interface LoanCalculationInput {
  principalAmount: Decimal;
  annualInterestRate: Decimal; // As percentage (e.g., 12.5 for 12.5%)
  termInMonths: number;
  repaymentFrequency: RepaymentFrequency;
  calculationMethod: LoanCalculationMethod;
  gracePeriodDays?: number;
  processingFeeAmount?: Decimal;
  processingFeePercentage?: Decimal;
  insuranceFeeAmount?: Decimal;
  insuranceFeePercentage?: Decimal;
  penaltyRate?: Decimal;
  penaltyType?: PenaltyType;
  interestBasis?: InterestBasis;
  balloonAmount?: Decimal; // For balloon payment loans
  customFormula?: string; // For custom calculation methods
  disbursementDate?: Date;
}

// Individual installment details
export interface LoanInstallment {
  installmentNumber: number;
  dueDate: Date;
  principalAmount: Decimal;
  interestAmount: Decimal;
  feesAmount: Decimal;
  totalAmount: Decimal;
  remainingBalance: Decimal;
  cumulativePrincipal: Decimal;
  cumulativeInterest: Decimal;
}

// Complete loan calculation result
export interface LoanCalculationResult {
  principalAmount: Decimal;
  totalInterest: Decimal;
  totalFees: Decimal;
  totalAmount: Decimal;
  monthlyInstallment: Decimal;
  effectiveInterestRate: Decimal;
  apr: Decimal; // Annual Percentage Rate including fees
  repaymentSchedule: LoanInstallment[];
  calculationMethod: LoanCalculationMethod;
  summary: {
    numberOfInstallments: number;
    firstPaymentDate: Date;
    lastPaymentDate: Date;
    totalInterestPaid: Decimal;
    totalFeesPaid: Decimal;
    averageMonthlyPayment: Decimal;
  };
}

// Penalty calculation result
export interface PenaltyCalculationResult {
  penaltyAmount: Decimal;
  penaltyDays: number;
  penaltyRate: Decimal;
  penaltyType: PenaltyType;
  calculationDate: Date;
}

// Early settlement calculation
export interface EarlySettlementResult {
  settlementDate: Date;
  remainingPrincipal: Decimal;
  remainingInterest: Decimal;
  rebateAmount: Decimal; // Interest rebate for early settlement
  penaltyAmount: Decimal;
  totalSettlementAmount: Decimal;
  savingsFromEarlySettlement: Decimal;
}

// Loan restructuring options
export interface LoanRestructureOptions {
  newTermInMonths?: number;
  newInterestRate?: Decimal;
  newRepaymentFrequency?: RepaymentFrequency;
  additionalAmount?: Decimal; // Additional loan amount
  moratoriumPeriod?: number; // Payment holiday in months
  newCalculationMethod?: LoanCalculationMethod;
}

// Loan restructuring result
export interface LoanRestructureResult {
  originalLoan: LoanCalculationResult;
  restructuredLoan: LoanCalculationResult;
  restructureCost: Decimal;
  totalSavings: Decimal;
  newInstallmentAmount: Decimal;
  extensionMonths: number;
}

// Base interface for all calculation strategies
export interface ILoanCalculationStrategy {
  calculateLoan(input: LoanCalculationInput): LoanCalculationResult;
  calculatePenalty(
    overdueDays: number,
    overdueAmount: Decimal,
    penaltyRate: Decimal,
    penaltyType: PenaltyType
  ): PenaltyCalculationResult;
  calculateEarlySettlement(
    originalCalculation: LoanCalculationResult,
    settlementDate: Date,
    paymentsMade: number
  ): EarlySettlementResult;
}

// Utility functions for common calculations
export class LoanCalculationUtils {
  /**
   * Convert annual interest rate to periodic rate
   */
  static getPeriodicRate(
    annualRate: Decimal,
    frequency: RepaymentFrequency
  ): Decimal {
    const annualRateNum = parseFloat(annualRate.toString()) / 100;

    switch (frequency) {
      case RepaymentFrequency.DAILY:
        return new Decimal(annualRateNum / 365);
      case RepaymentFrequency.WEEKLY:
        return new Decimal(annualRateNum / 52);
      case RepaymentFrequency.BIWEEKLY:
        return new Decimal(annualRateNum / 26);
      case RepaymentFrequency.MONTHLY:
        return new Decimal(annualRateNum / 12);
      case RepaymentFrequency.QUARTERLY:
        return new Decimal(annualRateNum / 4);
      case RepaymentFrequency.SEMI_ANNUAL:
        return new Decimal(annualRateNum / 2);
      case RepaymentFrequency.ANNUAL:
        return new Decimal(annualRateNum);
      default:
        return new Decimal(annualRateNum / 12);
    }
  }

  /**
   * Get number of periods per year
   */
  static getPeriodsPerYear(frequency: RepaymentFrequency): number {
    switch (frequency) {
      case RepaymentFrequency.DAILY:
        return 365;
      case RepaymentFrequency.WEEKLY:
        return 52;
      case RepaymentFrequency.BIWEEKLY:
        return 26;
      case RepaymentFrequency.MONTHLY:
        return 12;
      case RepaymentFrequency.QUARTERLY:
        return 4;
      case RepaymentFrequency.SEMI_ANNUAL:
        return 2;
      case RepaymentFrequency.ANNUAL:
        return 1;
      default:
        return 12;
    }
  }

  /**
   * Calculate days between two dates
   */
  static daysBetween(startDate: Date, endDate: Date): number {
    const timeDiff = endDate.getTime() - startDate.getTime();
    return Math.ceil(timeDiff / (1000 * 3600 * 24));
  }

  /**
   * Add period to date based on frequency
   */
  static addPeriod(
    date: Date,
    periods: number,
    frequency: RepaymentFrequency
  ): Date {
    const newDate = new Date(date);

    switch (frequency) {
      case RepaymentFrequency.DAILY:
        newDate.setDate(newDate.getDate() + periods);
        break;
      case RepaymentFrequency.WEEKLY:
        newDate.setDate(newDate.getDate() + periods * 7);
        break;
      case RepaymentFrequency.BIWEEKLY:
        newDate.setDate(newDate.getDate() + periods * 14);
        break;
      case RepaymentFrequency.MONTHLY:
        newDate.setMonth(newDate.getMonth() + periods);
        break;
      case RepaymentFrequency.QUARTERLY:
        newDate.setMonth(newDate.getMonth() + periods * 3);
        break;
      case RepaymentFrequency.SEMI_ANNUAL:
        newDate.setMonth(newDate.getMonth() + periods * 6);
        break;
      case RepaymentFrequency.ANNUAL:
        newDate.setFullYear(newDate.getFullYear() + periods);
        break;
    }

    return newDate;
  }

  /**
   * Round to specified decimal places
   */
  static roundDecimal(value: Decimal, places: number = 2): Decimal {
    return value.toDecimalPlaces(places);
  }

  /**
   * Calculate compound interest
   */
  static compoundInterest(
    principal: Decimal,
    rate: Decimal,
    time: number,
    compoundingFrequency: number = 12
  ): Decimal {
    const rateDecimal = parseFloat(rate.toString()) / 100;
    const amount =
      parseFloat(principal.toString()) *
      Math.pow(
        1 + rateDecimal / compoundingFrequency,
        compoundingFrequency * time
      );
    return new Decimal(amount);
  }

  /**
   * Calculate present value of annuity
   */
  static presentValueOfAnnuity(
    payment: Decimal,
    rate: Decimal,
    periods: number
  ): Decimal {
    const rateNum = parseFloat(rate.toString());
    if (rateNum === 0) {
      return payment.mul(periods);
    }

    const pv =
      (parseFloat(payment.toString()) * (1 - Math.pow(1 + rateNum, -periods))) /
      rateNum;
    return new Decimal(pv);
  }

  /**
   * Calculate payment for annuity
   */
  static annuityPayment(
    principal: Decimal,
    rate: Decimal,
    periods: number
  ): Decimal {
    const rateNum = parseFloat(rate.toString());
    if (rateNum === 0) {
      return principal.div(periods);
    }

    const payment =
      (parseFloat(principal.toString()) *
        (rateNum * Math.pow(1 + rateNum, periods))) /
      (Math.pow(1 + rateNum, periods) - 1);
    return new Decimal(payment);
  }
}

export default {
  LoanCalculationMethod,
  RepaymentFrequency,
  InterestBasis,
  PenaltyType,
  LoanCalculationUtils,
};
