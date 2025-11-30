import { Router } from 'express';
import { Prisma } from '@prisma/client';
const Decimal = Prisma.Decimal;
import {
  loanCalculationService,
  LoanCalculationMethod,
  RepaymentFrequency,
  LoanCalculationInput,
} from '../services/loan-calculations';

const router = Router();

/**
 * Demo endpoint to showcase different loan calculation methods
 */
router.get('/demo-calculations', async (req, res) => {
  try {
    // Example loan parameters
    const principalAmount = new Decimal(100000); // $100,000 loan
    const annualInterestRate = new Decimal(12); // 12% annual interest
    const termInMonths = 24; // 2 years
    const repaymentFrequency = RepaymentFrequency.MONTHLY;

    // Calculate using different methods
    const methods: LoanCalculationMethod[] = [
      LoanCalculationMethod.REDUCING_BALANCE,
      LoanCalculationMethod.FLAT_RATE,
      LoanCalculationMethod.SIMPLE_INTEREST,
    ];

    const baseInput = {
      principalAmount,
      annualInterestRate,
      termInMonths,
      repaymentFrequency,
      processingFeeAmount: new Decimal(1000), // $1,000 processing fee
      gracePeriodDays: 7, // 7-day grace period
    };

    const comparisons = loanCalculationService.compareLoanMethods(
      baseInput,
      methods
    );

    // Format results for display
    const results = Array.from(comparisons.entries()).map(
      ([method, calculation]) => ({
        method,
        summary: {
          principalAmount: calculation.principalAmount.toNumber(),
          totalInterest: calculation.totalInterest.toNumber(),
          totalFees: calculation.totalFees.toNumber(),
          totalAmount: calculation.totalAmount.toNumber(),
          monthlyInstallment: calculation.monthlyInstallment.toNumber(),
          effectiveInterestRate: calculation.effectiveInterestRate.toNumber(),
          apr: calculation.apr.toNumber(),
          numberOfInstallments: calculation.summary.numberOfInstallments,
          totalInterestPaid: calculation.summary.totalInterestPaid.toNumber(),
          averageMonthlyPayment:
            calculation.summary.averageMonthlyPayment.toNumber(),
        },
        // Include first 3 installments as example
        sampleInstallments: calculation.repaymentSchedule
          .slice(0, 3)
          .map(installment => ({
            installmentNumber: installment.installmentNumber,
            dueDate: installment.dueDate,
            principalAmount: installment.principalAmount.toNumber(),
            interestAmount: installment.interestAmount.toNumber(),
            totalAmount: installment.totalAmount.toNumber(),
            remainingBalance: installment.remainingBalance.toNumber(),
          })),
      })
    );

    // Calculate affordability example
    const firstResult = results[0];
    const affordability = firstResult
      ? loanCalculationService.calculateAffordability(
          new Decimal(5000), // $5,000 monthly income
          new Decimal(1500), // $1,500 existing monthly debts
          new Decimal(firstResult.summary.monthlyInstallment) // Proposed loan payment
        )
      : null;

    res.json({
      success: true,
      message: 'Loan calculation demo completed',
      data: {
        loanParameters: {
          principalAmount: principalAmount.toNumber(),
          annualInterestRate: annualInterestRate.toNumber(),
          termInMonths,
          repaymentFrequency,
          processingFee: 1000,
          gracePeriodDays: 7,
        },
        calculationComparisons: results,
        affordabilityAnalysis:
          firstResult && affordability
            ? {
                monthlyIncome: 5000,
                existingMonthlyDebts: 1500,
                proposedLoanPayment: firstResult.summary.monthlyInstallment,
                currentDebtToIncomeRatio:
                  affordability.currentDebtToIncomeRatio.toNumber(),
                newDebtToIncomeRatio:
                  affordability.newDebtToIncomeRatio.toNumber(),
                isAffordable: affordability.isAffordable,
                availableCapacity: affordability.availableCapacity.toNumber(),
              }
            : null,
        explanations: {
          reducingBalance:
            'Most common method - interest calculated on outstanding balance only',
          flatRate:
            'Interest calculated on original principal for entire term (higher effective rate)',
          simpleInterest:
            'Interest = Principal × Rate × Time (straightforward calculation)',
          note: 'Compare the total interest and monthly payments to see the difference between methods',
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Demo calculation error:', error);
    res.status(500).json({
      success: false,
      message:
        error instanceof Error ? error.message : 'Demo calculation failed',
      error: 'DEMO_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * Calculate penalty example
 */
router.get('/demo-penalty', async (req, res) => {
  try {
    const overdueDays = 30;
    const overdueAmount = new Decimal(5000);
    const penaltyRate = new Decimal(2); // 2% penalty rate

    const penalties = [
      {
        type: 'PERCENTAGE_OF_OVERDUE',
        result: loanCalculationService.calculatePenalty(
          LoanCalculationMethod.REDUCING_BALANCE,
          overdueDays,
          overdueAmount,
          penaltyRate,
          'PERCENTAGE_OF_OVERDUE' as any
        ),
      },
      {
        type: 'COMPOUNDING_DAILY',
        result: loanCalculationService.calculatePenalty(
          LoanCalculationMethod.REDUCING_BALANCE,
          overdueDays,
          overdueAmount,
          penaltyRate,
          'COMPOUNDING_DAILY' as any
        ),
      },
    ];

    res.json({
      success: true,
      message: 'Penalty calculation demo completed',
      data: {
        parameters: {
          overdueDays,
          overdueAmount: overdueAmount.toNumber(),
          penaltyRate: penaltyRate.toNumber(),
        },
        penalties: penalties.map(p => ({
          type: p.type,
          penaltyAmount: p.result.penaltyAmount.toNumber(),
          penaltyDays: p.result.penaltyDays,
          calculationDate: p.result.calculationDate,
        })),
        explanations: {
          percentageOfOverdue: 'Simple percentage of the overdue amount',
          compoundingDaily:
            'Penalty compounds daily, resulting in higher amount for longer overdue periods',
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Demo penalty error:', error);
    res.status(500).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : 'Demo penalty calculation failed',
      error: 'DEMO_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
