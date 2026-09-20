import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import {
  CurrencyBook,
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
  type AgingBucketKey,
} from './arrears.calc';

/**
 * How old the arrears are.
 *
 * ---------------------------------------------------------------------------
 * Formulas
 * ---------------------------------------------------------------------------
 *   totalArrears = overduePrincipal + overdueInterest + overduePenalties
 *                  + unpaidCharges
 *
 *   Overdue principal and interest come from `instalmentArrears`, which splits
 *   a part-paid instalment by the payment waterfall rather than charging the
 *   whole instalment to arrears - the defect this report replaces. See
 *   arrears.calc.ts for the derivation.
 *
 *   Penalties and unpaid charges were missing entirely: the schedule carries no
 *   penalty column, so penalties come from the loan's `penaltyBalance` and
 *   unpaid charges from its `loanCharges` that are still outstanding. Without
 *   them the report understated what a delinquent client actually owed.
 *
 * The buckets are MUTUALLY EXCLUSIVE - each loan lands in exactly one - so they
 * sum to the arrears total, which is asserted below. (PAR thresholds are the
 * cumulative measure; they live in par.report.ts and are never mixed in here.)
 *
 * Every figure is per currency.
 */

const MEASURES = [
  'overduePrincipal',
  'overdueInterest',
  'overduePenalties',
  'unpaidCharges',
  'totalArrears',
  'totalExposure',
] as const;

type Measure = (typeof MEASURES)[number];

export interface AgingBucketTotals {
  key: AgingBucketKey;
  label: string;
  loanCount: number;
  clientCount: number;
  overduePrincipal: number;
  overdueInterest: number;
  overduePenalties: number;
  unpaidCharges: number;
  totalArrears: number;
  totalExposure: number;
}

export interface AgingCurrencySummary {
  currency: string;
  loanCount: number;
  clientCount: number;
  totalArrears: number;
  totalExposure: number;
  buckets: AgingBucketTotals[];
}

export interface AgingLoanRow {
  loanId: string;
  loanNumber: string;
  clientId: string;
  clientName: string;
  clientNumber: string | null;
  clientPhone: string | null;
  clientEmail: string | null;
  branchName: string;
  loanOfficerName: string;
  productName: string;
  currency: string;
  bucket: AgingBucketKey;
  bucketLabel: string;
  oldestUnpaidDueDate: string | null;
  daysOverdue: number;
  overduePrincipal: number;
  overdueInterest: number;
  overduePenalties: number;
  unpaidCharges: number;
  amountOverdue: number;
  totalOutstanding: number;
  lastPaymentDate: string | null;
  /** What should happen next, from how late it is. */
  nextCollectionAction: string;
}

export interface AgingReportResult {
  meta: ReportMeta;
  byCurrency: AgingCurrencySummary[];
  rows: AgingLoanRow[];
  totalRows: number;
  reconciliation: ReconciliationCheck[];
}

export interface AgingReportOptions extends ReportFilters {
  page?: number;
  pageSize?: number;
  sortBy?: keyof AgingLoanRow;
  sortDirection?: 'asc' | 'desc';
  bucket?: AgingBucketKey;
}

/**
 * The next step, from how late the loan is.
 *
 * Advisory rather than enforced - it tells a collections officer where to start
 * on a list of a hundred rows, which is what the report is for.
 */
function collectionAction(daysOverdue: number): string {
  if (daysOverdue === 0) return 'No action - not yet due';
  if (daysOverdue <= 7) return 'Courtesy reminder (SMS or call)';
  if (daysOverdue <= 30) return 'Follow-up call and payment arrangement';
  if (daysOverdue <= 60) return 'Field visit and formal demand';
  if (daysOverdue <= 90) return 'Final demand letter';
  if (daysOverdue <= 180) return 'Escalate to recovery / guarantor';
  return 'Consider write-off or legal action';
}

export async function buildArrearsAging(
  options: AgingReportOptions,
  user: ReportUser | null
): Promise<AgingReportResult> {
  const asOf = endOfDay(options.asOfDate ?? new Date());

  const where: Prisma.LoanWhereInput = {
    organizationId: options.organizationId,
    status: { in: ['ACTIVE', 'OVERDUE', 'DEFAULTED', 'DEFAULT'] },
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
      clientId: true,
      principalBalance: true,
      interestBalance: true,
      penaltyBalance: true,
      lastPaymentDate: true,
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
          email: true,
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
      /**
       * Charges still owed. A charge deducted at disbursement was settled then;
       * one added to the loan and not yet paid is arrears like any other.
       */
      loanCharges: {
        where: {
          isWaived: false,
          isDeductedFromPrincipal: false,
          status: { not: 'COMPLETED' },
        },
        select: { calculatedAmount: true, paidAmount: true },
      },
    },
  });

  const bucketBooks = new Map<AgingBucketKey, CurrencyBook<Measure>>();
  const bucketClients = new Map<AgingBucketKey, Map<string, Set<string>>>();
  for (const bucket of AGING_BUCKETS) {
    bucketBooks.set(bucket.key, new CurrencyBook<Measure>(MEASURES));
    bucketClients.set(bucket.key, new Map());
  }

  const totals = new CurrencyBook<Measure>(MEASURES);
  const clientsByCurrency = new Map<string, Set<string>>();
  const rows: AgingLoanRow[] = [];

  for (const loan of loans) {
    const currency = loan.currency ?? 'USD';
    const arrears = loanArrears(loan.repaymentSchedule, asOf);

    const exposure = toMoney(loan.principalBalance)
      .add(toMoney(loan.interestBalance))
      .add(toMoney(loan.penaltyBalance));

    // Penalties are a loan-level balance; the schedule has no column for them.
    const penalties = toMoney(loan.penaltyBalance);

    const unpaidCharges = loan.loanCharges.reduce(
      (sum, charge) =>
        sum.add(
          toMoney(charge.calculatedAmount).sub(toMoney(charge.paidAmount))
        ),
      new Prisma.Decimal(0)
    );

    const totalArrears = arrears.overduePrincipal
      .add(arrears.overdueInterest)
      .add(penalties)
      .add(unpaidCharges);

    // A loan with nothing overdue and nothing unpaid is current; it is counted
    // in the CURRENT bucket for exposure but carries no arrears.
    const bucketKey: AgingBucketKey = totalArrears.greaterThan(0)
      ? agingBucketFor(arrears.daysOverdue)
      : 'CURRENT';

    if (options.bucket && options.bucket !== bucketKey) continue;

    const measures = {
      overduePrincipal: arrears.overduePrincipal,
      overdueInterest: arrears.overdueInterest,
      overduePenalties: penalties,
      unpaidCharges,
      totalArrears,
      totalExposure: exposure,
    };

    const book = bucketBooks.get(bucketKey)!;
    book.addMany(currency, measures);
    book.count(currency);

    const clientsInBucket = bucketClients.get(bucketKey)!;
    if (!clientsInBucket.has(currency)) clientsInBucket.set(currency, new Set());
    clientsInBucket.get(currency)!.add(loan.clientId);

    totals.addMany(currency, measures);
    totals.count(currency);
    if (!clientsByCurrency.has(currency))
      clientsByCurrency.set(currency, new Set());
    clientsByCurrency.get(currency)!.add(loan.clientId);

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
      clientEmail: loan.client?.email ?? null,
      branchName: loan.branch?.name ?? 'No branch',
      loanOfficerName:
        [loan.loanOfficer?.firstName, loan.loanOfficer?.lastName]
          .filter(Boolean)
          .join(' ') || '-',
      productName: loan.product?.name ?? 'No product',
      currency,
      bucket: bucketKey,
      bucketLabel:
        AGING_BUCKETS.find(bucket => bucket.key === bucketKey)?.label ??
        bucketKey,
      oldestUnpaidDueDate: arrears.oldestUnpaidDueDate?.toISOString() ?? null,
      daysOverdue: arrears.daysOverdue,
      overduePrincipal: moneyToNumber(roundMoney(arrears.overduePrincipal)),
      overdueInterest: moneyToNumber(roundMoney(arrears.overdueInterest)),
      overduePenalties: moneyToNumber(roundMoney(penalties)),
      unpaidCharges: moneyToNumber(roundMoney(unpaidCharges)),
      amountOverdue: moneyToNumber(roundMoney(totalArrears)),
      totalOutstanding: moneyToNumber(roundMoney(exposure)),
      lastPaymentDate: loan.lastPaymentDate?.toISOString() ?? null,
      nextCollectionAction: collectionAction(arrears.daysOverdue),
    });
  }

  // ---- per-currency summary ----------------------------------------------
  const byCurrency: AgingCurrencySummary[] = totals.currencies().map(currency => ({
    currency,
    loanCount: totals.countOf(currency),
    clientCount: clientsByCurrency.get(currency)?.size ?? 0,
    totalArrears: moneyToNumber(roundMoney(totals.get(currency, 'totalArrears'))),
    totalExposure: moneyToNumber(
      roundMoney(totals.get(currency, 'totalExposure'))
    ),
    buckets: AGING_BUCKETS.map(bucket => {
      const book = bucketBooks.get(bucket.key)!;
      return {
        key: bucket.key,
        label: bucket.label,
        loanCount: book.countOf(currency),
        clientCount: bucketClients.get(bucket.key)?.get(currency)?.size ?? 0,
        overduePrincipal: moneyToNumber(
          roundMoney(book.get(currency, 'overduePrincipal'))
        ),
        overdueInterest: moneyToNumber(
          roundMoney(book.get(currency, 'overdueInterest'))
        ),
        overduePenalties: moneyToNumber(
          roundMoney(book.get(currency, 'overduePenalties'))
        ),
        unpaidCharges: moneyToNumber(
          roundMoney(book.get(currency, 'unpaidCharges'))
        ),
        totalArrears: moneyToNumber(
          roundMoney(book.get(currency, 'totalArrears'))
        ),
        totalExposure: moneyToNumber(
          roundMoney(book.get(currency, 'totalExposure'))
        ),
      };
    }),
  }));

  // ---- reconciliation ----------------------------------------------------
  const reconciliation: ReconciliationCheck[] = [];

  for (const currency of totals.currencies()) {
    reconciliation.push(
      checkReconciliation(
        'totalArrears = overduePrincipal + overdueInterest + overduePenalties + unpaidCharges',
        currency,
        totals
          .get(currency, 'overduePrincipal')
          .add(totals.get(currency, 'overdueInterest'))
          .add(totals.get(currency, 'overduePenalties'))
          .add(totals.get(currency, 'unpaidCharges')),
        totals.get(currency, 'totalArrears')
      )
    );

    const bucketSum = AGING_BUCKETS.reduce(
      (sum, bucket) =>
        sum.add(bucketBooks.get(bucket.key)!.get(currency, 'totalArrears')),
      new Prisma.Decimal(0)
    );

    reconciliation.push(
      checkReconciliation(
        'sum(exclusive buckets) = totalArrears',
        currency,
        totals.get(currency, 'totalArrears'),
        bucketSum
      )
    );

    const rowSum = rows
      .filter(row => row.currency === currency)
      .reduce(
        (sum, row) => sum.add(toMoney(row.amountOverdue)),
        new Prisma.Decimal(0)
      );

    reconciliation.push(
      checkReconciliation(
        'summary.totalArrears = sum(detail rows.amountOverdue)',
        currency,
        rowSum,
        totals.get(currency, 'totalArrears')
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
    meta: buildMeta('Arrears Aging Analysis', options, user, totalRows === 0),
    byCurrency,
    rows: paged,
    totalRows,
    reconciliation,
  };
}
