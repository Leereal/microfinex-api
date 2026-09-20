import {
  normaliseOverrides,
  recalculateAffordability,
  unknownOverrideIds,
  type AnalysisForRecalculation,
} from '../src/services/obse/affordability.calc';

/**
 * Recalculating affordability after a reviewer changes which lines count.
 *
 * The fixture is a small salaried statement over two months, shaped like
 * OBSE's evidence. It was also checked, outside these tests, against a real
 * OBSE response: with no overrides every summary figure and month matched to
 * the cent. Real client statements are not committed as fixtures.
 */

const txn = (
  id: string,
  month: string,
  group: string,
  included: boolean,
  money: { in?: number; out?: number },
  weight = 1
) => ({
  id,
  month,
  group,
  included,
  weight,
  moneyIn: money.in ?? 0,
  moneyOut: money.out ?? 0,
});

const salary1 = txn('txn-1', '2026-01', 'salary', true, { in: 10000 });
const salary2 = txn('txn-2', '2026-02', 'salary', true, { in: 10000 });
const onceOff = txn('txn-3', '2026-01', 'other-income', false, { in: 3000 });
const rent1 = txn('txn-4', '2026-01', 'living', true, { out: 2000 });
const rent2 = txn('txn-5', '2026-02', 'living', true, { out: 2000 });
const loan = txn('txn-6', '2026-02', 'debt', true, { out: 1000 });
const transfer = txn('txn-7', '2026-02', 'transfer', false, { out: 4000 });

const analysis: AnalysisForRecalculation = {
  customerType: 'salaried',
  statementPeriod: { months: 2, monthKeys: ['2026-01', '2026-02'] },
  summary: { repaymentRatio: 0.3, payslipSalary: 0 },
  evidence: {
    incomeTransactions: [salary1, salary2, onceOff],
    expenseTransactions: [rent1, rent2, loan, transfer],
    salaryTransactions: [salary1, salary2],
  },
};

describe('with OBSE’s own decisions', () => {
  const figures = recalculateAffordability(analysis);

  it('averages the counted lines over the statement months', () => {
    expect(figures.monthlyIncome).toBe(10000); // 20000 / 2
    expect(figures.monthlyExpenses).toBe(2500); // 5000 / 2
    expect(figures.disposableIncome).toBe(7500);
  });

  it('suggests the repayment ratio of what is left, and keeps the rest as cushion', () => {
    expect(figures.suggestedRepayment).toBe(2250);
    expect(figures.remainingCushion).toBe(5250);
  });

  it('breaks the figures down by group and by month', () => {
    expect(figures.salary).toBe(10000);
    expect(figures.otherIncome).toBe(0);
    expect(figures.livingExpenses).toBe(2000);
    expect(figures.debtObligations).toBe(500);
    expect(figures.breakdown).toEqual([
      { month: '2026-01', income: 10000, expenses: 2000 },
      { month: '2026-02', income: 10000, expenses: 3000 },
    ]);
  });

  it('counts included and excluded lines', () => {
    expect(figures.includedLines).toBe(5);
    expect(figures.excludedIncomeLines).toBe(1);
    expect(figures.excludedExpenseLines).toBe(1);
  });
});

describe('with a reviewer’s decisions', () => {
  it('counts a credit OBSE excluded', () => {
    const figures = recalculateAffordability(analysis, { 'txn-3': true });
    expect(figures.monthlyIncome).toBe(11500);
    expect(figures.otherIncome).toBe(1500);
    expect(figures.breakdown[0]).toEqual({ month: '2026-01', income: 13000, expenses: 2000 });
  });

  it('stops counting a debit OBSE included', () => {
    const figures = recalculateAffordability(analysis, { 'txn-6': false });
    expect(figures.monthlyExpenses).toBe(2000);
    expect(figures.debtObligations).toBe(0);
  });

  it('suggests nothing when spending exceeds income, and shows the shortfall', () => {
    const figures = recalculateAffordability(analysis, { 'txn-7': true, 'txn-1': false, 'txn-2': false });
    expect(figures.monthlyIncome).toBe(0);
    expect(figures.disposableIncome).toBe(-4500);
    expect(figures.suggestedRepayment).toBe(0);
    expect(figures.remainingCushion).toBe(-4500);
  });

  it('applies a line’s weight, as OBSE does for irregular trading income', () => {
    const weighted: AnalysisForRecalculation = {
      ...analysis,
      customerType: 'non-salaried',
      evidence: {
        ...analysis.evidence,
        incomeTransactions: [txn('txn-9', '2026-01', 'other-income', true, { in: 1000 }, 0.5)],
      },
    };
    expect(recalculateAffordability(weighted).monthlyIncome).toBe(250); // 1000 x 0.5 / 2
  });
});

describe('a payslip', () => {
  const noSalaryCredit: AnalysisForRecalculation = {
    ...analysis,
    summary: { repaymentRatio: 0.3, payslipSalary: 9000 },
    evidence: { ...analysis.evidence, salaryTransactions: [] },
  };

  it('stands in for a salary the statement never showed', () => {
    const figures = recalculateAffordability(noSalaryCredit);
    expect(figures.payslipTopUp).toBe(9000);
    expect(figures.monthlyIncome).toBe(19000);
  });

  it('is not added on top of a salary the statement does show', () => {
    const withSalary = { ...noSalaryCredit, evidence: analysis.evidence };
    expect(recalculateAffordability(withSalary).payslipTopUp).toBe(0);
  });

  it('never counts for a non-salaried client', () => {
    expect(
      recalculateAffordability({ ...noSalaryCredit, customerType: 'non-salaried' }).payslipTopUp
    ).toBe(0);
  });
});

describe('storing decisions', () => {
  it('keeps only the decisions that differ from OBSE’s', () => {
    expect(
      normaliseOverrides(analysis, { 'txn-3': true, 'txn-1': true, 'txn-7': false })
    ).toEqual({ 'txn-3': true });
  });

  it('reads as unadjusted once every line is back to OBSE’s choice', () => {
    expect(normaliseOverrides(analysis, { 'txn-1': true })).toEqual({});
  });

  it('names lines that are not in the analysis', () => {
    expect(unknownOverrideIds(analysis, { 'txn-3': true, 'txn-999': false })).toEqual(['txn-999']);
  });
});

it('copes with an analysis missing parts', () => {
  const figures = recalculateAffordability({});
  expect(figures.months).toBe(1);
  expect(figures.monthlyIncome).toBe(0);
  expect(figures.breakdown).toEqual([]);
});
