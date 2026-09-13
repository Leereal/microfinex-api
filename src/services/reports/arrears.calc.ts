import { Prisma } from '@prisma/client';
import { toMoney, atLeastZero, type Money } from '../../utils/money';

/**
 * What is actually overdue on an instalment, and how old it is.
 *
 * Pure functions, deliberately: every arrears figure in this system - PAR, the
 * aging buckets, the collections shortfall - derives from the same two
 * questions, and they are worth being able to test without a database.
 *
 * ---------------------------------------------------------------------------
 * The formulas
 * ---------------------------------------------------------------------------
 *
 *   remaining(instalment)  = totalAmount - paidAmount           (never below 0)
 *
 *   A partly paid instalment is the case everything got wrong. Reports were
 *   charging the whole `principalAmount` and the whole `interestAmount` to
 *   arrears whenever an instalment was not fully settled, so a client who had
 *   paid 90% of a payment appeared to owe 100% of it - and the principal and
 *   interest columns added up to more than the total arrears beside them.
 *
 *   Repayments settle in a fixed order: penalties, then interest, then
 *   principal. So what a part payment leaves unpaid follows from that order
 *   rather than from the instalment's original split:
 *
 *     appliedToInterest  = min(paidAmount, interestAmount)
 *     interestRemaining  = interestAmount - appliedToInterest
 *     appliedToPrincipal = max(paidAmount - interestAmount, 0)
 *     principalRemaining = principalAmount - appliedToPrincipal
 *
 *   and by construction:
 *
 *     interestRemaining + principalRemaining = totalAmount - paidAmount
 *
 *   which is the identity the reports reconcile against.
 *
 *   daysOverdue(asOf) = whole days from the oldest unpaid due date to asOf
 */

export interface ScheduleRow {
  dueDate: Date;
  principalAmount: Prisma.Decimal | number | string;
  interestAmount: Prisma.Decimal | number | string;
  totalAmount: Prisma.Decimal | number | string;
  paidAmount: Prisma.Decimal | number | string;
  status?: string;
}

export interface InstalmentArrears {
  /** Still owed on this instalment. */
  remaining: Money;
  /** Of that, the interest portion, after the payment waterfall. */
  interestRemaining: Money;
  /** Of that, the principal portion. */
  principalRemaining: Money;
}

/**
 * What a single instalment still owes, split correctly for a part payment.
 */
export function instalmentArrears(row: ScheduleRow): InstalmentArrears {
  const total = toMoney(row.totalAmount);
  const paid = toMoney(row.paidAmount);
  const interest = toMoney(row.interestAmount);
  const principal = toMoney(row.principalAmount);

  const remaining = atLeastZero(total.sub(paid));

  // Interest is settled before principal, so a part payment eats the interest
  // first and only what is left over touches the principal.
  const appliedToInterest = paid.greaterThan(interest) ? interest : paid;
  const interestRemaining = atLeastZero(interest.sub(appliedToInterest));

  const appliedToPrincipal = atLeastZero(paid.sub(interest));
  const principalRemaining = atLeastZero(principal.sub(appliedToPrincipal));

  return { remaining, interestRemaining, principalRemaining };
}

export interface LoanArrears {
  /** Instalments due on or before the as-of date that are not fully settled. */
  overdueInstalments: number;
  /** Total still owed across those instalments. */
  overdueAmount: Money;
  overduePrincipal: Money;
  overdueInterest: Money;
  /** Whole days since the oldest unpaid instalment fell due. 0 when none. */
  daysOverdue: number;
  /** The due date of the oldest unpaid instalment, or null. */
  oldestUnpaidDueDate: Date | null;
  /** True when anything at all is overdue. */
  inArrears: boolean;
}

const ZERO = new Prisma.Decimal(0);

/**
 * A loan's arrears position as at a given moment.
 *
 * Only instalments that have actually fallen due are counted: a schedule row
 * dated next month is not arrears, however unpaid it is.
 */
export function loanArrears(
  schedule: ScheduleRow[],
  asOfDate: Date
): LoanArrears {
  let overdueAmount = ZERO;
  let overduePrincipal = ZERO;
  let overdueInterest = ZERO;
  let overdueInstalments = 0;
  let oldestUnpaidDueDate: Date | null = null;

  for (const row of schedule) {
    const due = new Date(row.dueDate);
    if (due.getTime() > asOfDate.getTime()) continue;

    const arrears = instalmentArrears(row);
    if (arrears.remaining.lessThanOrEqualTo(0)) continue;

    overdueInstalments += 1;
    overdueAmount = overdueAmount.add(arrears.remaining);
    overduePrincipal = overduePrincipal.add(arrears.principalRemaining);
    overdueInterest = overdueInterest.add(arrears.interestRemaining);

    if (!oldestUnpaidDueDate || due < oldestUnpaidDueDate) {
      oldestUnpaidDueDate = due;
    }
  }

  const daysOverdue = oldestUnpaidDueDate
    ? Math.max(
        Math.floor(
          (startOfDay(asOfDate).getTime() -
            startOfDay(oldestUnpaidDueDate).getTime()) /
            86_400_000
        ),
        0
      )
    : 0;

  return {
    overdueInstalments,
    overdueAmount,
    overduePrincipal,
    overdueInterest,
    daysOverdue,
    oldestUnpaidDueDate,
    inArrears: overdueAmount.greaterThan(0),
  };
}

const startOfDay = (date: Date): Date => {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
};

/**
 * The PAR thresholds, in days.
 *
 * These are *cumulative*: PAR30 is every loan 30 or more days late, which
 * includes everything in PAR60 and PAR90. That is the industry definition and
 * the reason the numbers do not sum to the portfolio - a point the UI has to
 * make, because a reader who assumes the buckets are exclusive will
 * double-count.
 */
export const PAR_THRESHOLDS = [1, 7, 30, 60, 90, 180] as const;
export type ParThreshold = (typeof PAR_THRESHOLDS)[number];

/**
 * The aging buckets, in days.
 *
 * These are *mutually exclusive* - each loan lands in exactly one - so they do
 * sum to the portfolio. The opposite property to the PAR thresholds above,
 * which is why both exist and why they are never mixed in one table.
 */
export const AGING_BUCKETS = [
  { key: 'CURRENT', label: 'Current / not due', min: 0, max: 0 },
  { key: 'D1_30', label: '1-30 days', min: 1, max: 30 },
  { key: 'D31_60', label: '31-60 days', min: 31, max: 60 },
  { key: 'D61_90', label: '61-90 days', min: 61, max: 90 },
  { key: 'D91_180', label: '91-180 days', min: 91, max: 180 },
  { key: 'D180_PLUS', label: '180+ days', min: 181, max: Number.MAX_SAFE_INTEGER },
] as const;

export type AgingBucketKey = (typeof AGING_BUCKETS)[number]['key'];

/** Which single bucket a given number of days overdue falls in. */
export function agingBucketFor(daysOverdue: number): AgingBucketKey {
  const bucket = AGING_BUCKETS.find(
    candidate => daysOverdue >= candidate.min && daysOverdue <= candidate.max
  );
  return (bucket ?? AGING_BUCKETS[0]).key;
}
