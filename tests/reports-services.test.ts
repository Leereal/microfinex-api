import { Prisma } from '@prisma/client';

/**
 * The report services, with the database mocked.
 *
 * These cover the behaviours that are about *which records a report counts*
 * rather than arithmetic: that every query is scoped to the organization and
 * the branch, that reversed payments are reported as reversed rather than
 * collected, that money paid out is never counted as money received, and that
 * a report with no records says so instead of inventing a zero row.
 *
 * The arithmetic itself is covered by reports-arrears.calc.test.ts.
 */

const loanFindMany = jest.fn();
const paymentFindMany = jest.fn();
const loanGroupBy = jest.fn();

jest.mock('../src/config/database', () => ({
  prisma: {
    loan: {
      findMany: (...args: unknown[]) => loanFindMany(...args),
      groupBy: (...args: unknown[]) => loanGroupBy(...args),
    },
    payment: {
      findMany: (...args: unknown[]) => paymentFindMany(...args),
    },
  },
}));

// Imported after the mock so the services pick it up.
import { buildPortfolioSummary } from '../src/services/reports/portfolio-summary.report';
import { buildParReport } from '../src/services/reports/par.report';
import { buildCollectionsReport } from '../src/services/reports/collections.report';
import { buildArrearsAging } from '../src/services/reports/arrears-aging.report';

const d = (value: number | string) => new Prisma.Decimal(value);

const ORG = 'org-1';
const USER = { id: 'u1', firstName: 'Report', lastName: 'Runner' };

const loan = (overrides: Record<string, unknown> = {}) => ({
  id: 'loan-1',
  loanNumber: 'LN0001',
  currency: 'USD',
  status: 'ACTIVE',
  clientId: 'client-1',
  amount: d(1000),
  totalInterest: d(200),
  principalBalance: d(600),
  interestBalance: d(120),
  penaltyBalance: d(0),
  outstandingBalance: d(720),
  disbursedDate: new Date('2026-01-15'),
  maturityDate: new Date('2026-07-15'),
  lastPaymentDate: null,
  productId: 'prod-1',
  branchId: 'branch-1',
  loanOfficerId: 'officer-1',
  term: 6,
  interestRate: d(20),
  approvedDate: new Date('2026-01-10'),
  product: { name: 'Personal' },
  branch: { name: 'Main' },
  loanOfficer: { firstName: 'Ada', lastName: 'Officer' },
  disbursedBy: { firstName: 'Ada', lastName: 'Officer' },
  client: {
    clientNumber: 'CL001',
    firstName: 'Sam',
    lastName: 'Client',
    businessName: null,
    type: 'INDIVIDUAL',
    phone: '0700000000',
    email: 'sam@example.com',
  },
  repaymentSchedule: [],
  loanCharges: [],
  ...overrides,
});

beforeEach(() => {
  loanFindMany.mockReset().mockResolvedValue([]);
  paymentFindMany.mockReset().mockResolvedValue([]);
  loanGroupBy.mockReset().mockResolvedValue([]);
});

describe('branch and organization isolation', () => {
  it('scopes the portfolio to the organization even with no branch filter', async () => {
    await buildPortfolioSummary({ organizationId: ORG }, USER);
    const where = loanFindMany.mock.calls[0][0].where;
    expect(where.organizationId).toBe(ORG);
    expect(where.branchId).toBeUndefined();
  });

  it('adds the branch to the query when one is supplied', async () => {
    await buildPortfolioSummary(
      { organizationId: ORG, branchId: 'branch-9' },
      USER
    );
    const where = loanFindMany.mock.calls[0][0].where;
    expect(where.organizationId).toBe(ORG);
    expect(where.branchId).toBe('branch-9');
  });

  it('scopes PAR to the organization and branch', async () => {
    await buildParReport({ organizationId: ORG, branchId: 'branch-9' }, USER);
    const where = loanFindMany.mock.calls[0][0].where;
    expect(where.organizationId).toBe(ORG);
    expect(where.branchId).toBe('branch-9');
  });

  it('scopes collections through the loan relation', async () => {
    await buildCollectionsReport(
      { organizationId: ORG, branchId: 'branch-9' },
      USER
    );
    const where = paymentFindMany.mock.calls[0][0].where;
    expect(where.loan.organizationId).toBe(ORG);
    expect(where.loan.branchId).toBe('branch-9');
  });

  it('scopes arrears aging to the organization and branch', async () => {
    await buildArrearsAging(
      { organizationId: ORG, branchId: 'branch-9' },
      USER
    );
    const where = loanFindMany.mock.calls[0][0].where;
    expect(where.organizationId).toBe(ORG);
    expect(where.branchId).toBe('branch-9');
  });
});

describe('zero records', () => {
  it('returns no currency rows rather than a fabricated zero', async () => {
    const report = await buildPortfolioSummary({ organizationId: ORG }, USER);
    expect(report.byCurrency).toEqual([]);
    expect(report.rows).toEqual([]);
    expect(report.totalRows).toBe(0);
    expect(report.meta.isEmpty).toBe(true);
  });

  it('says a collections report is empty without inventing a currency', async () => {
    const report = await buildCollectionsReport({ organizationId: ORG }, USER);
    expect(report.byCurrency).toEqual([]);
    expect(report.meta.isEmpty).toBe(true);
    expect(report.reconciliation).toEqual([]);
  });
});

describe('multiple currencies are never combined', () => {
  it('reports USD and ZWG as separate rows', async () => {
    loanFindMany.mockResolvedValue([
      loan({ id: 'a', currency: 'USD', principalBalance: d(570720), interestBalance: d(0), penaltyBalance: d(0) }),
      loan({ id: 'b', loanNumber: 'LN0002', currency: 'ZWG', principalBalance: d(4350), interestBalance: d(0), penaltyBalance: d(0) }),
    ]);

    const report = await buildPortfolioSummary({ organizationId: ORG }, USER);

    expect(report.byCurrency.map(c => c.currency)).toEqual(['USD', 'ZWG']);
    expect(report.byCurrency[0]!.totalOutstanding).toBe(570720);
    expect(report.byCurrency[1]!.totalOutstanding).toBe(4350);
    // The figure the old reports produced.
    expect(report.byCurrency.map(c => c.totalOutstanding)).not.toContain(575070);
  });

  it('reconciles each currency independently', async () => {
    loanFindMany.mockResolvedValue([
      loan({ id: 'a', currency: 'USD' }),
      loan({ id: 'b', loanNumber: 'LN0002', currency: 'ZWG' }),
    ]);

    const report = await buildPortfolioSummary({ organizationId: ORG }, USER);
    expect(report.reconciliation.every(check => check.ok)).toBe(true);
    expect(report.reconciliation.map(c => c.currency)).toEqual(
      expect.arrayContaining(['USD', 'ZWG'])
    );
  });
});

describe('collections', () => {
  const payment = (overrides: Record<string, unknown> = {}) => ({
    id: 'pay-1',
    paymentNumber: 'PAY0001',
    paymentDate: new Date('2026-03-01'),
    amount: d(120),
    principalAmount: d(100),
    interestAmount: d(20),
    penaltyAmount: d(0),
    method: 'CASH',
    status: 'COMPLETED',
    transactionRef: null,
    reversedAt: null,
    reversalReason: null,
    loanId: 'loan-1',
    receiver: { firstName: 'Tess', lastName: 'Teller' },
    loan: {
      loanNumber: 'LN0001',
      currency: 'USD',
      clientId: 'client-1',
      branchId: 'branch-1',
      productId: 'prod-1',
      loanOfficerId: 'officer-1',
      branch: { name: 'Main' },
      product: { name: 'Personal' },
      loanOfficer: { firstName: 'Ada', lastName: 'Officer' },
      client: {
        clientNumber: 'CL001',
        firstName: 'Sam',
        lastName: 'Client',
        businessName: null,
      },
    },
    ...overrides,
  });

  it('never asks the database for money paid out', async () => {
    await buildCollectionsReport({ organizationId: ORG }, USER);
    const where = paymentFindMany.mock.calls[0][0].where;
    expect(where.type.notIn).toEqual(
      expect.arrayContaining(['LOAN_DISBURSEMENT', 'LOAN_TOPUP'])
    );
  });

  it('only asks for completed and reversed payments', async () => {
    await buildCollectionsReport({ organizationId: ORG }, USER);
    const where = paymentFindMany.mock.calls[0][0].where;
    expect(where.status.in).toEqual(['COMPLETED', 'REVERSED']);
  });

  it('reports a reversed payment as reversed, not as cash collected', async () => {
    paymentFindMany.mockResolvedValue([
      payment({ id: 'p1' }),
      payment({
        id: 'p2',
        paymentNumber: 'PAY0002',
        status: 'REVERSED',
        amount: d(500),
        principalAmount: d(500),
        interestAmount: d(0),
        reversedAt: new Date('2026-03-05'),
        reversalReason: 'Captured twice',
      }),
    ]);

    const report = await buildCollectionsReport({ organizationId: ORG }, USER);
    const usd = report.byCurrency[0]!;

    expect(usd.totalCollected).toBe(120);
    expect(usd.paymentCount).toBe(1);
    expect(usd.reversedAmount).toBe(500);
    expect(usd.reversedCount).toBe(1);
    // Never netted into the collected figure.
    expect(usd.totalCollected).not.toBe(620);
    expect(usd.totalCollected).not.toBe(-380);
  });

  it('keeps a reversed payment visible in the detail, flagged', async () => {
    paymentFindMany.mockResolvedValue([
      payment({ id: 'p2', status: 'REVERSED', reversalReason: 'Wrong loan' }),
    ]);

    const report = await buildCollectionsReport({ organizationId: ORG }, USER);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]!.isReversed).toBe(true);
    expect(report.rows[0]!.reversalReason).toBe('Wrong loan');
  });

  it('derives the charge allocation so the components always add up', async () => {
    // 150 paid, of which 100 principal and 20 interest: 30 must be charges.
    paymentFindMany.mockResolvedValue([
      payment({ amount: d(150), principalAmount: d(100), interestAmount: d(20) }),
    ]);

    const report = await buildCollectionsReport({ organizationId: ORG }, USER);
    const row = report.rows[0]!;

    expect(row.chargeAmount).toBe(30);
    expect(
      row.principalAmount + row.interestAmount + row.penaltyAmount + row.chargeAmount
    ).toBe(row.amount);
    expect(report.reconciliation.every(check => check.ok)).toBe(true);
  });

  it('keeps two currencies apart in the collected totals', async () => {
    paymentFindMany.mockResolvedValue([
      payment({ id: 'p1', amount: d(100), principalAmount: d(100), interestAmount: d(0) }),
      payment({
        id: 'p2',
        amount: d(250),
        principalAmount: d(250),
        interestAmount: d(0),
        loan: { ...payment().loan, currency: 'ZWG' },
      }),
    ]);

    const report = await buildCollectionsReport({ organizationId: ORG }, USER);
    expect(report.byCurrency.map(c => [c.currency, c.totalCollected])).toEqual([
      ['USD', 100],
      ['ZWG', 250],
    ]);
  });
});

describe('arrears aging with partial payments', () => {
  it('charges only the unpaid remainder of a part-paid instalment', async () => {
    loanFindMany.mockResolvedValue([
      loan({
        principalBalance: d(600),
        interestBalance: d(120),
        penaltyBalance: d(0),
        repaymentSchedule: [
          {
            dueDate: new Date('2026-02-01'),
            principalAmount: d(100),
            interestAmount: d(20),
            totalAmount: d(120),
            paidAmount: d(108), // 90% paid
            status: 'PENDING',
          },
        ],
      }),
    ]);

    const report = await buildArrearsAging(
      { organizationId: ORG, asOfDate: new Date('2026-03-01') },
      USER
    );

    // 12 outstanding, not the full 120 the old report charged.
    expect(report.byCurrency[0]!.totalArrears).toBe(12);
    expect(report.reconciliation.every(check => check.ok)).toBe(true);
  });

  it('includes penalties and unpaid charges in the arrears total', async () => {
    loanFindMany.mockResolvedValue([
      loan({
        penaltyBalance: d(50),
        loanCharges: [{ calculatedAmount: d(30), paidAmount: d(10) }],
        repaymentSchedule: [
          {
            dueDate: new Date('2026-02-01'),
            principalAmount: d(100),
            interestAmount: d(20),
            totalAmount: d(120),
            paidAmount: d(0),
            status: 'PENDING',
          },
        ],
      }),
    ]);

    const report = await buildArrearsAging(
      { organizationId: ORG, asOfDate: new Date('2026-03-01') },
      USER
    );

    const usd = report.byCurrency[0]!;
    // 120 instalment + 50 penalty + 20 unpaid charge
    expect(usd.totalArrears).toBe(190);
    expect(report.reconciliation.every(check => check.ok)).toBe(true);
  });
});

describe('PAR', () => {
  it('reports a loan in every cumulative threshold it qualifies for', async () => {
    loanFindMany.mockResolvedValue([
      loan({
        repaymentSchedule: [
          {
            dueDate: new Date('2025-09-01'), // long overdue
            principalAmount: d(100),
            interestAmount: d(20),
            totalAmount: d(120),
            paidAmount: d(0),
            status: 'PENDING',
          },
        ],
      }),
    ]);

    const report = await buildParReport(
      { organizationId: ORG, asOfDate: new Date('2026-03-31') },
      USER
    );

    const usd = report.byCurrency[0]!;
    // Every threshold counts the same loan - they are cumulative.
    expect(usd.thresholds.map(t => t.loanCount)).toEqual([1, 1, 1, 1, 1, 1]);
    // But it lands in exactly one exclusive bucket.
    expect(usd.buckets.filter(b => b.loanCount > 0)).toHaveLength(1);
    expect(report.reconciliation.every(check => check.ok)).toBe(true);
  });

  it('puts the whole outstanding balance at risk, not just the overdue part', async () => {
    loanFindMany.mockResolvedValue([
      loan({
        principalBalance: d(600),
        interestBalance: d(120),
        penaltyBalance: d(0),
        repaymentSchedule: [
          {
            dueDate: new Date('2026-02-01'),
            principalAmount: d(100),
            interestAmount: d(20),
            totalAmount: d(120),
            paidAmount: d(0),
            status: 'PENDING',
          },
        ],
      }),
    ]);

    const report = await buildParReport(
      { organizationId: ORG, asOfDate: new Date('2026-03-01') },
      USER
    );

    const row = report.rows[0]!;
    expect(row.overdueAmount).toBe(120);
    expect(row.totalOutstanding).toBe(720);
    expect(report.byCurrency[0]!.totalExposure).toBe(720);
  });

  it('excludes a loan with nothing overdue from the arrears figures', async () => {
    loanFindMany.mockResolvedValue([loan({ repaymentSchedule: [] })]);

    const report = await buildParReport({ organizationId: ORG }, USER);
    const usd = report.byCurrency[0]!;

    expect(usd.loansInArrears).toBe(0);
    expect(usd.totalOverdue).toBe(0);
    // But it still counts towards the portfolio it is measured against.
    expect(usd.portfolioOutstanding).toBe(720);
  });
});

describe('report provenance', () => {
  it('records the filters, the as-of date and who ran it', async () => {
    const report = await buildPortfolioSummary(
      {
        organizationId: ORG,
        branchId: 'branch-9',
        currency: 'USD',
        asOfDate: new Date('2026-03-31'),
      },
      USER
    );

    expect(report.meta.reportName).toBe('Loan Portfolio Summary');
    expect(report.meta.asOfDate.slice(0, 10)).toBe('2026-03-31');
    expect(report.meta.generatedBy).toEqual({ id: 'u1', name: 'Report Runner' });
    expect(report.meta.filters).toMatchObject({ currency: 'USD' });
    expect(report.meta.timezone).toBeTruthy();
  });

  it('says the scope is everything when no filter was applied', async () => {
    const report = await buildPortfolioSummary({ organizationId: ORG }, USER);
    expect(report.meta.filters).toEqual({ scope: 'All records' });
  });
});
