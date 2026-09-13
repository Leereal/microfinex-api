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
 * Money actually received.
 *
 * ---------------------------------------------------------------------------
 * Formulas
 * ---------------------------------------------------------------------------
 *   amount = principalAmount + interestAmount + penaltyAmount + chargeAmount
 *
 *   That identity is asserted per currency and per row; a payment whose
 *   components do not add to its amount is an allocation bug, and the report
 *   says so rather than quietly reporting a total nobody can break down.
 *
 * ---------------------------------------------------------------------------
 * What counts as collected
 * ---------------------------------------------------------------------------
 * Only COMPLETED repayments. Specifically excluded:
 *
 *   LOAN_DISBURSEMENT / LOAN_TOPUP - money going *out*. These sit in the same
 *     table as repayments and were being counted as collections, so a branch
 *     that had disbursed heavily looked like it had collected heavily.
 *   PENDING / FAILED / CANCELLED  - never landed.
 *   REVERSED                      - landed and was given back. Reported
 *     separately as `reversedAmount`, because "we collected X and reversed Y"
 *     is the honest statement; netting them hides the reversal entirely.
 *
 * Every figure is per currency.
 */

const MEASURES = [
  'totalCollected',
  'principalCollected',
  'interestCollected',
  'penaltiesCollected',
  'chargesCollected',
] as const;

type Measure = (typeof MEASURES)[number];

/** Money paid out, never collected. */
const ADVANCE_TYPES = ['LOAN_DISBURSEMENT', 'LOAN_TOPUP'] as const;

export type CollectionGrouping =
  | 'day'
  | 'week'
  | 'month'
  | 'branch'
  | 'officer'
  | 'paymentMethod'
  | 'product'
  | 'currency';

export interface CollectionCurrencyTotals {
  currency: string;
  totalCollected: number;
  principalCollected: number;
  interestCollected: number;
  penaltiesCollected: number;
  chargesCollected: number;
  paymentCount: number;
  uniqueClients: number;
  averagePayment: number;
  /** Payments taken in the period and later reversed. Not part of the total. */
  reversedAmount: number;
  reversedCount: number;
}

export interface CollectionRow {
  paymentId: string;
  receiptNumber: string;
  paymentDate: string;
  /** When the money is treated as received, which is the payment date here. */
  valueDate: string;
  loanId: string;
  loanNumber: string;
  clientId: string;
  clientName: string;
  clientNumber: string | null;
  branchName: string;
  loanOfficerName: string;
  productName: string;
  collectorName: string;
  method: string;
  reference: string | null;
  currency: string;
  amount: number;
  principalAmount: number;
  interestAmount: number;
  penaltyAmount: number;
  chargeAmount: number;
  status: string;
  isReversed: boolean;
  reversedAt: string | null;
  reversalReason: string | null;
}

export interface CollectionsReportResult {
  meta: ReportMeta;
  byCurrency: CollectionCurrencyTotals[];
  breakdown: {
    grouping: CollectionGrouping;
    rows: ReturnType<GroupedCurrencyBook<Measure>['toRows']>;
  };
  rows: CollectionRow[];
  totalRows: number;
  reconciliation: ReconciliationCheck[];
}

export interface CollectionsReportOptions extends ReportFilters {
  groupBy?: CollectionGrouping;
  page?: number;
  pageSize?: number;
  sortBy?: keyof CollectionRow;
  sortDirection?: 'asc' | 'desc';
  /** Include reversed payments in the detail rows, flagged. Default true. */
  includeReversed?: boolean;
}

const weekKey = (date: Date): string => {
  const monday = new Date(date);
  const offset = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - offset);
  return monday.toISOString().slice(0, 10);
};

export async function buildCollectionsReport(
  options: CollectionsReportOptions,
  user: ReportUser | null
): Promise<CollectionsReportResult> {
  const from = options.from ? startOfDay(options.from) : undefined;
  const to = endOfDay(options.to ?? options.asOfDate ?? new Date());

  const where: Prisma.PaymentWhereInput = {
    loan: {
      organizationId: options.organizationId,
      ...(options.branchId ? { branchId: options.branchId } : {}),
      ...(options.productId ? { productId: options.productId } : {}),
      ...(options.loanOfficerId ? { loanOfficerId: options.loanOfficerId } : {}),
      ...(options.currency ? { currency: options.currency as never } : {}),
    },
    // Money out is not a collection, whatever table it lives in.
    type: { notIn: [...ADVANCE_TYPES] },
    // Never landed, or landed and was returned - both reported separately.
    status: { in: ['COMPLETED', 'REVERSED'] },
    paymentDate: { ...(from ? { gte: from } : {}), lte: to },
  };

  const payments = await prisma.payment.findMany({
    where,
    select: {
      id: true,
      paymentNumber: true,
      paymentDate: true,
      amount: true,
      principalAmount: true,
      interestAmount: true,
      penaltyAmount: true,
      method: true,
      status: true,
      transactionRef: true,
      reversedAt: true,
      reversalReason: true,
      loanId: true,
      receiver: { select: { firstName: true, lastName: true } },
      loan: {
        select: {
          loanNumber: true,
          currency: true,
          clientId: true,
          branchId: true,
          productId: true,
          loanOfficerId: true,
          branch: { select: { name: true } },
          product: { select: { name: true } },
          loanOfficer: { select: { firstName: true, lastName: true } },
          client: {
            select: {
              clientNumber: true,
              firstName: true,
              lastName: true,
              businessName: true,
            },
          },
        },
      },
    },
    orderBy: { paymentDate: 'desc' },
  });

  const collected = new CurrencyBook<Measure>(MEASURES);
  const reversed = new CurrencyBook<'reversedAmount'>(['reversedAmount']);
  const clientsByCurrency = new Map<string, Set<string>>();

  const grouping = options.groupBy ?? 'month';
  const breakdown = new GroupedCurrencyBook<Measure>(MEASURES);

  const rows: CollectionRow[] = [];

  for (const payment of payments) {
    const currency = payment.loan?.currency ?? 'USD';
    const isReversed = payment.status === 'REVERSED';

    const amount = toMoney(payment.amount);
    const principal = toMoney(payment.principalAmount);
    const interest = toMoney(payment.interestAmount);
    const penalty = toMoney(payment.penaltyAmount);

    /**
     * Charges have no column on a payment, so they are whatever the amount is
     * over and above the three that do. Deriving rather than assuming keeps the
     * identity `amount = principal + interest + penalty + charges` true by
     * construction, and any allocation bug shows up as a charge figure that
     * makes no sense rather than as a silent imbalance.
     */
    const charges = amount.sub(principal).sub(interest).sub(penalty);

    if (isReversed) {
      reversed.add(currency, 'reversedAmount', amount);
      reversed.count(currency);
    } else {
      collected.addMany(currency, {
        totalCollected: amount,
        principalCollected: principal,
        interestCollected: interest,
        penaltiesCollected: penalty,
        chargesCollected: charges,
      });
      collected.count(currency);

      if (!clientsByCurrency.has(currency))
        clientsByCurrency.set(currency, new Set());
      clientsByCurrency.get(currency)!.add(payment.loan!.clientId);

      const loan = payment.loan!;
      const officer =
        [loan.loanOfficer?.firstName, loan.loanOfficer?.lastName]
          .filter(Boolean)
          .join(' ') || 'Unassigned';

      const groupKey =
        grouping === 'day'
          ? payment.paymentDate.toISOString().slice(0, 10)
          : grouping === 'week'
            ? weekKey(payment.paymentDate)
            : grouping === 'month'
              ? payment.paymentDate.toISOString().slice(0, 7)
              : grouping === 'branch'
                ? (loan.branchId ?? 'none')
                : grouping === 'officer'
                  ? (loan.loanOfficerId ?? 'none')
                  : grouping === 'paymentMethod'
                    ? payment.method
                    : grouping === 'product'
                      ? (loan.productId ?? 'none')
                      : currency;

      const groupLabel =
        grouping === 'branch'
          ? (loan.branch?.name ?? 'No branch')
          : grouping === 'officer'
            ? officer
            : grouping === 'product'
              ? (loan.product?.name ?? 'No product')
              : groupKey;

      breakdown.add(groupKey, groupLabel, currency, {
        totalCollected: amount,
        principalCollected: principal,
        interestCollected: interest,
        penaltiesCollected: penalty,
        chargesCollected: charges,
      });
    }

    if (isReversed && options.includeReversed === false) continue;

    const loan = payment.loan!;
    const clientName =
      [loan.client?.firstName, loan.client?.lastName].filter(Boolean).join(' ') ||
      loan.client?.businessName ||
      'Unknown client';

    rows.push({
      paymentId: payment.id,
      receiptNumber: payment.paymentNumber,
      paymentDate: payment.paymentDate.toISOString(),
      valueDate: payment.paymentDate.toISOString(),
      loanId: payment.loanId,
      loanNumber: loan.loanNumber,
      clientId: loan.clientId,
      clientName,
      clientNumber: loan.client?.clientNumber ?? null,
      branchName: loan.branch?.name ?? 'No branch',
      loanOfficerName:
        [loan.loanOfficer?.firstName, loan.loanOfficer?.lastName]
          .filter(Boolean)
          .join(' ') || 'Unassigned',
      productName: loan.product?.name ?? 'No product',
      collectorName:
        [payment.receiver?.firstName, payment.receiver?.lastName]
          .filter(Boolean)
          .join(' ') || '-',
      method: payment.method,
      reference: payment.transactionRef,
      currency,
      amount: moneyToNumber(roundMoney(amount)),
      principalAmount: moneyToNumber(roundMoney(principal)),
      interestAmount: moneyToNumber(roundMoney(interest)),
      penaltyAmount: moneyToNumber(roundMoney(penalty)),
      chargeAmount: moneyToNumber(roundMoney(charges)),
      status: payment.status,
      isReversed,
      reversedAt: payment.reversedAt?.toISOString() ?? null,
      reversalReason: payment.reversalReason ?? null,
    });
  }

  // ---- per-currency summary ----------------------------------------------
  const currencies = new Set([
    ...collected.currencies(),
    ...reversed.currencies(),
  ]);

  const byCurrency: CollectionCurrencyTotals[] = [...currencies]
    .sort()
    .map(currency => {
      const count = collected.countOf(currency);
      const total = collected.get(currency, 'totalCollected');

      return {
        currency,
        totalCollected: moneyToNumber(roundMoney(total)),
        principalCollected: moneyToNumber(
          roundMoney(collected.get(currency, 'principalCollected'))
        ),
        interestCollected: moneyToNumber(
          roundMoney(collected.get(currency, 'interestCollected'))
        ),
        penaltiesCollected: moneyToNumber(
          roundMoney(collected.get(currency, 'penaltiesCollected'))
        ),
        chargesCollected: moneyToNumber(
          roundMoney(collected.get(currency, 'chargesCollected'))
        ),
        paymentCount: count,
        uniqueClients: clientsByCurrency.get(currency)?.size ?? 0,
        averagePayment:
          count > 0 ? moneyToNumber(roundMoney(total.div(count))) : 0,
        reversedAmount: moneyToNumber(
          roundMoney(reversed.get(currency, 'reversedAmount'))
        ),
        reversedCount: reversed.countOf(currency),
      };
    });

  // ---- reconciliation ----------------------------------------------------
  const reconciliation: ReconciliationCheck[] = [];

  for (const currency of collected.currencies()) {
    reconciliation.push(
      checkReconciliation(
        'totalCollected = principal + interest + penalty + charges',
        currency,
        collected
          .get(currency, 'principalCollected')
          .add(collected.get(currency, 'interestCollected'))
          .add(collected.get(currency, 'penaltiesCollected'))
          .add(collected.get(currency, 'chargesCollected')),
        collected.get(currency, 'totalCollected')
      )
    );

    const rowSum = rows
      .filter(row => row.currency === currency && !row.isReversed)
      .reduce((sum, row) => sum.add(toMoney(row.amount)), new Prisma.Decimal(0));

    reconciliation.push(
      checkReconciliation(
        'summary.totalCollected = sum(non-reversed detail rows.amount)',
        currency,
        rowSum,
        collected.get(currency, 'totalCollected')
      )
    );
  }

  // ---- sorting and pagination -------------------------------------------
  const sortBy = options.sortBy ?? 'paymentDate';
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
    meta: buildMeta('Collections Report', options, user, totalRows === 0),
    byCurrency,
    breakdown: { grouping, rows: breakdown.toRows() },
    rows: paged,
    totalRows,
    reconciliation,
  };
}
