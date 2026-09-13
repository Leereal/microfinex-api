import { Prisma } from '@prisma/client';
import { roundMoney, toMoney, type Money } from '../../utils/money';

/**
 * What a report is a report *of*.
 *
 * A figure without its as-of date, its filters and its timezone is not a
 * result, it is a rumour: two people running "the collections report" an hour
 * apart, one with a branch filter still applied, get different numbers and no
 * way to tell why. Every report here carries the question it answered, so a
 * printed copy can be checked months later.
 */

export interface ReportFilters {
  organizationId: string;
  branchId?: string;
  /** Inclusive start of the period, for reports that cover a range. */
  from?: Date;
  /** Inclusive end of the period. */
  to?: Date;
  /** The moment the portfolio is measured at, for point-in-time reports. */
  asOfDate?: Date;
  currency?: string;
  productId?: string;
  loanOfficerId?: string;
  status?: string;
  clientType?: string;
  paymentMethodId?: string;
}

export interface ReportMeta {
  reportName: string;
  /** The moment the portfolio is measured at. */
  asOfDate: string;
  dateRange: { from: string | null; to: string | null };
  timezone: string;
  generatedAt: string;
  generatedBy: { id: string; name: string } | null;
  /** Every filter that shaped this result, echoed back for the header. */
  filters: Record<string, string>;
  /** True when the result is empty because nothing matched, not because of an error. */
  isEmpty: boolean;
}

export interface ReportUser {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
}

/**
 * End of the given day.
 *
 * An as-of date of "the 13th" means the portfolio as it stood at the close of
 * the 13th. Comparing against midnight would silently exclude everything that
 * happened during the day being asked about.
 */
export function endOfDay(date: Date): Date {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

export function startOfDay(date: Date): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

/** Whole days from `from` to `to`, never negative. */
export function daysBetween(from: Date, to: Date): number {
  const ms = startOfDay(to).getTime() - startOfDay(from).getTime();
  return Math.max(Math.floor(ms / 86_400_000), 0);
}

export function buildMeta(
  reportName: string,
  filters: ReportFilters,
  user: ReportUser | null,
  isEmpty: boolean,
  labels: Record<string, string> = {}
): ReportMeta {
  const asOf = filters.asOfDate ?? filters.to ?? new Date();

  const echoed: Record<string, string> = {};
  if (filters.branchId) echoed.branch = labels.branch ?? filters.branchId;
  if (filters.currency) echoed.currency = filters.currency;
  if (filters.productId) echoed.product = labels.product ?? filters.productId;
  if (filters.loanOfficerId)
    echoed.loanOfficer = labels.loanOfficer ?? filters.loanOfficerId;
  if (filters.status) echoed.status = filters.status;
  if (filters.clientType) echoed.clientType = filters.clientType;
  if (filters.paymentMethodId)
    echoed.paymentMethod = labels.paymentMethod ?? filters.paymentMethodId;
  if (Object.keys(echoed).length === 0) echoed.scope = 'All records';

  return {
    reportName,
    asOfDate: endOfDay(asOf).toISOString(),
    dateRange: {
      from: filters.from ? startOfDay(filters.from).toISOString() : null,
      to: filters.to ? endOfDay(filters.to).toISOString() : null,
    },
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
    generatedAt: new Date().toISOString(),
    generatedBy: user
      ? {
          id: user.id,
          name:
            [user.firstName, user.lastName].filter(Boolean).join(' ') ||
            'Unknown user',
        }
      : null,
    filters: echoed,
    isEmpty,
  };
}

/**
 * A check that a summary figure equals the rows it claims to summarise.
 *
 * Reports drift: a total is computed one way for the header and another way for
 * the table, and nobody notices until a client queries a statement. Each report
 * asserts its own identities and ships the result, so a discrepancy is visible
 * on the report itself rather than discovered later.
 */
export interface ReconciliationCheck {
  /** The identity being asserted, in words. */
  formula: string;
  currency: string;
  expected: number;
  actual: number;
  difference: number;
  ok: boolean;
}

/** A cent of slack, because two correct routes to the same figure can round apart. */
const TOLERANCE = new Prisma.Decimal('0.01');

export function checkReconciliation(
  formula: string,
  currency: string,
  expected: Money | number,
  actual: Money | number
): ReconciliationCheck {
  const expectedMoney = roundMoney(toMoney(expected));
  const actualMoney = roundMoney(toMoney(actual));
  const difference = actualMoney.sub(expectedMoney);

  return {
    formula,
    currency,
    expected: Number(expectedMoney),
    actual: Number(actualMoney),
    difference: Number(difference),
    ok: difference.abs().lessThanOrEqualTo(TOLERANCE),
  };
}

export interface ReportResult<Summary, Row> {
  meta: ReportMeta;
  /** Headline figures, one row per currency. Never one figure across currencies. */
  summary: Summary;
  /** The rows the summary is made of. */
  rows: Row[];
  /** Total rows matching the filters, before pagination. */
  totalRows: number;
  /** Assertions that the summary agrees with the rows. */
  reconciliation: ReconciliationCheck[];
}
