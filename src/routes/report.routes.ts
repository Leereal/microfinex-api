/**
 * Report Routes
 *
 * The five core lending reports, each refactored onto a shared foundation:
 * per-currency totals that cannot be added together, Decimal arithmetic,
 * reconciliation assertions, and exports generated here from the server's own
 * filters rather than from rows posted back by the browser.
 *
 * Reading a report needs `reports:view`; downloading one needs
 * `reports:export` as well - a file leaves the building and can be forwarded,
 * so it is a separate grant.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  authenticateToken,
  requirePermission,
} from '../middleware/auth.middleware';
import { handleAsync } from '../middleware/validation.middleware';

import { buildPortfolioSummary } from '../services/reports/portfolio-summary.report';
import { buildParReport } from '../services/reports/par.report';
import { buildArrearsAging } from '../services/reports/arrears-aging.report';
import { buildCollectionsReport } from '../services/reports/collections.report';
import { buildDisbursementsReport } from '../services/reports/disbursements.report';
import {
  toCsv,
  toXlsx,
  toPdf,
  exportFileName,
  type ExportColumn,
  type ReportExport,
} from '../services/reports/report-export';
import type { ReportFilters, ReportUser } from '../services/reports/report-context';

const router = Router();

router.use(authenticateToken);

// ---------------------------------------------------------------- filters
const filterSchema = z.object({
  asOfDate: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  branchId: z.string().optional(),
  currency: z.string().optional(),
  productId: z.string().optional(),
  loanOfficerId: z.string().optional(),
  status: z.string().optional(),
  clientType: z.string().optional(),
  paymentMethodId: z.string().optional(),
  groupBy: z.string().optional(),
  bucket: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(500).optional(),
  sortBy: z.string().optional(),
  sortDirection: z.enum(['asc', 'desc']).optional(),
  format: z.enum(['json', 'csv', 'xlsx', 'pdf']).optional(),
});

const parseDate = (value?: string): Date | undefined => {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

interface ParsedRequest {
  filters: ReportFilters & Record<string, unknown>;
  format: 'json' | 'csv' | 'xlsx' | 'pdf';
  user: ReportUser | null;
}

/**
 * Every report is scoped to the caller's own organization, taken from the
 * session and never from the query string - a report that accepted an
 * organizationId would let any authenticated user read any other book.
 */
function parseRequest(req: Request): ParsedRequest {
  const query = filterSchema.parse(req.query);
  const organizationId = req.user?.organizationId;

  if (!organizationId) {
    throw Object.assign(new Error('Organization ID required'), { status: 400 });
  }

  const user = req.userContext ?? (req.user as unknown as ReportUser | undefined);

  return {
    filters: {
      organizationId,
      branchId: query.branchId,
      currency: query.currency,
      productId: query.productId,
      loanOfficerId: query.loanOfficerId,
      status: query.status,
      clientType: query.clientType,
      paymentMethodId: query.paymentMethodId,
      asOfDate: parseDate(query.asOfDate),
      from: parseDate(query.from),
      to: parseDate(query.to),
      groupBy: query.groupBy,
      bucket: query.bucket,
      // An export renders every matching row, not just the page on screen.
      page: query.format && query.format !== 'json' ? undefined : query.page,
      pageSize:
        query.format && query.format !== 'json' ? undefined : query.pageSize,
      sortBy: query.sortBy,
      sortDirection: query.sortDirection,
    },
    format: query.format ?? 'json',
    user: user
      ? {
          id: (user as ReportUser).id,
          firstName: (user as ReportUser).firstName,
          lastName: (user as ReportUser).lastName,
        }
      : null,
  };
}

/** Send a report as JSON, or as whichever file was asked for. */
async function respond<Row>(
  res: Response,
  format: 'json' | 'csv' | 'xlsx' | 'pdf',
  payload: unknown,
  buildExport: () => ReportExport<Row>
): Promise<void> {
  if (format === 'json') {
    res.json({ success: true, data: payload, timestamp: new Date().toISOString() });
    return;
  }

  const report = buildExport();

  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${exportFileName(report.meta, 'csv')}"`
    );
    res.send(toCsv(report));
    return;
  }

  if (format === 'xlsx') {
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${exportFileName(report.meta, 'xlsx')}"`
    );
    res.send(toXlsx(report));
    return;
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${exportFileName(report.meta, 'pdf')}"`
  );
  res.send(await toPdf(report));
}

/**
 * Downloading is a separate grant from reading.
 *
 * `reports:view` puts figures on a screen inside the application;
 * `reports:export` produces a file that leaves it. Whoever may do the second
 * must also be able to do the first, so both are required.
 */
function permissionsFor(req: Request): string[] {
  return req.query.format && req.query.format !== 'json'
    ? ['reports:view', 'reports:export']
    : ['reports:view'];
}

const guard = (handler: (req: Request, res: Response) => Promise<void>) =>
  handleAsync(async (req: Request, res: Response) => {
    for (const permission of permissionsFor(req)) {
      let denied = false;
      await new Promise<void>(resolve => {
        requirePermission(permission)(req, res, () => resolve());
        // requirePermission responds itself when it refuses.
        if (res.headersSent) {
          denied = true;
          resolve();
        }
      });
      if (denied || res.headersSent) return;
    }
    await handler(req, res);
  });

const money = <Row>(
  header: string,
  value: (row: Row) => number
): ExportColumn<Row> => ({ header, value, money: true });

/**
 * Build an export description with the row type inferred from the rows.
 *
 * Taking `rows` first is what lets TypeScript check every column accessor
 * against the shape it will actually receive - otherwise `Row` is inferred as
 * `unknown` and a typo in a column accessor reaches production as a blank cell.
 */
const exportOf = <Row>(
  rows: Row[],
  rest: Omit<ReportExport<Row>, 'rows'>
): ReportExport<Row> => ({ ...rest, rows });

// ====================================================== 1. Portfolio Summary
router.get(
  '/portfolio-summary',
  guard(async (req, res) => {
    const { filters, format, user } = parseRequest(req);
    const report = await buildPortfolioSummary(filters as never, user);

    await respond(res, format, report, () =>
      exportOf(report.rows, {
        meta: report.meta,
      sections: [
        {
          title: 'Portfolio by currency',
          headers: [
            'Currency',
            'Loans',
            'Original principal',
            'Total interest',
            'Principal outstanding',
            'Interest outstanding',
            'Penalty outstanding',
            'Total outstanding',
            'Average loan',
            'Average outstanding',
            'Active',
            'Overdue',
            'Completed',
            'Written off',
            'Pending',
          ],
          rows: report.byCurrency.map(row => [
            row.currency,
            row.loanCount,
            row.originalPrincipal,
            row.totalInterest,
            row.principalOutstanding,
            row.interestOutstanding,
            row.penaltyOutstanding,
            row.totalOutstanding,
            row.averageLoanSize,
            row.averageOutstanding,
            row.activeLoans,
            row.overdueLoans,
            row.completedLoans,
            row.writtenOffLoans,
            row.pendingApplications,
          ]),
        },
      ],
      columns: [
        { header: 'Loan number', value: r => r.loanNumber },
        { header: 'Client', value: r => r.clientName },
        { header: 'Client no', value: r => r.clientNumber },
        { header: 'Product', value: r => r.productName },
        { header: 'Branch', value: r => r.branchName },
        { header: 'Officer', value: r => r.loanOfficerName },
        { header: 'Currency', value: r => r.currency },
        {
          header: 'Disbursed',
          value: r => r.disbursementDate?.slice(0, 10) ?? '',
        },
        { header: 'Maturity', value: r => r.maturityDate?.slice(0, 10) ?? '' },
        { header: 'Status', value: r => r.status },
        money('Original amount', r => r.originalAmount),
        money('Principal balance', r => r.principalBalance),
        money('Interest balance', r => r.interestBalance),
        money('Penalty balance', r => r.penaltyBalance),
        money('Total outstanding', r => r.totalOutstanding),
      ],
        reconciliation: report.reconciliation,
      })
    );
  })
);

// ============================================================= 2. PAR
router.get(
  '/par',
  guard(async (req, res) => {
    const { filters, format, user } = parseRequest(req);
    const report = await buildParReport(filters as never, user);

    await respond(res, format, report, () =>
      exportOf(report.rows, {
        meta: report.meta,
      sections: [
        {
          title: 'PAR thresholds (cumulative - do not add these together)',
          headers: [
            'Currency',
            'Measure',
            'Loans',
            'Overdue amount',
            'Exposure at risk',
            'Ratio %',
          ],
          rows: report.byCurrency.flatMap(currency =>
            currency.thresholds.map(threshold => [
              currency.currency,
              threshold.label,
              threshold.loanCount,
              threshold.overdueAmount,
              threshold.exposure,
              threshold.ratio,
            ])
          ),
        },
        {
          title: 'Aging buckets (mutually exclusive - these do sum)',
          headers: [
            'Currency',
            'Bucket',
            'Loans',
            'Overdue amount',
            'Exposure',
            'Ratio %',
          ],
          rows: report.byCurrency.flatMap(currency =>
            currency.buckets.map(bucket => [
              currency.currency,
              bucket.label,
              bucket.loanCount,
              bucket.overdueAmount,
              bucket.exposure,
              bucket.ratio,
            ])
          ),
        },
      ],
      columns: [
        { header: 'Loan number', value: r => r.loanNumber },
        { header: 'Client', value: r => r.clientName },
        { header: 'Client no', value: r => r.clientNumber },
        { header: 'Phone', value: r => r.clientPhone },
        { header: 'Branch', value: r => r.branchName },
        { header: 'Officer', value: r => r.loanOfficerName },
        { header: 'Product', value: r => r.productName },
        { header: 'Currency', value: r => r.currency },
        { header: 'Days overdue', value: r => r.daysOverdue },
        {
          header: 'Oldest unpaid due',
          value: r => r.oldestUnpaidDueDate?.slice(0, 10) ?? '',
        },
        { header: 'Bucket', value: r => r.bucket },
        money('Overdue amount', r => r.overdueAmount),
        money('Overdue principal', r => r.overduePrincipal),
        money('Overdue interest', r => r.overdueInterest),
        money('Total outstanding', r => r.totalOutstanding),
      ],
        reconciliation: report.reconciliation,
      })
    );
  })
);

// ==================================================== 3. Arrears Aging
router.get(
  '/aging',
  guard(async (req, res) => {
    const { filters, format, user } = parseRequest(req);
    const report = await buildArrearsAging(filters as never, user);

    await respond(res, format, report, () =>
      exportOf(report.rows, {
        meta: report.meta,
      sections: [
        {
          title: 'Arrears by age (mutually exclusive buckets)',
          headers: [
            'Currency',
            'Bucket',
            'Loans',
            'Clients',
            'Overdue principal',
            'Overdue interest',
            'Penalties',
            'Unpaid charges',
            'Total arrears',
            'Total exposure',
          ],
          rows: report.byCurrency.flatMap(currency =>
            currency.buckets.map(bucket => [
              currency.currency,
              bucket.label,
              bucket.loanCount,
              bucket.clientCount,
              bucket.overduePrincipal,
              bucket.overdueInterest,
              bucket.overduePenalties,
              bucket.unpaidCharges,
              bucket.totalArrears,
              bucket.totalExposure,
            ])
          ),
        },
      ],
      columns: [
        { header: 'Loan number', value: r => r.loanNumber },
        { header: 'Client', value: r => r.clientName },
        { header: 'Client no', value: r => r.clientNumber },
        { header: 'Phone', value: r => r.clientPhone },
        { header: 'Email', value: r => r.clientEmail },
        { header: 'Branch', value: r => r.branchName },
        { header: 'Officer', value: r => r.loanOfficerName },
        { header: 'Currency', value: r => r.currency },
        { header: 'Bucket', value: r => r.bucketLabel },
        {
          header: 'Oldest unpaid',
          value: r => r.oldestUnpaidDueDate?.slice(0, 10) ?? '',
        },
        { header: 'Days overdue', value: r => r.daysOverdue },
        money('Overdue principal', r => r.overduePrincipal),
        money('Overdue interest', r => r.overdueInterest),
        money('Penalties', r => r.overduePenalties),
        money('Unpaid charges', r => r.unpaidCharges),
        money('Amount overdue', r => r.amountOverdue),
        money('Total outstanding', r => r.totalOutstanding),
        {
          header: 'Last payment',
          value: r => r.lastPaymentDate?.slice(0, 10) ?? '',
        },
        { header: 'Next action', value: r => r.nextCollectionAction },
      ],
        reconciliation: report.reconciliation,
      })
    );
  })
);

// ======================================================= 4. Collections
router.get(
  '/collections',
  guard(async (req, res) => {
    const { filters, format, user } = parseRequest(req);
    const report = await buildCollectionsReport(filters as never, user);

    await respond(res, format, report, () =>
      exportOf(report.rows, {
        meta: report.meta,
      sections: [
        {
          title: 'Collections by currency',
          headers: [
            'Currency',
            'Total collected',
            'Principal',
            'Interest',
            'Penalties',
            'Charges',
            'Payments',
            'Clients',
            'Average payment',
            'Reversed amount',
            'Reversed count',
          ],
          rows: report.byCurrency.map(row => [
            row.currency,
            row.totalCollected,
            row.principalCollected,
            row.interestCollected,
            row.penaltiesCollected,
            row.chargesCollected,
            row.paymentCount,
            row.uniqueClients,
            row.averagePayment,
            row.reversedAmount,
            row.reversedCount,
          ]),
        },
        {
          title: `Collections by ${report.breakdown.grouping}`,
          headers: ['Group', 'Currency', 'Payments', 'Total collected'],
          rows: report.breakdown.rows.flatMap(group =>
            group.byCurrency.map(currency => [
              group.label,
              currency.currency,
              currency.count,
              currency.totalCollected,
            ])
          ),
        },
      ],
      columns: [
        { header: 'Receipt', value: r => r.receiptNumber },
        { header: 'Payment date', value: r => r.paymentDate.slice(0, 10) },
        { header: 'Value date', value: r => r.valueDate.slice(0, 10) },
        { header: 'Loan number', value: r => r.loanNumber },
        { header: 'Client', value: r => r.clientName },
        { header: 'Branch', value: r => r.branchName },
        { header: 'Officer', value: r => r.loanOfficerName },
        { header: 'Collector', value: r => r.collectorName },
        { header: 'Method', value: r => r.method },
        { header: 'Reference', value: r => r.reference },
        { header: 'Currency', value: r => r.currency },
        money('Amount', r => r.amount),
        money('Principal', r => r.principalAmount),
        money('Interest', r => r.interestAmount),
        money('Penalty', r => r.penaltyAmount),
        money('Charges', r => r.chargeAmount),
        { header: 'Status', value: r => r.status },
        { header: 'Reversed', value: r => (r.isReversed ? 'YES' : '') },
        { header: 'Reversal reason', value: r => r.reversalReason },
      ],
        reconciliation: report.reconciliation,
      })
    );
  })
);

// ===================================================== 5. Disbursements
router.get(
  '/disbursements',
  guard(async (req, res) => {
    const { filters, format, user } = parseRequest(req);
    const report = await buildDisbursementsReport(filters as never, user);

    await respond(res, format, report, () =>
      exportOf(report.rows, {
        meta: report.meta,
      sections: [
        {
          title: 'Disbursements by currency',
          headers: [
            'Currency',
            'Gross approved',
            'Gross disbursed',
            'Charges deducted',
            'Charges paid separately',
            'Net to clients',
            'Count',
            'Average',
            'Top-up amount',
            'Top-ups',
            'Reversed amount',
            'Reversed count',
          ],
          rows: report.byCurrency.map(row => [
            row.currency,
            row.grossApproved,
            row.grossDisbursed,
            row.chargesDeducted,
            row.chargesPaidSeparately,
            row.netProceeds,
            row.disbursementCount,
            row.averageDisbursement,
            row.topUpAmount,
            row.topUpCount,
            row.reversedAmount,
            row.reversedCount,
          ]),
        },
        {
          title: `Disbursements by ${report.breakdown.grouping}`,
          headers: ['Group', 'Currency', 'Count', 'Gross disbursed', 'Net proceeds'],
          rows: report.breakdown.rows.flatMap(group =>
            group.byCurrency.map(currency => [
              group.label,
              currency.currency,
              currency.count,
              currency.grossDisbursed,
              currency.netProceeds,
            ])
          ),
        },
      ],
      columns: [
        { header: 'Loan number', value: r => r.loanNumber },
        { header: 'Client', value: r => r.clientName },
        { header: 'Client no', value: r => r.clientNumber },
        { header: 'Client type', value: r => r.clientType },
        { header: 'Product', value: r => r.productName },
        { header: 'Branch', value: r => r.branchName },
        { header: 'Approved', value: r => r.approvalDate?.slice(0, 10) ?? '' },
        { header: 'Disbursed', value: r => r.disbursementDate.slice(0, 10) },
        { header: 'Term (months)', value: r => r.termMonths },
        { header: 'Rate %', value: r => r.interestRate },
        { header: 'Currency', value: r => r.currency },
        money('Gross principal', r => r.grossPrincipal),
        {
          header: 'Charges',
          value: r =>
            r.charges
              .map(
                charge =>
                  `${charge.name} ${charge.amount}${charge.deductedFromPrincipal ? ' (deducted)' : ' (client pays)'}`
              )
              .join('; '),
        },
        money('Charges deducted', r => r.chargesDeducted),
        money('Net proceeds', r => r.netProceeds),
        { header: 'Top-up', value: r => (r.isTopUp ? 'YES' : '') },
        { header: 'Method', value: r => r.paymentMethod },
        { header: 'Reference', value: r => r.transactionReference },
        { header: 'Disbursed by', value: r => r.disbursedByName },
        { header: 'Reversed', value: r => (r.isReversed ? 'YES' : '') },
      ],
        reconciliation: report.reconciliation,
      })
    );
  })
);

export default router;
