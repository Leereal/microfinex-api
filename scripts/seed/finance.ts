/**
 * The arithmetic behind the seeded loans.
 *
 * Demo data is only useful if it survives being looked at: a loan's schedule
 * has to amortise to its total, its payments have to sum to what the schedule
 * says was paid, and its balances have to equal what is left. Otherwise every
 * report built against this data is wrong in a way that looks like a bug in
 * the report.
 *
 * Money is handled in cents as integers and only converted at the edge, so
 * repeated addition cannot drift the way floating-point currency does.
 */

export type Frequency =
  | 'DAILY'
  | 'WEEKLY'
  | 'BIWEEKLY'
  | 'MONTHLY'
  | 'QUARTERLY'
  | 'SEMI_ANNUAL'
  | 'ANNUAL';

export interface Installment {
  installmentNumber: number;
  dueDate: Date;
  principalAmount: number;
  interestAmount: number;
  totalAmount: number;
}

export interface Amortisation {
  installments: Installment[];
  totalPrincipal: number;
  totalInterest: number;
  totalAmount: number;
  installmentAmount: number;
  maturityDate: Date;
}


/** How many times a period fits into a year. */
const PERIODS_PER_YEAR: Record<Frequency, number> = {
  DAILY: 365,
  WEEKLY: 52,
  BIWEEKLY: 26,
  MONTHLY: 12,
  QUARTERLY: 4,
  SEMI_ANNUAL: 2,
  ANNUAL: 1,
};

/**
 * Convert a product's quoted rate into a rate per repayment period.
 *
 * A product stores its rate together with the frequency it is quoted at:
 * "180%, ANNUAL" on a loan repaid MONTHLY is 15% a month, not 180% a month.
 * Treating the quoted figure as a per-period rate inflates a $32,000 loan to
 * $383,000 owing - arithmetically consistent, and complete nonsense.
 */
export function ratePerPeriod(
  quotedRate: number,
  quotedFrequency: Frequency,
  repaymentFrequency: Frequency
): number {
  const annual = quotedRate * PERIODS_PER_YEAR[quotedFrequency];
  return annual / PERIODS_PER_YEAR[repaymentFrequency];
}

const toCents = (amount: number) => Math.round(amount * 100);
const toAmount = (cents: number) => Math.round(cents) / 100;

/** Step a date forward by one repayment period. */
export function addPeriod(date: Date, frequency: Frequency, periods = 1): Date {
  const next = new Date(date);
  switch (frequency) {
    case 'DAILY':
      next.setDate(next.getDate() + periods);
      break;
    case 'WEEKLY':
      next.setDate(next.getDate() + 7 * periods);
      break;
    case 'BIWEEKLY':
      next.setDate(next.getDate() + 14 * periods);
      break;
    case 'MONTHLY':
      next.setMonth(next.getMonth() + periods);
      break;
    case 'QUARTERLY':
      next.setMonth(next.getMonth() + 3 * periods);
      break;
    case 'SEMI_ANNUAL':
      next.setMonth(next.getMonth() + 6 * periods);
      break;
    case 'ANNUAL':
      next.setFullYear(next.getFullYear() + periods);
      break;
  }
  return next;
}

/**
 * Flat-rate amortisation: interest is charged on the original principal for
 * the whole term, then principal and interest are split evenly across the
 * instalments. This is what most of the products in this system use.
 *
 * The final instalment absorbs every rounding remainder, so the schedule sums
 * exactly to the totals rather than being a cent or two out.
 */
export function amortiseFlat(
  principal: number,
  ratePercentPerPeriod: number,
  term: number,
  frequency: Frequency,
  startDate: Date
): Amortisation {
  const principalCents = toCents(principal);

  // Interest is charged on the full principal for every period of the term.
  // The rate must already be per period - see ratePerPeriod.
  const interestCents = Math.round(
    (principalCents * ratePercentPerPeriod * term) / 100
  );

  const basePrincipal = Math.floor(principalCents / term);
  const baseInterest = Math.floor(interestCents / term);

  const installments: Installment[] = [];
  let principalAllocated = 0;
  let interestAllocated = 0;

  for (let index = 1; index <= term; index++) {
    const isLast = index === term;

    const principalPart = isLast
      ? principalCents - principalAllocated
      : basePrincipal;
    const interestPart = isLast
      ? interestCents - interestAllocated
      : baseInterest;

    principalAllocated += principalPart;
    interestAllocated += interestPart;

    installments.push({
      installmentNumber: index,
      dueDate: addPeriod(startDate, frequency, index),
      principalAmount: toAmount(principalPart),
      interestAmount: toAmount(interestPart),
      totalAmount: toAmount(principalPart + interestPart),
    });
  }

  return {
    installments,
    totalPrincipal: toAmount(principalCents),
    totalInterest: toAmount(interestCents),
    totalAmount: toAmount(principalCents + interestCents),
    installmentAmount: toAmount(basePrincipal + baseInterest),
    maturityDate: installments[installments.length - 1]!.dueDate,
  };
}

/**
 * Reducing-balance amortisation: interest accrues on what is still owed, so
 * the interest portion falls as the loan runs down.
 */
export function amortiseReducing(
  principal: number,
  ratePercentPerPeriod: number,
  term: number,
  frequency: Frequency,
  startDate: Date
): Amortisation {
  const rate = ratePercentPerPeriod / 100;
  const principalCents = toCents(principal);

  // Standard annuity instalment. A zero rate degrades to a straight split.
  const payment =
    rate === 0
      ? principalCents / term
      : (principalCents * rate) / (1 - Math.pow(1 + rate, -term));

  const installments: Installment[] = [];
  let balance = principalCents;
  let interestTotal = 0;

  for (let index = 1; index <= term; index++) {
    const isLast = index === term;
    const interestPart = Math.round(balance * rate);

    // The last instalment clears whatever is left, absorbing the rounding.
    const principalPart = isLast
      ? balance
      : Math.round(payment) - interestPart;

    balance -= principalPart;
    interestTotal += interestPart;

    installments.push({
      installmentNumber: index,
      dueDate: addPeriod(startDate, frequency, index),
      principalAmount: toAmount(principalPart),
      interestAmount: toAmount(interestPart),
      totalAmount: toAmount(principalPart + interestPart),
    });
  }

  return {
    installments,
    totalPrincipal: toAmount(principalCents),
    totalInterest: toAmount(interestTotal),
    totalAmount: toAmount(principalCents + interestTotal),
    installmentAmount: toAmount(Math.round(payment)),
    maturityDate: installments[installments.length - 1]!.dueDate,
  };
}

export interface LoanPosition {
  /** Instalments settled in full, in order. */
  paidInstallments: number;
  paidPrincipal: number;
  paidInterest: number;
  outstandingBalance: number;
  principalBalance: number;
  interestBalance: number;
  penaltyBalance: number;
  lastPaymentDate: Date | null;
  nextDueDate: Date | null;
}

/**
 * Work out where a loan stands after settling the first `paidCount`
 * instalments, plus an optional part-payment of the next one.
 *
 * Everything the loan row reports - outstanding, principal, interest, next due
 * date - is derived here from the same schedule the payments were made
 * against, so the two can never disagree.
 */
export function positionAfterPayments(
  amortisation: Amortisation,
  paidCount: number,
  options: { partialOfNext?: number; penalty?: number; asOf?: Date } = {}
): LoanPosition {
  const { installments } = amortisation;
  const settled = installments.slice(0, paidCount);

  let paidPrincipal = settled.reduce((sum, i) => sum + toCents(i.principalAmount), 0);
  let paidInterest = settled.reduce((sum, i) => sum + toCents(i.interestAmount), 0);

  // A part-payment lands on interest first, then principal - the order the
  // payment allocator uses in production.
  const partial = toCents(options.partialOfNext ?? 0);
  if (partial > 0 && installments[paidCount]) {
    const next = installments[paidCount]!;
    const interestPart = Math.min(partial, toCents(next.interestAmount));
    paidInterest += interestPart;
    paidPrincipal += partial - interestPart;
  }

  const totalPrincipal = toCents(amortisation.totalPrincipal);
  const totalInterest = toCents(amortisation.totalInterest);
  const penalty = toCents(options.penalty ?? 0);

  const principalBalance = Math.max(totalPrincipal - paidPrincipal, 0);
  const interestBalance = Math.max(totalInterest - paidInterest, 0);

  const lastPaid = settled[settled.length - 1];
  const nextDue = installments[paidCount];

  return {
    paidInstallments: paidCount,
    paidPrincipal: toAmount(paidPrincipal),
    paidInterest: toAmount(paidInterest),
    outstandingBalance: toAmount(principalBalance + interestBalance + penalty),
    principalBalance: toAmount(principalBalance),
    interestBalance: toAmount(interestBalance),
    penaltyBalance: toAmount(penalty),
    lastPaymentDate: lastPaid ? lastPaid.dueDate : null,
    nextDueDate: nextDue ? nextDue.dueDate : null,
  };
}

/** Days between two dates, floored. */
export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * A late-payment penalty, as a percentage of the overdue instalment per month
 * late. Capped so a long-defaulted loan does not accrue an absurd figure.
 */
export function penaltyFor(
  overdueAmount: number,
  daysLate: number,
  monthlyRatePercent = 5,
  capPercent = 50
): number {
  if (daysLate <= 0) return 0;
  const months = daysLate / 30;
  const penalty = overdueAmount * (monthlyRatePercent / 100) * months;
  const cap = overdueAmount * (capPercent / 100);
  return Math.round(Math.min(penalty, cap) * 100) / 100;
}
