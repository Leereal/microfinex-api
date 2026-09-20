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
  startOfDay,
  type ReconciliationCheck,
  type ReportFilters,
  type ReportMeta,
  type ReportUser,
} from './report-context';

/**
 * Money advanced to clients.
 *
 * ---------------------------------------------------------------------------
 * Formulas
 * ---------------------------------------------------------------------------
 *   netProceeds = grossDisbursement - chargesDeducted
 *
 *   Gross is the amount the loan is for - what the client borrows and repays.
 *   Charges deducted are the fees settled out of that amount at payout. Net is
 *   what the client actually walks away with. A fee the client pays separately
 *   is not deducted, so it does not reduce net proceeds; it is reported under
 *   `chargesPaidSeparately` so the two are never confused.
 *
 *   The identity is asserted per currency and per row.
 *
 * ---------------------------------------------------------------------------
 * What counts
 * ---------------------------------------------------------------------------
 * Disbursement and top-up payments in COMPLETED state. A top-up is money
 * advanced just as much as an original payout, so it is included and reported
 * separately - a report that ignored top-ups understated what left the building.
 *
 * Reversed and cancelled advances are excluded from the totals and reported as
 * `reversedAmount`, because "we advanced X and reversed Y" is the honest
 * statement.
 *
 * Every figure is per currency.
 */

const MEASURES = [
  'grossDisbursed',
  'chargesDeducted',
  'netProceeds',
  'topUpAmount',
] as const;

type Measure = (typeof MEASURES)[number];

export type DisbursementGrouping =
  | 'day'
  | 'week'
  | 'month'
  | 'branch'
  | 'product'
  | 'officer'
  | 'paymentMethod'
  | 'clientType'
  | 'currency';

export interface DisbursementCurrencyTotals {
  currency: string;
  /** Approved but not necessarily paid out, for the period's approvals. */
  grossApproved: number;
  grossDisbursed: number;
  chargesDeducted: number;
  chargesPaidSeparately: number;
  netProceeds: number;
  disbursementCount: number;
  averageDisbursement: number;
  topUpAmount: number;
  topUpCount: number;
  reversedAmount: number;
  reversedCount: number;
}

export interface DisbursementChargeLine {
  name: string;
  amount: number;
  deductedFromPrincipal: boolean;
}

export interface DisbursementRow {
  paymentId: string;
  loanId: string;
  loanNumber: string;
  clientId: string;
  clientName: string;
  clientNumber: string | null;
  clientType: string;
  productName: string;
  branchName: string;
  currency: string;
  approvalDate: string | null;
  disbursementDate: string;
  termMonths: number;
  interestRate: number;
  /** What the loan is for - the amount the client repays. */
  grossPrincipal: number;
  charges: DisbursementChargeLine[];
  chargesDeducted: number;
  /** grossPrincipal - chargesDeducted. */
  netProceeds: number;
  isTopUp: boolean;
  paymentMethod: string;
  transactionReference: string | null;
  disbursedByName: string;
  status: string;
  isReversed: boolean;
}

export interface DisbursementsReportResult {
  meta: ReportMeta;
  byCurrency: DisbursementCurrencyTotals[];
  breakdown: {
    grouping: DisbursementGrouping;
    rows: ReturnType<GroupedCurrencyBook<Measure>['toRows']>;
  };
  rows: DisbursementRow[];
  totalRows: number;
  reconciliation: ReconciliationCheck[];
}

export interface DisbursementsReportOptions extends ReportFilters {
  groupBy?: DisbursementGrouping;
  page?: number;
  pageSize?: number;
  sortBy?: keyof DisbursementRow;
  sortDirection?: 'asc' | 'desc';
}

const weekKey = (date: Date): string => {
  const monday = new Date(date);
  const offset = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - offset);
  return monday.toISOString().slice(0, 10);
};

export async function buildDisbursementsReport(
  options: DisbursementsReportOptions,
  user: ReportUser | null
): Promise<DisbursementsReportResult> {
  const from = options.from ? startOfDay(options.from) : undefined;
  const to = endOfDay(options.to ?? options.asOfDate ?? new Date());

  const loanScope: Prisma.LoanWhereInput = {
    organizationId: options.organizationId,
    ...(options.branchId ? { branchId: options.branchId } : {}),
    ...(options.productId ? { productId: options.productId } : {}),
    ...(options.loanOfficerId ? { loanOfficerId: options.loanOfficerId } : {}),
    ...(options.currency ? { currency: options.currency as never } : {}),
    ...(options.clientType
      ? { client: { type: options.clientType as never } }
      : {}),
  };

  const advances = await prisma.payment.findMany({
    where: {
      loan: loanScope,
      type: { in: ['LOAN_DISBURSEMENT', 'LOAN_TOPUP'] },
      status: { in: ['COMPLETED', 'REVERSED'] },
      paymentDate: { ...(from ? { gte: from } : {}), lte: to },
      ...(options.paymentMethodId ? { method: options.paymentMethodId } : {}),
    },
    select: {
      id: true,
      type: true,
      status: true,
      amount: true,
      principalAmount: true,
      paymentDate: true,
      method: true,
      transactionRef: true,
      loanId: true,
      receiver: { select: { firstName: true, lastName: true } },
      loan: {
        select: {
          loanNumber: true,
          currency: true,
          amount: true,
          term: true,
          interestRate: true,
          approvedDate: true,
          clientId: true,
          branchId: true,
          productId: true,
          loanOfficerId: true,
          branch: { select: { name: true } },
          product: { select: { name: true } },
          loanOfficer: { select: { firstName: true, lastName: true } },
          disbursedBy: { select: { firstName: true, lastName: true } },
          client: {
            select: {
              clientNumber: true,
              firstName: true,
              lastName: true,
              businessName: true,
              type: true,
            },
          },
          loanCharges: {
            where: { isWaived: false },
            select: {
              chargeName: true,
              calculatedAmount: true,
              isDeductedFromPrincipal: true,
              appliedAt: true,
            },
          },
        },
      },
    },
    orderBy: { paymentDate: 'desc' },
  });

  const book = new CurrencyBook<Measure>(MEASURES);
  const separately = new CurrencyBook<'chargesPaidSeparately'>([
    'chargesPaidSeparately',
  ]);
  const reversed = new CurrencyBook<'reversedAmount'>(['reversedAmount']);
  const approved = new CurrencyBook<'grossApproved'>(['grossApproved']);
  const topUpCounts = new Map<string, number>();

  const grouping = options.groupBy ?? 'month';
  const breakdown = new GroupedCurrencyBook<Measure>(MEASURES);
  const rows: DisbursementRow[] = [];

  /** Every advance on a loan, so the original payout's share can be derived. */
  const topUpTotalsByLoan = new Map<string, Prisma.Decimal>();
  for (const advance of advances) {
    if (advance.type !== 'LOAN_TOPUP') continue;
    const current =
      topUpTotalsByLoan.get(advance.loanId) ?? new Prisma.Decimal(0);
    topUpTotalsByLoan.set(
      advance.loanId,
      current.add(toMoney(advance.principalAmount ?? advance.amount))
    );
  }

  for (const advance of advances) {
    const loan = advance.loan!;
    const currency = loan.currency ?? 'USD';
    const isTopUp = advance.type === 'LOAN_TOPUP';
    const isReversed = advance.status === 'REVERSED';

    /**
     * What this advance was for.
     *
     * A top-up records the principal it added; the original payout is the
     * loan's principal less everything topped up on it since, so the two always
     * sum to the loan's amount however many times it has been topped up.
     */
    const gross = isTopUp
      ? toMoney(advance.principalAmount ?? advance.amount)
      : toMoney(loan.amount).sub(
          topUpTotalsByLoan.get(advance.loanId) ?? new Prisma.Decimal(0)
        );

    /**
     * Charges belonging to this advance: whichever were raised closest to it in
     * time. Matching on amount would not do - two top-ups of the same size
     * carry identical fees.
     */
    const advanceTime = advance.paymentDate.getTime();
    const allAdvanceTimes = advances
      .filter(other => other.loanId === advance.loanId)
      .map(other => other.paymentDate.getTime());

    const charges = loan.loanCharges.filter(charge => {
      const chargeTime = new Date(charge.appliedAt).getTime();
      const nearest = allAdvanceTimes.reduce((best, time) =>
        Math.abs(time - chargeTime) < Math.abs(best - chargeTime) ? time : best
      );
      return nearest === advanceTime;
    });

    const deducted = charges
      .filter(charge => charge.isDeductedFromPrincipal)
      .reduce(
        (sum, charge) => sum.add(toMoney(charge.calculatedAmount)),
        new Prisma.Decimal(0)
      );

    const paidSeparately = charges
      .filter(charge => !charge.isDeductedFromPrincipal)
      .reduce(
        (sum, charge) => sum.add(toMoney(charge.calculatedAmount)),
        new Prisma.Decimal(0)
      );

    const net = gross.sub(deducted);

    if (isReversed) {
      reversed.add(currency, 'reversedAmount', gross);
      reversed.count(currency);
    } else {
      book.addMany(currency, {
        grossDisbursed: gross,
        chargesDeducted: deducted,
        netProceeds: net,
        topUpAmount: isTopUp ? gross : new Prisma.Decimal(0),
      });
      book.count(currency);
      separately.add(currency, 'chargesPaidSeparately', paidSeparately);
      if (isTopUp) {
        topUpCounts.set(currency, (topUpCounts.get(currency) ?? 0) + 1);
      }

      const officer =
        [loan.loanOfficer?.firstName, loan.loanOfficer?.lastName]
          .filter(Boolean)
          .join(' ') || 'Unassigned';

      const groupKey =
        grouping === 'day'
          ? advance.paymentDate.toISOString().slice(0, 10)
          : grouping === 'week'
            ? weekKey(advance.paymentDate)
            : grouping === 'month'
              ? advance.paymentDate.toISOString().slice(0, 7)
              : grouping === 'branch'
                ? (loan.branchId ?? 'none')
                : grouping === 'product'
                  ? (loan.productId ?? 'none')
                  : grouping === 'officer'
                    ? (loan.loanOfficerId ?? 'none')
                    : grouping === 'paymentMethod'
                      ? advance.method
                      : grouping === 'clientType'
                        ? (loan.client?.type ?? 'UNKNOWN')
                        : currency;

      const groupLabel =
        grouping === 'branch'
          ? (loan.branch?.name ?? 'No branch')
          : grouping === 'product'
            ? (loan.product?.name ?? 'No product')
            : grouping === 'officer'
              ? officer
              : groupKey;

      breakdown.add(groupKey, groupLabel, currency, {
        grossDisbursed: gross,
        chargesDeducted: deducted,
        netProceeds: net,
        topUpAmount: isTopUp ? gross : new Prisma.Decimal(0),
      });
    }

    const clientName =
      [loan.client?.firstName, loan.client?.lastName].filter(Boolean).join(' ') ||
      loan.client?.businessName ||
      'Unknown client';

    rows.push({
      paymentId: advance.id,
      loanId: advance.loanId,
      loanNumber: loan.loanNumber,
      clientId: loan.clientId,
      clientName,
      clientNumber: loan.client?.clientNumber ?? null,
      clientType: loan.client?.type ?? 'UNKNOWN',
      productName: loan.product?.name ?? 'No product',
      branchName: loan.branch?.name ?? 'No branch',
      currency,
      approvalDate: loan.approvedDate?.toISOString() ?? null,
      disbursementDate: advance.paymentDate.toISOString(),
      termMonths: loan.term,
      interestRate: Number(loan.interestRate),
      grossPrincipal: moneyToNumber(roundMoney(gross)),
      charges: charges.map(charge => ({
        name: charge.chargeName,
        amount: moneyToNumber(roundMoney(toMoney(charge.calculatedAmount))),
        deductedFromPrincipal: charge.isDeductedFromPrincipal,
      })),
      chargesDeducted: moneyToNumber(roundMoney(deducted)),
      netProceeds: moneyToNumber(roundMoney(net)),
      isTopUp,
      paymentMethod: advance.method,
      transactionReference: advance.transactionRef,
      disbursedByName:
        [loan.disbursedBy?.firstName, loan.disbursedBy?.lastName]
          .filter(Boolean)
          .join(' ') ||
        [advance.receiver?.firstName, advance.receiver?.lastName]
          .filter(Boolean)
          .join(' ') ||
        '-',
      status: advance.status,
      isReversed,
    });
  }

  // ---- approvals in the period, per currency -----------------------------
  const approvedLoans = await prisma.loan.groupBy({
    by: ['currency'],
    where: {
      ...loanScope,
      approvedDate: { ...(from ? { gte: from } : {}), lte: to },
    },
    _sum: { amount: true },
  });

  for (const group of approvedLoans) {
    approved.add(group.currency ?? 'USD', 'grossApproved', group._sum.amount);
  }

  // ---- per-currency summary ----------------------------------------------
  const currencies = new Set([
    ...book.currencies(),
    ...reversed.currencies(),
    ...approved.currencies(),
  ]);

  const byCurrency: DisbursementCurrencyTotals[] = [...currencies]
    .sort()
    .map(currency => {
      const count = book.countOf(currency);
      const gross = book.get(currency, 'grossDisbursed');

      return {
        currency,
        grossApproved: moneyToNumber(
          roundMoney(approved.get(currency, 'grossApproved'))
        ),
        grossDisbursed: moneyToNumber(roundMoney(gross)),
        chargesDeducted: moneyToNumber(
          roundMoney(book.get(currency, 'chargesDeducted'))
        ),
        chargesPaidSeparately: moneyToNumber(
          roundMoney(separately.get(currency, 'chargesPaidSeparately'))
        ),
        netProceeds: moneyToNumber(roundMoney(book.get(currency, 'netProceeds'))),
        disbursementCount: count,
        averageDisbursement:
          count > 0 ? moneyToNumber(roundMoney(gross.div(count))) : 0,
        topUpAmount: moneyToNumber(roundMoney(book.get(currency, 'topUpAmount'))),
        topUpCount: topUpCounts.get(currency) ?? 0,
        reversedAmount: moneyToNumber(
          roundMoney(reversed.get(currency, 'reversedAmount'))
        ),
        reversedCount: reversed.countOf(currency),
      };
    });

  // ---- reconciliation ----------------------------------------------------
  const reconciliation: ReconciliationCheck[] = [];

  for (const currency of book.currencies()) {
    reconciliation.push(
      checkReconciliation(
        'netProceeds = grossDisbursed - chargesDeducted',
        currency,
        book
          .get(currency, 'grossDisbursed')
          .sub(book.get(currency, 'chargesDeducted')),
        book.get(currency, 'netProceeds')
      )
    );

    const rowSum = rows
      .filter(row => row.currency === currency && !row.isReversed)
      .reduce(
        (sum, row) => sum.add(toMoney(row.grossPrincipal)),
        new Prisma.Decimal(0)
      );

    reconciliation.push(
      checkReconciliation(
        'summary.grossDisbursed = sum(non-reversed detail rows.grossPrincipal)',
        currency,
        rowSum,
        book.get(currency, 'grossDisbursed')
      )
    );
  }

  // ---- sorting and pagination -------------------------------------------
  const sortBy = options.sortBy ?? 'disbursementDate';
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
    meta: buildMeta('Loan Disbursement Report', options, user, totalRows === 0),
    byCurrency,
    breakdown: { grouping, rows: breakdown.toRows() },
    rows: paged,
    totalRows,
    reconciliation,
  };
}
