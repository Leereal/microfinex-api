import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import {
  CurrencyBook,
  GroupedCurrencyBook,
  toMoney,
  roundMoney,
  moneyToNumber,
} from './currency-book';
import {
  buildMeta,
  checkReconciliation,
  endOfDay,
  type ReconciliationCheck,
  type ReportFilters,
  type ReportMeta,
  type ReportUser,
} from './report-context';

/**
 * The loan book, as it stands.
 *
 * ---------------------------------------------------------------------------
 * Formulas
 * ---------------------------------------------------------------------------
 *   totalOutstanding   = principalBalance + interestBalance + penaltyBalance
 *   averageLoanSize    = originalPrincipal / loanCount
 *   averageOutstanding = totalOutstanding  / loanCount
 *
 * Every figure is held per currency. There is no total across currencies,
 * because adding USD to ZiG produces a number that is not true in either and
 * that nobody can act on - the defect this report replaces.
 *
 * The status counts (active, overdue, completed, written off, pending) count
 * loans, not money, so they are reported alongside the money rather than mixed
 * into it.
 */

const MEASURES = [
  'originalPrincipal',
  'totalInterest',
  'principalOutstanding',
  'interestOutstanding',
  'penaltyOutstanding',
  'totalOutstanding',
] as const;

type Measure = (typeof MEASURES)[number];

/** Loans that have been paid out and still carry a balance. */
const DISBURSED_STATUSES = [
  'ACTIVE',
  'OVERDUE',
  'COMPLETED',
  'DEFAULTED',
  'DEFAULT',
  'WRITTEN_OFF',
];

/** Applications that have not been paid out. */
const PENDING_STATUSES = [
  'DRAFT',
  'PENDING',
  'PENDING_ASSESSMENT',
  'PENDING_VISIT',
  'PENDING_APPROVAL',
  'APPROVED',
  'PENDING_DISBURSEMENT',
];

export interface PortfolioCurrencyTotals {
  currency: string;
  loanCount: number;
  originalPrincipal: number;
  totalInterest: number;
  principalOutstanding: number;
  interestOutstanding: number;
  penaltyOutstanding: number;
  totalOutstanding: number;
  averageLoanSize: number;
  averageOutstanding: number;
  activeLoans: number;
  overdueLoans: number;
  completedLoans: number;
  writtenOffLoans: number;
  pendingApplications: number;
}

export interface PortfolioLoanRow {
  loanId: string;
  loanNumber: string;
  clientId: string;
  clientName: string;
  clientNumber: string | null;
  clientType: string;
  productId: string | null;
  productName: string;
  branchId: string | null;
  branchName: string;
  loanOfficerId: string | null;
  loanOfficerName: string;
  currency: string;
  disbursementDate: string | null;
  maturityDate: string | null;
  status: string;
  originalAmount: number;
  principalBalance: number;
  interestBalance: number;
  penaltyBalance: number;
  totalOutstanding: number;
}

export interface PortfolioSummaryResult {
  meta: ReportMeta;
  byCurrency: PortfolioCurrencyTotals[];
  breakdowns: {
    byBranch: ReturnType<GroupedCurrencyBook<Measure>['toRows']>;
    byProduct: ReturnType<GroupedCurrencyBook<Measure>['toRows']>;
    byLoanOfficer: ReturnType<GroupedCurrencyBook<Measure>['toRows']>;
    byStatus: ReturnType<GroupedCurrencyBook<Measure>['toRows']>;
    byClientType: ReturnType<GroupedCurrencyBook<Measure>['toRows']>;
    byDisbursementMonth: ReturnType<GroupedCurrencyBook<Measure>['toRows']>;
  };
  rows: PortfolioLoanRow[];
  totalRows: number;
  reconciliation: ReconciliationCheck[];
}

export interface PortfolioSummaryOptions extends ReportFilters {
  /** Omit to return every row, e.g. when exporting. */
  page?: number;
  pageSize?: number;
  sortBy?: keyof PortfolioLoanRow;
  sortDirection?: 'asc' | 'desc';
}

const personName = (
  person?: { firstName?: string | null; lastName?: string | null } | null
): string =>
  [person?.firstName, person?.lastName].filter(Boolean).join(' ') || '-';

const monthKey = (date: Date | null): string =>
  date ? date.toISOString().slice(0, 7) : 'unknown';

export async function buildPortfolioSummary(
  options: PortfolioSummaryOptions,
  user: ReportUser | null
): Promise<PortfolioSummaryResult> {
  const asOf = endOfDay(options.asOfDate ?? new Date());

  /**
   * Scoped to the organization always, and to the branch when one is named.
   * Every query in this file carries both; a report that leaks another
   * organization's book is worse than no report.
   */
  const where: Prisma.LoanWhereInput = {
    organizationId: options.organizationId,
    // A loan created after the as-of date was not on the book then.
    createdAt: { lte: asOf },
  };

  if (options.branchId) where.branchId = options.branchId;
  if (options.productId) where.productId = options.productId;
  if (options.loanOfficerId) where.loanOfficerId = options.loanOfficerId;
  if (options.currency) where.currency = options.currency as never;
  if (options.status) where.status = options.status as never;
  if (options.clientType) where.client = { type: options.clientType as never };

  const loans = await prisma.loan.findMany({
    where,
    select: {
      id: true,
      loanNumber: true,
      currency: true,
      status: true,
      amount: true,
      totalInterest: true,
      principalBalance: true,
      interestBalance: true,
      penaltyBalance: true,
      outstandingBalance: true,
      disbursedDate: true,
      maturityDate: true,
      productId: true,
      branchId: true,
      loanOfficerId: true,
      clientId: true,
      product: { select: { name: true } },
      branch: { select: { name: true } },
      loanOfficer: { select: { firstName: true, lastName: true } },
      client: {
        select: {
          clientNumber: true,
          firstName: true,
          lastName: true,
          businessName: true,
          type: true,
        },
      },
    },
  });

  const book = new CurrencyBook<Measure>(MEASURES);
  const byBranch = new GroupedCurrencyBook<Measure>(MEASURES);
  const byProduct = new GroupedCurrencyBook<Measure>(MEASURES);
  const byLoanOfficer = new GroupedCurrencyBook<Measure>(MEASURES);
  const byStatus = new GroupedCurrencyBook<Measure>(MEASURES);
  const byClientType = new GroupedCurrencyBook<Measure>(MEASURES);
  const byDisbursementMonth = new GroupedCurrencyBook<Measure>(MEASURES);

  const statusCounts = new Map<
    string,
    {
      active: number;
      overdue: number;
      completed: number;
      writtenOff: number;
      pending: number;
    }
  >();

  const rows: PortfolioLoanRow[] = [];

  for (const loan of loans) {
    const currency = loan.currency ?? 'USD';
    const isPending = PENDING_STATUSES.includes(loan.status);

    /**
     * A loan that has not been paid out has no outstanding balance to report,
     * whatever its record says - counting an approved application's balance as
     * portfolio would inflate the book by money that has not left the building.
     */
    const principal = isPending
      ? new Prisma.Decimal(0)
      : toMoney(loan.principalBalance);
    const interest = isPending
      ? new Prisma.Decimal(0)
      : toMoney(loan.interestBalance);
    const penalty = isPending
      ? new Prisma.Decimal(0)
      : toMoney(loan.penaltyBalance);

    // The identity this report asserts, computed from its parts rather than
    // read from `outstandingBalance` - which is a stored convenience and can
    // drift from its own components.
    const totalOutstanding = principal.add(interest).add(penalty);

    const measures = {
      originalPrincipal: toMoney(loan.amount),
      totalInterest: toMoney(loan.totalInterest),
      principalOutstanding: principal,
      interestOutstanding: interest,
      penaltyOutstanding: penalty,
      totalOutstanding,
    };

    book.addMany(currency, measures);
    book.count(currency);

    const counts = statusCounts.get(currency) ?? {
      active: 0,
      overdue: 0,
      completed: 0,
      writtenOff: 0,
      pending: 0,
    };
    if (loan.status === 'ACTIVE') counts.active += 1;
    else if (loan.status === 'OVERDUE') counts.overdue += 1;
    else if (loan.status === 'COMPLETED') counts.completed += 1;
    else if (loan.status === 'WRITTEN_OFF') counts.writtenOff += 1;
    if (isPending) counts.pending += 1;
    statusCounts.set(currency, counts);

    const clientName =
      [loan.client?.firstName, loan.client?.lastName]
        .filter(Boolean)
        .join(' ') ||
      loan.client?.businessName ||
      'Unknown client';

    const productName = loan.product?.name ?? 'No product';
    const branchName = loan.branch?.name ?? 'No branch';
    const officerName = personName(loan.loanOfficer);
    const clientType = loan.client?.type ?? 'UNKNOWN';

    byBranch.add(loan.branchId ?? 'none', branchName, currency, measures);
    byProduct.add(loan.productId ?? 'none', productName, currency, measures);
    byLoanOfficer.add(
      loan.loanOfficerId ?? 'none',
      officerName,
      currency,
      measures
    );
    byStatus.add(loan.status, loan.status.replace(/_/g, ' '), currency, measures);
    byClientType.add(clientType, clientType, currency, measures);
    byDisbursementMonth.add(
      monthKey(loan.disbursedDate),
      monthKey(loan.disbursedDate),
      currency,
      measures
    );

    rows.push({
      loanId: loan.id,
      loanNumber: loan.loanNumber,
      clientId: loan.clientId,
      clientName,
      clientNumber: loan.client?.clientNumber ?? null,
      clientType,
      productId: loan.productId,
      productName,
      branchId: loan.branchId,
      branchName,
      loanOfficerId: loan.loanOfficerId,
      loanOfficerName: officerName,
      currency,
      disbursementDate: loan.disbursedDate?.toISOString() ?? null,
      maturityDate: loan.maturityDate?.toISOString() ?? null,
      status: loan.status,
      originalAmount: moneyToNumber(roundMoney(toMoney(loan.amount))),
      principalBalance: moneyToNumber(roundMoney(principal)),
      interestBalance: moneyToNumber(roundMoney(interest)),
      penaltyBalance: moneyToNumber(roundMoney(penalty)),
      totalOutstanding: moneyToNumber(roundMoney(totalOutstanding)),
    });
  }

  // ---- headline figures, per currency ------------------------------------
  const byCurrency: PortfolioCurrencyTotals[] = book.currencies().map(currency => {
    const count = book.countOf(currency);
    const counts = statusCounts.get(currency)!;
    const original = book.get(currency, 'originalPrincipal');
    const outstanding = book.get(currency, 'totalOutstanding');

    return {
      currency,
      loanCount: count,
      originalPrincipal: moneyToNumber(roundMoney(original)),
      totalInterest: moneyToNumber(roundMoney(book.get(currency, 'totalInterest'))),
      principalOutstanding: moneyToNumber(
        roundMoney(book.get(currency, 'principalOutstanding'))
      ),
      interestOutstanding: moneyToNumber(
        roundMoney(book.get(currency, 'interestOutstanding'))
      ),
      penaltyOutstanding: moneyToNumber(
        roundMoney(book.get(currency, 'penaltyOutstanding'))
      ),
      totalOutstanding: moneyToNumber(roundMoney(outstanding)),
      averageLoanSize:
        count > 0 ? moneyToNumber(roundMoney(original.div(count))) : 0,
      averageOutstanding:
        count > 0 ? moneyToNumber(roundMoney(outstanding.div(count))) : 0,
      activeLoans: counts.active,
      overdueLoans: counts.overdue,
      completedLoans: counts.completed,
      writtenOffLoans: counts.writtenOff,
      pendingApplications: counts.pending,
    };
  });

  // ---- reconciliation ----------------------------------------------------
  const reconciliation: ReconciliationCheck[] = [];

  for (const currency of book.currencies()) {
    // total outstanding = principal + interest + penalty
    reconciliation.push(
      checkReconciliation(
        'totalOutstanding = principalOutstanding + interestOutstanding + penaltyOutstanding',
        currency,
        book
          .get(currency, 'principalOutstanding')
          .add(book.get(currency, 'interestOutstanding'))
          .add(book.get(currency, 'penaltyOutstanding')),
        book.get(currency, 'totalOutstanding')
      )
    );

    // the summary equals the rows it is a summary of
    const rowTotal = rows
      .filter(row => row.currency === currency)
      .reduce((sum, row) => sum.add(toMoney(row.totalOutstanding)), new Prisma.Decimal(0));

    reconciliation.push(
      checkReconciliation(
        'summary.totalOutstanding = sum(detail rows.totalOutstanding)',
        currency,
        rowTotal,
        book.get(currency, 'totalOutstanding')
      )
    );
  }

  // ---- sorting and pagination -------------------------------------------
  const sortBy = options.sortBy ?? 'loanNumber';
  const direction = options.sortDirection === 'desc' ? -1 : 1;

  rows.sort((a, b) => {
    const left = a[sortBy];
    const right = b[sortBy];
    if (typeof left === 'number' && typeof right === 'number') {
      return (left - right) * direction;
    }
    return String(left ?? '').localeCompare(String(right ?? '')) * direction;
  });

  const totalRows = rows.length;
  const paged =
    options.page && options.pageSize
      ? rows.slice(
          (options.page - 1) * options.pageSize,
          options.page * options.pageSize
        )
      : rows;

  return {
    meta: buildMeta('Loan Portfolio Summary', options, user, totalRows === 0),
    byCurrency,
    breakdowns: {
      byBranch: byBranch.toRows(),
      byProduct: byProduct.toRows(),
      byLoanOfficer: byLoanOfficer.toRows(),
      byStatus: byStatus.toRows(),
      byClientType: byClientType.toRows(),
      byDisbursementMonth: byDisbursementMonth.toRows(),
    },
    rows: paged,
    totalRows,
    reconciliation,
  };
}

export { DISBURSED_STATUSES, PENDING_STATUSES };
