/**
 * Affordability figures, recalculated from the transactions a reviewer counts.
 *
 * OBSE decides by policy which lines count - salary and proven recurring
 * income in, once-off credits and transfers out - and returns every line with
 * that default. A reviewer can overrule a line (a once-off credit that is in
 * fact a regular side income, say). The figures then have to be recalculated
 * the way OBSE calculates them, or the screen and the stored record disagree.
 *
 * This is OBSE's own formula, as its affordability screen applies it:
 *
 *   monthly income   = sum(included credits x weight) / months (+ payslip
 *                      salary, for a salaried client whose statement shows no
 *                      salary credit at all)
 *   monthly expenses = sum(included debits x weight) / months
 *   disposable       = income - expenses
 *   suggested        = max(disposable, 0) x repayment ratio
 *   cushion          = disposable - suggested
 *
 * With no overrides it reproduces OBSE's own summary; the tests hold it to a
 * real OBSE response.
 */

export interface EvidenceTransaction {
  id: string;
  month?: string;
  moneyIn?: number;
  moneyOut?: number;
  group?: string;
  included?: boolean;
  weight?: number;
}

/** A reviewer's decisions: transaction id -> counted or not. */
export type Overrides = Record<string, boolean>;

export interface AnalysisForRecalculation {
  customerType?: string;
  statementPeriod?: { months?: number; monthKeys?: string[] };
  summary?: { repaymentRatio?: number; payslipSalary?: number };
  monthlyBreakdown?: Array<{ month: string }>;
  evidence?: {
    incomeTransactions?: EvidenceTransaction[];
    expenseTransactions?: EvidenceTransaction[];
    salaryTransactions?: EvidenceTransaction[];
  };
}

export interface AffordabilityFigures {
  months: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  disposableIncome: number;
  suggestedRepayment: number;
  remainingCushion: number;
  repaymentRatio: number;
  salary: number;
  recurringIncome: number;
  otherIncome: number;
  livingExpenses: number;
  debtObligations: number;
  payslipTopUp: number;
  includedLines: number;
  excludedIncomeLines: number;
  excludedExpenseLines: number;
  breakdown: Array<{ month: string; income: number; expenses: number }>;
}

export const roundMoney = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const amount = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

/** Every line the reviewer can decide on, by id. */
export function transactionIndex(
  data: AnalysisForRecalculation
): Map<string, EvidenceTransaction> {
  const index = new Map<string, EvidenceTransaction>();
  for (const item of [
    ...(data.evidence?.incomeTransactions ?? []),
    ...(data.evidence?.expenseTransactions ?? []),
  ]) {
    if (item && typeof item.id === 'string') index.set(item.id, item);
  }
  return index;
}

/** Override ids that are not lines in this analysis. */
export function unknownOverrideIds(
  data: AnalysisForRecalculation,
  overrides: Overrides
): string[] {
  const index = transactionIndex(data);
  return Object.keys(overrides).filter(id => !index.has(id));
}

/**
 * Keep only the decisions that differ from OBSE's default.
 *
 * Ticking a line back to what OBSE already chose is not an adjustment, so it
 * is not stored - and an analysis whose every decision matches OBSE's again
 * reads as unadjusted.
 */
export function normaliseOverrides(
  data: AnalysisForRecalculation,
  overrides: Overrides
): Overrides {
  const index = transactionIndex(data);
  const result: Overrides = {};
  for (const [id, included] of Object.entries(overrides)) {
    const item = index.get(id);
    if (item && Boolean(item.included) !== included) result[id] = included;
  }
  return result;
}

export function recalculateAffordability(
  data: AnalysisForRecalculation,
  overrides: Overrides = {}
): AffordabilityFigures {
  const months = Math.max(amount(data.statementPeriod?.months), 1);
  const ratio = amount(data.summary?.repaymentRatio);

  const apply = (items: EvidenceTransaction[] = []) =>
    items.map(item => ({
      ...item,
      included: overrides[item.id] ?? Boolean(item.included),
    }));

  const income = apply(data.evidence?.incomeTransactions);
  const expenses = apply(data.evidence?.expenseTransactions);

  const total = (
    items: EvidenceTransaction[],
    field: 'moneyIn' | 'moneyOut'
  ) =>
    items
      .filter(item => item.included)
      .reduce((sum, item) => sum + amount(item[field]) * (item.weight ?? 1), 0);

  const perMonth = (items: EvidenceTransaction[], field: 'moneyIn' | 'moneyOut') =>
    total(items, field) / months;

  const group = (
    items: EvidenceTransaction[],
    name: string,
    field: 'moneyIn' | 'moneyOut'
  ) => perMonth(items.filter(item => item.group === name), field);

  // A payslip stands in only for a salary the statement never showed.
  const payslipTopUp =
    data.customerType !== 'non-salaried' &&
    (data.evidence?.salaryTransactions?.length ?? 0) === 0
      ? amount(data.summary?.payslipSalary)
      : 0;

  const monthlyIncome = perMonth(income, 'moneyIn') + payslipTopUp;
  const monthlyExpenses = perMonth(expenses, 'moneyOut');
  const disposable = monthlyIncome - monthlyExpenses;
  const suggested = Math.max(disposable, 0) * ratio;

  const monthKeys = data.statementPeriod?.monthKeys?.length
    ? data.statementPeriod.monthKeys
    : (data.monthlyBreakdown ?? []).map(month => month.month);

  const monthTotal = (
    items: EvidenceTransaction[],
    month: string,
    field: 'moneyIn' | 'moneyOut'
  ) =>
    items
      .filter(item => item.included && item.month === month)
      .reduce((sum, item) => sum + amount(item[field]) * (item.weight ?? 1), 0);

  const includedIncome = income.filter(item => item.included).length;
  const includedExpenses = expenses.filter(item => item.included).length;

  return {
    months,
    monthlyIncome: roundMoney(monthlyIncome),
    monthlyExpenses: roundMoney(monthlyExpenses),
    disposableIncome: roundMoney(disposable),
    suggestedRepayment: roundMoney(suggested),
    remainingCushion: roundMoney(disposable - suggested),
    repaymentRatio: ratio,
    salary: roundMoney(group(income, 'salary', 'moneyIn') + payslipTopUp),
    recurringIncome: roundMoney(group(income, 'recurring-income', 'moneyIn')),
    otherIncome: roundMoney(group(income, 'other-income', 'moneyIn')),
    livingExpenses: roundMoney(group(expenses, 'living', 'moneyOut')),
    debtObligations: roundMoney(group(expenses, 'debt', 'moneyOut')),
    payslipTopUp: roundMoney(payslipTopUp),
    includedLines: includedIncome + includedExpenses,
    excludedIncomeLines: income.length - includedIncome,
    excludedExpenseLines: expenses.length - includedExpenses,
    breakdown: monthKeys.map(month => ({
      month,
      income: roundMoney(monthTotal(income, month, 'moneyIn')),
      expenses: roundMoney(monthTotal(expenses, month, 'moneyOut')),
    })),
  };
}
