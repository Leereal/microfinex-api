/**
 * Dashboard Routes
 * API endpoints for dashboard statistics and summaries
 */

import { Router, Request, Response } from 'express';
import {
  combineByCurrency,
  countAcross,
  groupByKeyAndCurrency,
  netByCurrency,
  toMoneyTotals,
} from '../utils/money-by-currency';
import { z } from 'zod';
import { prisma } from '../config/database';
import {
  authenticateToken,
  requirePermission,
} from '../middleware/auth.middleware';
import {
  validateRequest,
  handleAsync,
} from '../middleware/validation.middleware';

const router = Router();

// All dashboard routes require authentication
router.use(authenticateToken);

/**
 * Get portfolio summary
 * GET /api/dashboard/summary
 */
router.get(
  '/summary',
  requirePermission('dashboard:view'),
  handleAsync(async (req: Request, res: Response) => {
    const organizationId = req.user!.organizationId;
    const branchId = req.query.branchId as string | undefined;

    const loanWhere = {
      organizationId,
      ...(branchId && { branchId }),
    };

    // Loan statistics
    const [
      totalLoans,
      activeLoans,
      disbursedLoanCount,
      outstandingLoanCount,
      totalClients,
      activeClients,
      pendingApproval,
      pendingDisbursement,
      onlineApplications,
    ] = await Promise.all([
      prisma.loan.count({ where: loanWhere }),
      prisma.loan.count({ where: { ...loanWhere, status: 'ACTIVE' } }),
      // Counts only - the amounts come from the per-currency groupBy below.
      prisma.loan.count({
        where: {
          ...loanWhere,
          status: { in: ['ACTIVE', 'COMPLETED', 'OVERDUE'] },
        },
      }),
      prisma.loan.count({
        where: { ...loanWhere, status: { in: ['ACTIVE', 'OVERDUE'] } },
      }),
      prisma.client.count({
        where: {
          organizationId,
          isActive: true,
          ...(branchId && { branchId }),
        },
      }),
      prisma.client.count({
        where: {
          organizationId,
          isActive: true,
          ...(branchId && { branchId }),
          loans: { some: { status: 'ACTIVE' } },
        },
      }),
      // Loans pending approval
      prisma.loan.count({ where: { ...loanWhere, status: 'PENDING' } }),
      // Loans approved but not yet disbursed
      prisma.loan.count({ where: { ...loanWhere, status: 'APPROVED' } }),
      // Online applications (loans submitted via web/whatsapp/facebook)
      prisma.loan.count({
        where: {
          ...loanWhere,
          status: 'PENDING',
          applicationSource: { in: ['WEB', 'WHATSAPP', 'FACEBOOK'] },
        },
      }),
    ]);

    // Payments this month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    // Count only - the amount is taken from paymentsByCurrency below, which
    // is the same query grouped by denomination.
    const paymentsThisMonth = await prisma.payment.count({
      where: {
        loan: { organizationId, ...(branchId && { branchId }) },
        status: 'COMPLETED',
        paymentDate: { gte: startOfMonth },
      },
    });

    // Overdue loans
    const overdueLoans = await prisma.loan.count({
      where: { ...loanWhere, status: 'OVERDUE' },
    });

    // Get portfolio data grouped by currency
    const disbursedByCurrency = await prisma.loan.groupBy({
      by: ['currency'],
      where: {
        ...loanWhere,
        status: { in: ['ACTIVE', 'COMPLETED', 'OVERDUE'] },
      },
      _sum: { amount: true },
      _count: true,
    });

    const outstandingByCurrency = await prisma.loan.groupBy({
      by: ['currency'],
      where: { ...loanWhere, status: { in: ['ACTIVE', 'OVERDUE'] } },
      _sum: { outstandingBalance: true },
    });

    // Get payments this month grouped by currency
    const paymentsByCurrency = await prisma.payment.groupBy({
      by: ['currency'],
      where: {
        loan: { organizationId, ...(branchId && { branchId }) },
        status: 'COMPLETED',
        paymentDate: { gte: startOfMonth },
      },
      _sum: { amount: true },
      _count: true,
    });

    // Build currency portfolio summary
    const currencySet = new Set<string>();
    disbursedByCurrency.forEach(d => currencySet.add(d.currency));
    outstandingByCurrency.forEach(o => currencySet.add(o.currency));
    paymentsByCurrency.forEach(p => currencySet.add(p.currency));

    const portfolioByCurrency = Array.from(currencySet)
      .map(currency => {
        const disbursed = disbursedByCurrency.find(
          d => d.currency === currency
        );
        const outstanding = outstandingByCurrency.find(
          o => o.currency === currency
        );
        const payments = paymentsByCurrency.find(p => p.currency === currency);

        return {
          currency,
          totalDisbursed: Number(disbursed?._sum?.amount || 0),
          loanCount: disbursed?._count || 0,
          totalOutstanding: Number(outstanding?._sum?.outstandingBalance || 0),
          paymentsThisMonth: Number(payments?._sum?.amount || 0),
          paymentsCountThisMonth: payments?._count || 0,
        };
      })
      .sort((a, b) => a.currency.localeCompare(b.currency));

    res.json({
      success: true,
      data: {
        portfolio: {
          totalLoans,
          activeLoans,
          overdueLoans,
          pendingApproval,
          pendingDisbursement,
          onlineApplications,
          // Amounts are per currency only. A single figure here would have to
          // add USD to ZiG, which is not a number anyone can act on.
          byCurrency: portfolioByCurrency,
        },
        clients: {
          total: totalClients,
          active: activeClients,
        },
        payments: {
          countThisMonth: paymentsThisMonth,
          byCurrency: toMoneyTotals(paymentsByCurrency, 'amount'),
        },
        lastUpdated: new Date(),
      },
    });
  })
);

/**
 * Get portfolio trends
 * GET /api/dashboard/trends
 */
const trendsSchema = z.object({
  query: z.object({
    period: z.enum(['week', 'month', 'quarter', 'year']).default('month'),
    branchId: z.string().optional(),
  }),
});

router.get(
  '/trends',
  requirePermission('dashboard:view'),
  validateRequest(trendsSchema),
  handleAsync(async (req: Request, res: Response) => {
    const organizationId = req.user!.organizationId;
    const { period, branchId } = req.query;

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();

    switch (period) {
      case 'week':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case 'quarter':
        startDate.setMonth(startDate.getMonth() - 3);
        break;
      case 'year':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
    }

    // Daily disbursements, kept apart by currency. Bucketing on date alone
    // added USD to ZiG, so the trend line plotted a quantity that does not
    // exist - and its shape moved with the currency mix, not the lending.
    const disbursedLoans = await prisma.loan.findMany({
      where: {
        organizationId,
        disbursedDate: { gte: startDate, lte: endDate },
        ...(branchId && { branchId: String(branchId) }),
      },
      select: {
        disbursedDate: true,
        amount: true,
        currency: true,
      },
    });

    // date -> currency -> total
    type DailyTotals = Record<string, Record<string, { amount: number; count: number }>>;

    const addTo = (
      bucket: DailyTotals,
      dateStr: string,
      currency: string,
      amount: number
    ) => {
      const forDate = (bucket[dateStr] ??= {});
      const forCurrency = (forDate[currency] ??= { amount: 0, count: 0 });
      forCurrency.amount += amount;
      forCurrency.count += 1;
    };

    const disbursementsByDate: DailyTotals = {};
    disbursedLoans.forEach(loan => {
      if (!loan.disbursedDate) return;
      const dateStr = loan.disbursedDate.toISOString().split('T')[0] as string;
      addTo(disbursementsByDate, dateStr, loan.currency, Number(loan.amount));
    });

    // Get daily payments
    const completedPayments = await prisma.payment.findMany({
      where: {
        loan: { organizationId, ...(branchId && { branchId: String(branchId) }) },
        status: 'COMPLETED',
        paymentDate: { gte: startDate, lte: endDate },
      },
      select: {
        paymentDate: true,
        amount: true,
        currency: true,
      },
    });

    const paymentsByDate: DailyTotals = {};
    completedPayments.forEach(payment => {
      const dateStr = payment.paymentDate.toISOString().split('T')[0] as string;
      addTo(paymentsByDate, dateStr, payment.currency, Number(payment.amount));
    });

    /** Flatten date -> currency -> total into one row per date and currency. */
    const flatten = (bucket: DailyTotals) =>
      Object.entries(bucket).flatMap(([date, byCurrency]) =>
        Object.entries(byCurrency).map(([currency, total]) => ({
          date,
          currency,
          amount: total.amount,
          count: total.count,
        }))
      );

    /** Every currency that appears, so the UI can offer them as a filter. */
    const currenciesPresent = Array.from(
      new Set([
        ...Object.values(disbursementsByDate).flatMap(v => Object.keys(v)),
        ...Object.values(paymentsByDate).flatMap(v => Object.keys(v)),
      ])
    ).sort();

    // Get new clients trend
    const newClients = await prisma.client.findMany({
      where: {
        organizationId,
        createdAt: { gte: startDate, lte: endDate },
        ...(branchId && { branchId: String(branchId) }),
      },
      select: {
        createdAt: true,
      },
    });

    const clientsByDate: Record<string, number> = {};
    newClients.forEach(client => {
      const dateStr: string = client.createdAt
        .toISOString()
        .split('T')[0] as string;
      clientsByDate[dateStr] = (clientsByDate[dateStr] || 0) + 1;
    });

    res.json({
      success: true,
      data: {
        period,
        startDate,
        endDate,
        // One row per date AND currency. A line mixing denominations follows
        // the currency mix rather than the lending.
        currencies: currenciesPresent,
        disbursements: flatten(disbursementsByDate).sort(
          (a, b) => a.date.localeCompare(b.date) || a.currency.localeCompare(b.currency)
        ),
        payments: flatten(paymentsByDate).sort(
          (a, b) => a.date.localeCompare(b.date) || a.currency.localeCompare(b.currency)
        ),
        newClients: Object.entries(clientsByDate)
          .map(([date, count]) => ({
            date,
            count,
          }))
          .sort((a, b) => a.date.localeCompare(b.date)),
      },
    });
  })
);

/**
 * Get cash flow summary
 * GET /api/dashboard/cash-flow
 */
const cashFlowSchema = z.object({
  query: z.object({
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    branchId: z.string().optional(),
  }),
});

router.get(
  '/cash-flow',
  requirePermission('dashboard:view'),
  validateRequest(cashFlowSchema),
  handleAsync(async (req: Request, res: Response) => {
    const organizationId = req.user!.organizationId;
    const { branchId } = req.query;

    const startDate = req.query.startDate
      ? new Date(req.query.startDate as string)
      : new Date(new Date().setMonth(new Date().getMonth() - 1));
    const endDate = req.query.endDate
      ? new Date(req.query.endDate as string)
      : new Date();

    // Cash out, per currency.
    const disbursements = await prisma.loan.groupBy({
      by: ['currency'],
      where: {
        organizationId,
        disbursedDate: { gte: startDate, lte: endDate },
        ...(branchId && { branchId: String(branchId) }),
      },
      _sum: { amount: true },
      _count: true,
    });

    // Cash in, per currency.
    const paymentsReceived = await prisma.payment.groupBy({
      by: ['currency'],
      where: {
        loan: {
          organizationId,
          ...(branchId && { branchId: String(branchId) }),
        },
        status: 'COMPLETED',
        paymentDate: { gte: startDate, lte: endDate },
      },
      _sum: { amount: true },
      _count: true,
    });

    // Payment method totals are grouped by currency too - a method can take
    // both, and formatting the combined figure as USD misstates both.
    const paymentsByMethod = await prisma.payment.groupBy({
      by: ['method', 'currency'],
      where: {
        loan: {
          organizationId,
          ...(branchId && { branchId: String(branchId) }),
        },
        status: 'COMPLETED',
        paymentDate: { gte: startDate, lte: endDate },
      },
      _sum: { amount: true },
      _count: true,
    });

    const cashIn = toMoneyTotals(paymentsReceived, 'amount');
    const cashOut = toMoneyTotals(disbursements, 'amount');
    const byMethod = groupByKeyAndCurrency<string>(
      paymentsByMethod as any,
      'method',
      'amount'
    );

    res.json({
      success: true,
      data: {
        period: { startDate, endDate },
        summary: {
          byCurrency: combineByCurrency({ cashIn, cashOut }),
          netCashFlow: netByCurrency(cashIn, cashOut),
        },
        disbursements: {
          byCurrency: cashOut,
          count: countAcross(cashOut),
        },
        collections: {
          byCurrency: cashIn,
          count: countAcross(cashIn),
        },
        byPaymentMethod: Array.from(byMethod.entries()).map(
          ([method, totals]) => ({
            method,
            byCurrency: totals,
            count: countAcross(totals),
          })
        ),
      },
    });
  })
);

/**
 * Get alerts and notifications summary
 * GET /api/dashboard/alerts
 */
router.get(
  '/alerts',
  requirePermission('dashboard:view'),
  handleAsync(async (req: Request, res: Response) => {
    const organizationId = req.user!.organizationId;
    const branchId = req.query.branchId as string | undefined;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const threeDaysFromNow = new Date(today);
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

    // Loans with payments due in next 3 days
    const upcomingPayments = await prisma.repaymentSchedule.count({
      where: {
        status: 'PENDING',
        dueDate: {
          gte: today,
          lte: threeDaysFromNow,
        },
        loan: {
          organizationId,
          status: 'ACTIVE',
          ...(branchId && { branchId }),
        },
      },
    });

    // Overdue payments (past due date)
    const overduePayments = await prisma.repaymentSchedule.count({
      where: {
        status: 'PENDING',
        dueDate: { lt: today },
        loan: {
          organizationId,
          status: { in: ['ACTIVE', 'OVERDUE'] },
          ...(branchId && { branchId }),
        },
      },
    });

    // Severely overdue (30+ days)
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const severelyOverdue = await prisma.repaymentSchedule.count({
      where: {
        status: 'PENDING',
        dueDate: { lt: thirtyDaysAgo },
        loan: {
          organizationId,
          status: { in: ['ACTIVE', 'OVERDUE'] },
          ...(branchId && { branchId }),
        },
      },
    });

    // Pending loan applications
    const pendingApplications = await prisma.loan.count({
      where: {
        organizationId,
        status: 'PENDING',
        ...(branchId && { branchId }),
      },
    });

    // Loans pending disbursement (approved but not disbursed)
    const pendingDisbursement = await prisma.loan.count({
      where: {
        organizationId,
        status: 'APPROVED',
        disbursedDate: null,
        ...(branchId && { branchId }),
      },
    });

    res.json({
      success: true,
      data: {
        alerts: [
          {
            type: 'UPCOMING_PAYMENTS',
            severity: 'info',
            count: upcomingPayments,
            message: `${upcomingPayments} payments due in next 3 days`,
          },
          {
            type: 'OVERDUE_PAYMENTS',
            severity: overduePayments > 0 ? 'warning' : 'info',
            count: overduePayments,
            message: `${overduePayments} overdue payments`,
          },
          {
            type: 'SEVERELY_OVERDUE',
            severity: severelyOverdue > 0 ? 'error' : 'info',
            count: severelyOverdue,
            message: `${severelyOverdue} payments 30+ days overdue`,
          },
          {
            type: 'PENDING_APPLICATIONS',
            severity: 'info',
            count: pendingApplications,
            message: `${pendingApplications} pending loan applications`,
          },
          {
            type: 'PENDING_DISBURSEMENT',
            severity: pendingDisbursement > 0 ? 'warning' : 'info',
            count: pendingDisbursement,
            message: `${pendingDisbursement} approved loans pending disbursement`,
          },
        ],
        summary: {
          totalAlerts: overduePayments + severelyOverdue + pendingDisbursement,
          critical: severelyOverdue,
          warnings: overduePayments,
          info: upcomingPayments + pendingApplications,
        },
      },
    });
  })
);

/**
 * Get loan officer performance
 * GET /api/dashboard/officer-performance
 */
const officerPerformanceSchema = z.object({
  query: z.object({
    period: z.enum(['week', 'month', 'quarter', 'year']).default('month'),
    branchId: z.string().optional(),
  }),
});

router.get(
  '/officer-performance',
  requirePermission('dashboard:view'),
  validateRequest(officerPerformanceSchema),
  handleAsync(async (req: Request, res: Response) => {
    const organizationId = req.user!.organizationId;
    const { period, branchId } = req.query;

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();

    switch (period) {
      case 'week':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case 'quarter':
        startDate.setMonth(startDate.getMonth() - 3);
        break;
      case 'year':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
    }

    // Get loan officers
    const officers = await prisma.user.findMany({
      where: {
        organizationId,
        isActive: true,
        ...(branchId && { branchId: String(branchId) }),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
      },
    });

    // Three grouped queries rather than three per officer - and grouped by
    // currency, because an officer can write USD and ZiG business and summing
    // the two says nothing about their book.
    const officerIds = officers.map(officer => officer.id);

    const [disbursedRows, collectedRows, portfolioRows] = await Promise.all([
      prisma.loan.groupBy({
        by: ['loanOfficerId', 'currency'],
        where: {
          loanOfficerId: { in: officerIds },
          createdAt: { gte: startDate, lte: endDate },
        },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.payment.groupBy({
        by: ['receivedBy', 'currency'],
        where: {
          receivedBy: { in: officerIds },
          status: 'COMPLETED',
          paymentDate: { gte: startDate, lte: endDate },
        },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.loan.groupBy({
        by: ['loanOfficerId', 'currency'],
        where: {
          loanOfficerId: { in: officerIds },
          status: { in: ['ACTIVE', 'OVERDUE'] },
        },
        _sum: { outstandingBalance: true },
        _count: true,
      }),
    ]);

    const disbursedByOfficer = groupByKeyAndCurrency<string>(
      disbursedRows as any,
      'loanOfficerId',
      'amount'
    );
    const collectedByOfficer = groupByKeyAndCurrency<string>(
      collectedRows as any,
      'receivedBy',
      'amount'
    );
    const portfolioByOfficer = groupByKeyAndCurrency<string>(
      portfolioRows as any,
      'loanOfficerId',
      'outstandingBalance'
    );

    const officerStats = officers.map(officer => {
      const disbursed = disbursedByOfficer.get(officer.id) ?? [];
      const collected = collectedByOfficer.get(officer.id) ?? [];
      const portfolio = portfolioByOfficer.get(officer.id) ?? [];

      return {
        officerId: officer.id,
        officerName: `${officer.firstName} ${officer.lastName}`,
        loansCreated: countAcross(disbursed),
        collectionsCount: countAcross(collected),
        activeLoans: countAcross(portfolio),
        byCurrency: combineByCurrency({
          disbursed,
          collected,
          portfolio,
        }),
      };
    });

    // Ranked by how many loans were written, which is currency-independent.
    officerStats.sort((a, b) => b.loansCreated - a.loansCreated);

    res.json({
      success: true,
      data: {
        period,
        startDate,
        endDate,
        officers: officerStats,
      },
    });
  })
);

/**
 * Get branch performance comparison
 * GET /api/dashboard/branch-comparison
 */
router.get(
  '/branch-comparison',
  requirePermission('dashboard:view'),
  handleAsync(async (req: Request, res: Response) => {
    const organizationId = req.user!.organizationId;

    const branches = await prisma.branch.findMany({
      where: {
        organizationId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        code: true,
      },
    });

    const branchStats = await Promise.all(
      branches.map(async branch => {
        const [
          activeLoans,
          totalDisbursed,
          totalOutstanding,
          overdueLoans,
          clientCount,
        ] = await Promise.all([
          prisma.loan.count({
            where: {
              branchId: branch.id,
              status: 'ACTIVE',
            },
          }),
          prisma.loan.groupBy({
            by: ['currency'],
            where: {
              branchId: branch.id,
            },
            _sum: { amount: true },
            _count: true,
          }),
          prisma.loan.groupBy({
            by: ['currency'],
            where: {
              branchId: branch.id,
              status: { in: ['ACTIVE', 'OVERDUE'] },
            },
            _sum: { outstandingBalance: true },
            _count: true,
          }),
          prisma.loan.count({
            where: {
              branchId: branch.id,
              status: 'OVERDUE',
            },
          }),
          prisma.client.count({
            where: {
              branchId: branch.id,
              isActive: true,
            },
          }),
        ]);

        const totalActive = activeLoans + overdueLoans;
        const parRatio =
          totalActive > 0 ? (overdueLoans / totalActive) * 100 : 0;

        return {
          branchId: branch.id,
          branchName: branch.name,
          branchCode: branch.code,
          activeLoans,
          overdueLoans,
          // Per currency: a branch lending in both USD and ZiG has two
          // portfolios, not one sum of unlike things.
          byCurrency: combineByCurrency({
            disbursed: toMoneyTotals(totalDisbursed, 'amount'),
            outstanding: toMoneyTotals(totalOutstanding, 'outstandingBalance'),
          }),
          clientCount,
          parRatio: Math.round(parRatio * 100) / 100,
        };
      })
    );

    // Ranked by portfolio at risk, which is a ratio and so currency-neutral.
    branchStats.sort((a, b) => b.parRatio - a.parRatio);

    res.json({
      success: true,
      data: branchStats,
    });
  })
);

export default router;
