import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import {
  CurrencyBook,
  percentOf,
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
import {
  loanArrears,
  agingBucketFor,
  AGING_BUCKETS,
  PAR_THRESHOLDS,
  type AgingBucketKey,
} from './arrears.calc';

/**
 * Portfolio at Risk.
 *
 * ---------------------------------------------------------------------------
 * Formulas
 * ---------------------------------------------------------------------------
 *   PAR(n) = outstanding of loans at least n days in arrears
 *            ------------------------------------------------
 *                  outstanding of the active portfolio
 *
 * "At risk" is the loan's *whole* exposure, not the overdue instalment: a
 * client 40 days late on one payment puts the entire balance at risk, which is
 * the measure a lender provisions against. Both figures are reported, because
 * the overdue amount is what you chase and the exposure is what you might lose.
 *
 * ---------------------------------------------------------------------------
 * Cumulative thresholds vs exclusive buckets
 * ---------------------------------------------------------------------------
 * These are two different things and were previously conflated:
 *
 *   Thresholds (PAR1, PAR7, PAR30...) are CUMULATIVE. A loan 200 days late
 *   appears in every one of them. They do not sum to the portfolio, and adding
 *   them together is meaningless.
 *
 *   Aging buckets (1-30, 31-60...) are MUTUALLY EXCLUSIVE. Each loan appears in
 *   exactly one, so they do sum to the arrears total - and that sum is asserted
 *   in the reconciliation below.
 *
 * Both are returned, separately labelled, so the UI can show which is which.
 * Every figure is per currency: a PAR ratio that divides ZiG arrears by a
 * portfolio of USD and ZiG combined is not a ratio of anything.
 */

const MEASURES = ['overdueAmount', 'exposure', 'portfolio'] as const;
type Measure = (typeof MEASURES)[number];

/** Only money that has been paid out and is still running can be at risk. */
const AT_RISK_STATUSES: Prisma.LoanWhereInput['status'] = {
  in: ['ACTIVE', 'OVERDUE', 'DEFAULTED', 'DEFAULT'],
};

export interface ParThresholdRow {
  threshold: number;
  label: string;
  loanCount: number;
  /** Still-unpaid instalments on those loans. */
  overdueAmount: number;
  /** The whole outstanding balance of those loans - what is at risk. */
  exposure: number;
  /** exposure / active portfolio outstanding, as a percentage. */
  ratio: number;
}

export interface ParBucketRow {
  key: AgingBucketKey;
  label: string;
  loanCount: number;
  overdueAmount: number;
  exposure: number;
  ratio: number;
}

export interface ParCurrencySummary {
  currency: string;
  /** Outstanding across every active loan - the denominator of every ratio. */
  portfolioOutstanding: number;
  loansInArrears: number;
  totalOverdue: number;
  totalExposure: number;
  /** Cumulative. Do not add these together. */
  thresholds: ParThresholdRow[];
  /** Mutually exclusive. These do sum to the arrears total. */
  buckets: ParBucketRow[];
}

export interface ParLoanRow {
  loanId: string;
  loanNumber: string;
  clientId: string;
  clientName: string;
  clientNumber: string | null;
  clientPhone: string | null;
  branchName: string;
  loanOfficerName: string;
  productName: string;
  currency: string;
  daysOverdue: number;
  oldestUnpaidDueDate: string | null;
  overdueInstalments: number;
  overdueAmount: number;
  overduePrincipal: number;
  overdueInterest: number;
  /** The loan's complete outstanding exposure. */
  totalOutstanding: number;
  bucket: AgingBucketKey;
  /** Which cumulative thresholds this loan falls into. */
  thresholds: number[];
  status: string;
}

export interface ParReportResult {
  meta: ReportMeta;
  byCurrency: ParCurrencySummary[];
  rows: ParLoanRow[];
  totalRows: number;
  reconciliation: ReconciliationCheck[];
}

export interface ParReportOptions extends ReportFilters {
  page?: number;
  pageSize?: number;
  sortBy?: keyof ParLoanRow;
  sortDirection?: 'asc' | 'desc';
}

export async function buildParReport(
  options: ParReportOptions,
  user: ReportUser | null
): Promise<ParReportResult> {
  const asOf = endOfDay(options.asOfDate ?? new Date());

  const where: Prisma.LoanWhereInput = {
    organizationId: options.organizationId,
    status: AT_RISK_STATUSES,
    disbursedDate: { lte: asOf },
  };

  if (options.branchId) where.branchId = options.branchId;
  if (options.productId) where.productId = options.productId;
  if (options.loanOfficerId) where.loanOfficerId = options.loanOfficerId;
  if (options.currency) where.currency = options.currency as never;

  const loans = await prisma.loan.findMany({
    where,
    select: {
      id: true,
      loanNumber: true,
      currency: true,
      status: true,
      clientId: true,
      principalBalance: true,
      interestBalance: true,
      penaltyBalance: true,
      product: { select: { name: true } },
      branch: { select: { name: true } },
      loanOfficer: { select: { firstName: true, lastName: true } },
      client: {
        select: {
          clientNumber: true,
          firstName: true,
          lastName: true,
          businessName: true,
          phone: true,
        },
      },
      repaymentSchedule: {
        select: {
          dueDate: true,
          principalAmount: true,
          interestAmount: true,
          totalAmount: true,
          paidAmount: true,
          status: true,
        },
        orderBy: { dueDate: 'asc' },
      },
    },
  });

  /** The denominator: every active loan, in arrears or not. */
  const portfolio = new CurrencyBook<Measure>(MEASURES);

  /** Per currency, per threshold and per bucket. */
  const thresholdBooks = new Map<number, CurrencyBook<Measure>>();
  for (const threshold of PAR_THRESHOLDS) {
    thresholdBooks.set(threshold, new CurrencyBook<Measure>(MEASURES));
  }
  const bucketBooks = new Map<AgingBucketKey, CurrencyBook<Measure>>();
  for (const bucket of AGING_BUCKETS) {
    bucketBooks.set(bucket.key, new CurrencyBook<Measure>(MEASURES));
  }

  const arrearsBook = new CurrencyBook<Measure>(MEASURES);
  const rows: ParLoanRow[] = [];

  for (const loan of loans) {
    const currency = loan.currency ?? 'USD';

    // The loan's whole exposure, from its parts.
    const exposure = toMoney(loan.principalBalance)
      .add(toMoney(loan.interestBalance))
      .add(toMoney(loan.penaltyBalance));

    portfolio.add(currency, 'portfolio', exposure);
    portfolio.count(currency);

    const arrears = loanArrears(loan.repaymentSchedule, asOf);
    if (!arrears.inArrears) continue;

    arrearsBook.addMany(currency, {
      overdueAmount: arrears.overdueAmount,
      exposure,
    });
    arrearsBook.count(currency);

    const thresholds = PAR_THRESHOLDS.filter(
      threshold => arrears.daysOverdue >= threshold
    );

    for (const threshold of thresholds) {
      const book = thresholdBooks.get(threshold)!;
      book.addMany(currency, {
        overdueAmount: arrears.overdueAmount,
        exposure,
      });
      book.count(currency);
    }

    const bucketKey = agingBucketFor(arrears.daysOverdue);
    const bucketBook = bucketBooks.get(bucketKey)!;
    bucketBook.addMany(currency, {
      overdueAmount: arrears.overdueAmount,
      exposure,
    });
    bucketBook.count(currency);

    const clientName =
      [loan.client?.firstName, loan.client?.lastName]
        .filter(Boolean)
        .join(' ') ||
      loan.client?.businessName ||
      'Unknown client';

    rows.push({
      loanId: loan.id,
      loanNumber: loan.loanNumber,
      clientId: loan.clientId,
      clientName,
      clientNumber: loan.client?.clientNumber ?? null,
      clientPhone: loan.client?.phone ?? null,
      branchName: loan.branch?.name ?? 'No branch',
      loanOfficerName:
        [loan.loanOfficer?.firstName, loan.loanOfficer?.lastName]
          .filter(Boolean)
          .join(' ') || '-',
      productName: loan.product?.name ?? 'No product',
      currency,
      daysOverdue: arrears.daysOverdue,
      oldestUnpaidDueDate: arrears.oldestUnpaidDueDate?.toISOString() ?? null,
      overdueInstalments: arrears.overdueInstalments,
      overdueAmount: moneyToNumber(roundMoney(arrears.overdueAmount)),
      overduePrincipal: moneyToNumber(roundMoney(arrears.overduePrincipal)),
      overdueInterest: moneyToNumber(roundMoney(arrears.overdueInterest)),
      totalOutstanding: moneyToNumber(roundMoney(exposure)),
      bucket: bucketKey,
      thresholds: [...thresholds],
      status: loan.status,
    });
  }

  // ---- per-currency summary ----------------------------------------------
  const byCurrency: ParCurrencySummary[] = portfolio.currencies().map(currency => {
    const denominator = portfolio.get(currency, 'portfolio');

    return {
      currency,
      portfolioOutstanding: moneyToNumber(roundMoney(denominator)),
      loansInArrears: arrearsBook.countOf(currency),
      totalOverdue: moneyToNumber(
        roundMoney(arrearsBook.get(currency, 'overdueAmount'))
      ),
      totalExposure: moneyToNumber(
        roundMoney(arrearsBook.get(currency, 'exposure'))
      ),
      thresholds: PAR_THRESHOLDS.map(threshold => {
        const book = thresholdBooks.get(threshold)!;
        return {
          threshold,
          label: `PAR${threshold}`,
          loanCount: book.countOf(currency),
          overdueAmount: moneyToNumber(
            roundMoney(book.get(currency, 'overdueAmount'))
          ),
          exposure: moneyToNumber(roundMoney(book.get(currency, 'exposure'))),
          ratio: percentOf(book.get(currency, 'exposure'), denominator),
        };
      }),
      buckets: AGING_BUCKETS.filter(bucket => bucket.key !== 'CURRENT').map(
        bucket => {
          const book = bucketBooks.get(bucket.key)!;
          return {
            key: bucket.key,
            label: bucket.label,
            loanCount: book.countOf(currency),
            overdueAmount: moneyToNumber(
              roundMoney(book.get(currency, 'overdueAmount'))
            ),
            exposure: moneyToNumber(roundMoney(book.get(currency, 'exposure'))),
            ratio: percentOf(book.get(currency, 'exposure'), denominator),
          };
        }
      ),
    };
  });

  // ---- reconciliation ----------------------------------------------------
  const reconciliation: ReconciliationCheck[] = [];

  for (const currency of portfolio.currencies()) {
    /**
     * The exclusive buckets must sum to the arrears total. The cumulative
     * thresholds must not, and are deliberately not asserted to - if they ever
     * did, one of them would be wrong.
     */
    const bucketSum = AGING_BUCKETS.filter(b => b.key !== 'CURRENT').reduce(
      (sum, bucket) =>
        sum.add(bucketBooks.get(bucket.key)!.get(currency, 'overdueAmount')),
      new Prisma.Decimal(0)
    );

    reconciliation.push(
      checkReconciliation(
        'sum(exclusive aging buckets) = total overdue',
        currency,
        arrearsBook.get(currency, 'overdueAmount'),
        bucketSum
      )
    );

    // PAR1 is every loan at least a day late, which is every loan in arrears.
    const par1 = thresholdBooks.get(1)!;
    reconciliation.push(
      checkReconciliation(
        'PAR1 exposure = total exposure of loans in arrears',
        currency,
        arrearsBook.get(currency, 'exposure'),
        par1.get(currency, 'exposure')
      )
    );

    // The summary agrees with the rows beneath it.
    const rowOverdue = rows
      .filter(row => row.currency === currency)
      .reduce(
        (sum, row) => sum.add(toMoney(row.overdueAmount)),
        new Prisma.Decimal(0)
      );

    reconciliation.push(
      checkReconciliation(
        'summary.totalOverdue = sum(detail rows.overdueAmount)',
        currency,
        rowOverdue,
        arrearsBook.get(currency, 'overdueAmount')
      )
    );
  }

  // ---- sorting and pagination -------------------------------------------
  const sortBy = options.sortBy ?? 'daysOverdue';
  const direction = options.sortDirection === 'asc' ? 1 : -1;

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
    meta: buildMeta('Portfolio at Risk', options, user, totalRows === 0),
    byCurrency,
    rows: paged,
    totalRows,
    reconciliation,
  };
}
