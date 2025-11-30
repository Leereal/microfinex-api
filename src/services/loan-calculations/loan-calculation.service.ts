import { Prisma } from '@prisma/client';
type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;
import {
  ILoanCalculationStrategy,
  LoanCalculationInput,
  LoanCalculationResult,
  LoanCalculationMethod,
  PenaltyCalculationResult,
  EarlySettlementResult,
  LoanRestructureOptions,
  LoanRestructureResult,
  PenaltyType,
} from './types';
import { ReducingBalanceStrategy } from './reducing-balance-strategy';
import { FlatRateStrategy } from './flat-rate-strategy';
import { SimpleInterestStrategy } from './simple-interest-strategy';

/**
 * Main Loan Calculation Service
 *
 * This service implements the Strategy Pattern to provide flexible loan calculations.
 * It allows users to choose different calculation methods and handles complex
 * scenarios like penalties, early settlements, and loan restructuring.
 */
export class LoanCalculationService {
  private strategies: Map<LoanCalculationMethod, ILoanCalculationStrategy>;

  constructor() {
    this.strategies = new Map();
    this.initializeStrategies();
  }

  /**
   * Initialize all available calculation strategies
   */
  private initializeStrategies(): void {
    this.strategies.set(
      LoanCalculationMethod.REDUCING_BALANCE,
      new ReducingBalanceStrategy()
    );
    this.strategies.set(
      LoanCalculationMethod.FLAT_RATE,
      new FlatRateStrategy()
    );
    this.strategies.set(
      LoanCalculationMethod.SIMPLE_INTEREST,
      new SimpleInterestStrategy()
    );

    // TODO: Implement additional strategies
    // this.strategies.set(LoanCalculationMethod.COMPOUND_INTEREST, new CompoundInterestStrategy());
    // this.strategies.set(LoanCalculationMethod.ANNUITY, new AnnuityStrategy());
    // this.strategies.set(LoanCalculationMethod.BALLOON_PAYMENT, new BalloonPaymentStrategy());
    // this.strategies.set(LoanCalculationMethod.CUSTOM_FORMULA, new CustomFormulaStrategy());
  }

  /**
   * Calculate loan using specified method
   */
  public calculateLoan(input: LoanCalculationInput): LoanCalculationResult {
    const strategy = this.getStrategy(input.calculationMethod);

    // Validate input
    this.validateLoanInput(input);

    return strategy.calculateLoan(input);
  }

  /**
   * Compare multiple calculation methods for the same loan
   */
  public compareLoanMethods(
    baseInput: Omit<LoanCalculationInput, 'calculationMethod'>,
    methods: LoanCalculationMethod[]
  ): Map<LoanCalculationMethod, LoanCalculationResult> {
    const results = new Map<LoanCalculationMethod, LoanCalculationResult>();

    for (const method of methods) {
      try {
        const input: LoanCalculationInput = {
          ...baseInput,
          calculationMethod: method,
        };
        const result = this.calculateLoan(input);
        results.set(method, result);
      } catch (error) {
        console.error(`Error calculating loan with method ${method}:`, error);
        // Continue with other methods
      }
    }

    return results;
  }

  /**
   * Calculate penalty for overdue payments
   */
  public calculatePenalty(
    calculationMethod: LoanCalculationMethod,
    overdueDays: number,
    overdueAmount: Decimal,
    penaltyRate: Decimal,
    penaltyType: PenaltyType = PenaltyType.PERCENTAGE_OF_OVERDUE
  ): PenaltyCalculationResult {
    const strategy = this.getStrategy(calculationMethod);
    return strategy.calculatePenalty(
      overdueDays,
      overdueAmount,
      penaltyRate,
      penaltyType
    );
  }

  /**
   * Calculate early settlement amount
   */
  public calculateEarlySettlement(
    originalCalculation: LoanCalculationResult,
    settlementDate: Date,
    paymentsMade: number
  ): EarlySettlementResult {
    const strategy = this.getStrategy(originalCalculation.calculationMethod);
    return strategy.calculateEarlySettlement(
      originalCalculation,
      settlementDate,
      paymentsMade
    );
  }

  /**
   * Calculate loan restructuring options
   */
  public calculateLoanRestructure(
    originalCalculation: LoanCalculationResult,
    restructureOptions: LoanRestructureOptions,
    paymentsMade: number
  ): LoanRestructureResult {
    // Calculate current outstanding balance
    const remainingInstallments =
      originalCalculation.repaymentSchedule.slice(paymentsMade);
    const outstandingPrincipal = remainingInstallments.reduce(
      (sum, installment) => sum.add(installment.principalAmount),
      new Decimal(0)
    );

    // Create new loan calculation input based on restructure options
    const newInput: LoanCalculationInput = {
      principalAmount: outstandingPrincipal.add(
        restructureOptions.additionalAmount || new Decimal(0)
      ),
      annualInterestRate: restructureOptions.newInterestRate || new Decimal(12), // Default rate
      termInMonths:
        restructureOptions.newTermInMonths ||
        originalCalculation.summary.numberOfInstallments - paymentsMade,
      repaymentFrequency:
        restructureOptions.newRepaymentFrequency || ('MONTHLY' as any),
      calculationMethod:
        restructureOptions.newCalculationMethod ||
        originalCalculation.calculationMethod,
      gracePeriodDays: restructureOptions.moratoriumPeriod
        ? restructureOptions.moratoriumPeriod * 30
        : 0,
    };

    // Calculate new loan
    const restructuredLoan = this.calculateLoan(newInput);

    // Calculate restructure costs and savings
    const originalRemainingPayments = remainingInstallments.reduce(
      (sum, installment) => sum.add(installment.totalAmount),
      new Decimal(0)
    );

    const newTotalPayments = restructuredLoan.repaymentSchedule.reduce(
      (sum, installment) => sum.add(installment.totalAmount),
      new Decimal(0)
    );

    const restructureCost = new Decimal(0); // Could include processing fees
    const totalSavings = originalRemainingPayments
      .sub(newTotalPayments)
      .sub(restructureCost);
    const extensionMonths =
      restructuredLoan.summary.numberOfInstallments -
      remainingInstallments.length;

    return {
      originalLoan: originalCalculation,
      restructuredLoan,
      restructureCost,
      totalSavings,
      newInstallmentAmount: restructuredLoan.monthlyInstallment,
      extensionMonths,
    };
  }

  /**
   * Calculate amortization table with actual payments
   */
  public calculateAmortizationWithPayments(
    originalCalculation: LoanCalculationResult,
    actualPayments: Array<{
      paymentDate: Date;
      amount: Decimal;
      principalAmount?: Decimal;
      interestAmount?: Decimal;
    }>
  ): LoanCalculationResult {
    // Create a copy of the original schedule
    const updatedSchedule = [...originalCalculation.repaymentSchedule];
    let remainingBalance = originalCalculation.principalAmount;
    let totalInterestPaid = new Decimal(0);
    let totalPrincipalPaid = new Decimal(0);

    // Process actual payments
    for (const payment of actualPayments) {
      // Find the corresponding installment or create adjustment
      const paymentPrincipal = payment.principalAmount || new Decimal(0);
      const paymentInterest = payment.interestAmount || new Decimal(0);

      remainingBalance = remainingBalance.sub(paymentPrincipal);
      totalPrincipalPaid = totalPrincipalPaid.add(paymentPrincipal);
      totalInterestPaid = totalInterestPaid.add(paymentInterest);
    }

    // Update the calculation result with actual payment data
    return {
      ...originalCalculation,
      repaymentSchedule: updatedSchedule,
      summary: {
        ...originalCalculation.summary,
        totalInterestPaid,
      },
    };
  }

  /**
   * Get available calculation methods
   */
  public getAvailableMethods(): LoanCalculationMethod[] {
    return Array.from(this.strategies.keys());
  }

  /**
   * Get strategy for specific calculation method
   */
  private getStrategy(method: LoanCalculationMethod): ILoanCalculationStrategy {
    const strategy = this.strategies.get(method);
    if (!strategy) {
      throw new Error(`Calculation method ${method} is not supported`);
    }
    return strategy;
  }

  /**
   * Validate loan input parameters
   */
  private validateLoanInput(input: LoanCalculationInput): void {
    if (input.principalAmount.lte(0)) {
      throw new Error('Principal amount must be greater than 0');
    }

    if (input.annualInterestRate.lt(0)) {
      throw new Error('Interest rate cannot be negative');
    }

    if (input.termInMonths <= 0) {
      throw new Error('Loan term must be greater than 0');
    }

    if (input.gracePeriodDays && input.gracePeriodDays < 0) {
      throw new Error('Grace period cannot be negative');
    }

    // Additional validations based on calculation method
    if (input.calculationMethod === LoanCalculationMethod.BALLOON_PAYMENT) {
      if (!input.balloonAmount || input.balloonAmount.lte(0)) {
        throw new Error('Balloon amount is required for balloon payment loans');
      }
    }

    if (input.calculationMethod === LoanCalculationMethod.CUSTOM_FORMULA) {
      if (!input.customFormula || input.customFormula.trim() === '') {
        throw new Error(
          'Custom formula is required for custom calculation method'
        );
      }
    }
  }

  /**
   * Calculate effective annual rate (EAR) from APR
   */
  public calculateEffectiveAnnualRate(
    apr: Decimal,
    compoundingPeriodsPerYear: number
  ): Decimal {
    const aprDecimal = parseFloat(apr.toString()) / 100;
    const ear =
      Math.pow(
        1 + aprDecimal / compoundingPeriodsPerYear,
        compoundingPeriodsPerYear
      ) - 1;
    return new Decimal(ear * 100);
  }

  /**
   * Calculate debt-to-income ratio impact
   */
  public calculateAffordability(
    monthlyIncome: Decimal,
    existingMonthlyDebts: Decimal,
    proposedLoanPayment: Decimal,
    maxDebtToIncomeRatio: Decimal = new Decimal(40) // 40% default
  ): {
    currentDebtToIncomeRatio: Decimal;
    newDebtToIncomeRatio: Decimal;
    isAffordable: boolean;
    availableCapacity: Decimal;
  } {
    const currentDebtToIncomeRatio = existingMonthlyDebts
      .div(monthlyIncome)
      .mul(100);
    const newDebtToIncomeRatio = existingMonthlyDebts
      .add(proposedLoanPayment)
      .div(monthlyIncome)
      .mul(100);
    const isAffordable = newDebtToIncomeRatio.lte(maxDebtToIncomeRatio);
    const availableCapacity = monthlyIncome
      .mul(maxDebtToIncomeRatio.div(100))
      .sub(existingMonthlyDebts);

    return {
      currentDebtToIncomeRatio,
      newDebtToIncomeRatio,
      isAffordable,
      availableCapacity: availableCapacity.gt(0)
        ? availableCapacity
        : new Decimal(0),
    };
  }
}

// Export singleton instance
export const loanCalculationService = new LoanCalculationService();
export default loanCalculationService;
