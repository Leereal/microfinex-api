import { Prisma } from '@prisma/client';

// Use Prisma.Decimal for types
type Decimal = Prisma.Decimal;

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
  /**
   * When the borrower has agreed to make the first payment.
   *
   * The schedule otherwise falls one full period after disbursement, which is
   * a sensible default but not what was arranged: an operator who set the first
   * payment for the 30th got a schedule dated a month after the application,
   * and a loan whose stated next due date disagreed with its own first
   * instalment. When supplied, every instalment is spaced from this date.
   */
  firstDueDate?: Date;
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
        return new Prisma.Decimal(annualRateNum / 365);
      case RepaymentFrequency.WEEKLY:
        return new Prisma.Decimal(annualRateNum / 52);
      case RepaymentFrequency.BIWEEKLY:
        return new Prisma.Decimal(annualRateNum / 26);
      case RepaymentFrequency.MONTHLY:
        return new Prisma.Decimal(annualRateNum / 12);
      case RepaymentFrequency.QUARTERLY:
        return new Prisma.Decimal(annualRateNum / 4);
      case RepaymentFrequency.SEMI_ANNUAL:
        return new Prisma.Decimal(annualRateNum / 2);
      case RepaymentFrequency.ANNUAL:
        return new Prisma.Decimal(annualRateNum);
      default:
        return new Prisma.Decimal(annualRateNum / 12);
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
        return LoanCalculationUtils.addMonths(date, periods);
      case RepaymentFrequency.QUARTERLY:
        return LoanCalculationUtils.addMonths(date, periods * 3);
      case RepaymentFrequency.SEMI_ANNUAL:
        return LoanCalculationUtils.addMonths(date, periods * 6);
      case RepaymentFrequency.ANNUAL:
        return LoanCalculationUtils.addMonths(date, periods * 12);
    }

    return newDate;
  }

  /**
   * Add whole months, clamping to the last day of the target month.
   *
   * `Date.setMonth` overflows rather than clamping: 31 January plus one month
   * yields 3 March, and plus three months yields 1 May. For a repayment
   * schedule that silently shifts due dates into the following month and, for
   * a loan disbursed on the 31st, makes instalments drift further apart every
   * short month. Lending convention is to fall due on the last day of the
   * month instead.
   */
  static addMonths(date: Date, months: number): Date {
    const month = date.getMonth();
    const day = date.getDate();

    // Anchor to the 1st before shifting the month, so the shift itself cannot
    // overflow, then clamp the day to the target month's length.
    const result = new Date(date);
    result.setDate(1);
    result.setMonth(month + months);

    // Day 0 of the following month is the last day of the target month.
    const daysInTargetMonth = new Date(
      result.getFullYear(),
      result.getMonth() + 1,
      0
    ).getDate();

    result.setDate(Math.min(day, daysInTargetMonth));

    return result;
  }

  /**
   * Round to specified decimal places
   */
  static roundDecimal(value: Decimal, places: number = 2): Decimal {
    return value.toDecimalPlaces(places);
  }

  /**
   * Date on which the first instalment falls due.
   *
   * A loan disbursed today is not repayable today: the borrower gets one full
   * repayment period (plus any grace days) before the first instalment. The
   * schedule therefore starts one period after disbursement, and instalment
   * `n` falls `n` periods out.
   */
  static getFirstDueDate(
    disbursementDate: Date,
    gracePeriodDays: number,
    frequency: RepaymentFrequency,
    firstDueDate?: Date
  ): Date {
    if (firstDueDate) return new Date(firstDueDate);

    const start = new Date(disbursementDate);
    if (gracePeriodDays > 0) {
      start.setDate(start.getDate() + gracePeriodDays);
    }
    return LoanCalculationUtils.addPeriod(start, 1, frequency);
  }

  /**
   * Due date for instalment `installmentNumber` (1-based).
   */
  static getInstallmentDueDate(
    disbursementDate: Date,
    gracePeriodDays: number,
    frequency: RepaymentFrequency,
    installmentNumber: number,
    firstDueDate?: Date
  ): Date {
    // An agreed first payment date anchors the whole schedule: instalment 1
    // falls on it, and the rest follow at one period each.
    if (firstDueDate) {
      return LoanCalculationUtils.addPeriod(
        new Date(firstDueDate),
        installmentNumber - 1,
        frequency
      );
    }

    const start = new Date(disbursementDate);
    if (gracePeriodDays > 0) {
      start.setDate(start.getDate() + gracePeriodDays);
    }
    return LoanCalculationUtils.addPeriod(start, installmentNumber, frequency);
  }

  /**
   * Annual Percentage Rate, derived from the actual cash flows.
   *
   * APR is the annualised rate that discounts the repayment schedule back to
   * the amount the borrower actually received. It is NOT
   * `totalAmount / principal - 1`: that ratio ignores the term entirely, so a
   * three-year loan and a one-year loan with the same total cost report the
   * same figure, overstating the annual rate by roughly the number of years.
   *
   * The periodic internal rate of return is found by bisection (robust for
   * ordinary loan cash flows, which cross zero exactly once) and then scaled
   * to a nominal annual rate, the convention used for consumer credit
   * disclosure.
   *
   * @param amountAdvanced What the borrower receives - principal less any fee
   *                       deducted at disbursement.
   * @param payments       Each instalment's total outflow, in order.
   */
  static calculateAPR(
    amountAdvanced: Decimal,
    payments: Decimal[],
    frequency: RepaymentFrequency
  ): Decimal {
    const advanced = parseFloat(amountAdvanced.toString());
    const flows = payments.map(p => parseFloat(p.toString()));

    if (advanced <= 0 || flows.length === 0) {
      return new Prisma.Decimal(0);
    }

    const totalRepaid = flows.reduce((sum, p) => sum + p, 0);
    if (totalRepaid <= advanced) {
      return new Prisma.Decimal(0);
    }

    // Present value of the schedule at a given periodic rate, less what was
    // advanced. Monotonically decreasing in `rate`, so bisection converges.
    const netPresentValue = (rate: number): number => {
      let pv = 0;
      for (let i = 0; i < flows.length; i++) {
        pv += (flows[i] ?? 0) / Math.pow(1 + rate, i + 1);
      }
      return pv - advanced;
    };

    let low = 0;
    let high = 1; // 100% per period - far above any legitimate loan

    // Expand the bracket if the rate is extraordinarily high.
    let guard = 0;
    while (netPresentValue(high) > 0 && guard < 20) {
      high *= 2;
      guard++;
    }

    for (let i = 0; i < 200; i++) {
      const mid = (low + high) / 2;
      const npv = netPresentValue(mid);
      if (Math.abs(npv) < 1e-9) {
        low = mid;
        break;
      }
      if (npv > 0) {
        low = mid;
      } else {
        high = mid;
      }
    }

    const periodicRate = (low + high) / 2;
    const periodsPerYear = LoanCalculationUtils.getPeriodsPerYear(frequency);

    return new Prisma.Decimal(periodicRate * periodsPerYear * 100);
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
    return new Prisma.Decimal(amount);
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
    return new Prisma.Decimal(pv);
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
    return new Prisma.Decimal(payment);
  }
}

export default {
  LoanCalculationMethod,
  RepaymentFrequency,
  InterestBasis,
  PenaltyType,
  LoanCalculationUtils,
};
