/**
 * Dashboard Routes
 * API endpoints for dashboard statistics and summaries
 */

import { Router, Request, Response } from 'express';
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
      totalDisbursed,
      totalOutstanding,
      totalClients,
      activeClients,
      pendingApproval,
      pendingDisbursement,
      onlineApplications,
    ] = await Promise.all([
      prisma.loan.count({ where: loanWhere }),
      prisma.loan.count({ where: { ...loanWhere, status: 'ACTIVE' } }),
      prisma.loan.aggregate({
        where: {
          ...loanWhere,
          status: { in: ['ACTIVE', 'COMPLETED', 'OVERDUE'] },
        },
        _sum: { amount: true },
      }),
      prisma.loan.aggregate({
        where: { ...loanWhere, status: { in: ['ACTIVE', 'OVERDUE'] } },
        _sum: { outstandingBalance: true },
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

    const paymentsThisMonth = await prisma.payment.aggregate({
      where: {
        loan: { organizationId, ...(branchId && { branchId }) },
        status: 'COMPLETED',
        paymentDate: { gte: startOfMonth },
      },
      _sum: { amount: true },
      _count: true,
    });

    // Overdue loans
    const overdueLoans = await prisma.loan.count({
      where: { ...loanWhere, status: 'OVERDUE' },
    });

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
          totalDisbursed: Number(totalDisbursed._sum?.amount || 0),
          totalOutstanding: Number(
            totalOutstanding._sum?.outstandingBalance || 0
          ),
        },
        clients: {
          total: totalClients,
          active: activeClients,
        },
        payments: {
          countThisMonth: paymentsThisMonth._count || 0,
          amountThisMonth: Number(paymentsThisMonth._sum?.amount || 0),
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

    // Get daily disbursements using Prisma groupBy
    const disbursedLoans = await prisma.loan.findMany({
      where: {
        organizationId,
        disbursedDate: { gte: startDate, lte: endDate },
        ...(branchId && { branchId: String(branchId) }),
      },
      select: {
        disbursedDate: true,
        amount: true,
      },
    });

    // Group by date
    const disbursementsByDate: Record<
      string,
      { amount: number; count: number }
    > = {};
    disbursedLoans.forEach(loan => {
      if (loan.disbursedDate) {
        const dateStr: string = loan.disbursedDate
          .toISOString()
          .split('T')[0] as string;
        if (!disbursementsByDate[dateStr]) {
          disbursementsByDate[dateStr] = { amount: 0, count: 0 };
        }
        disbursementsByDate[dateStr].amount += Number(loan.amount);
        disbursementsByDate[dateStr].count += 1;
      }
    });

    // Get daily payments
    const completedPayments = await prisma.payment.findMany({
      where: {
        loan: { organizationId },
        status: 'COMPLETED',
        paymentDate: { gte: startDate, lte: endDate },
      },
      select: {
        paymentDate: true,
        amount: true,
      },
    });

    const paymentsByDate: Record<string, { amount: number; count: number }> =
      {};
    completedPayments.forEach(payment => {
      const dateStr: string = payment.paymentDate
        .toISOString()
        .split('T')[0] as string;
      if (!paymentsByDate[dateStr]) {
        paymentsByDate[dateStr] = { amount: 0, count: 0 };
      }
      paymentsByDate[dateStr].amount += Number(payment.amount);
      paymentsByDate[dateStr].count += 1;
    });

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
        disbursements: Object.entries(disbursementsByDate)
          .map(([date, data]) => ({
            date,
            amount: data.amount,
            count: data.count,
          }))
          .sort((a, b) => a.date.localeCompare(b.date)),
        payments: Object.entries(paymentsByDate)
          .map(([date, data]) => ({
            date,
            amount: data.amount,
            count: data.count,
          }))
          .sort((a, b) => a.date.localeCompare(b.date)),
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

    // Total disbursements (cash out)
    const disbursements = await prisma.loan.aggregate({
      where: {
        organizationId,
        disbursedDate: { gte: startDate, lte: endDate },
        ...(branchId && { branchId: String(branchId) }),
      },
      _sum: { amount: true },
      _count: true,
    });

    // Total payments received (cash in)
    const paymentsReceived = await prisma.payment.aggregate({
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

    // Breakdown by payment method
    const paymentsByMethod = await prisma.payment.groupBy({
      by: ['method'],
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

    const cashIn = Number(paymentsReceived._sum?.amount || 0);
    const cashOut = Number(disbursements._sum?.amount || 0);

    res.json({
      success: true,
      data: {
        period: { startDate, endDate },
        summary: {
          cashIn,
          cashOut,
          netCashFlow: cashIn - cashOut,
        },
        disbursements: {
          amount: cashOut,
          count: disbursements._count || 0,
        },
        collections: {
          amount: cashIn,
          count: paymentsReceived._count || 0,
        },
        byPaymentMethod: paymentsByMethod.map(pm => ({
          method: pm.method,
          amount: Number(pm._sum?.amount || 0),
          count: pm._count,
        })),
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

    // Get detailed stats for each officer
    const officerStats = await Promise.all(
      officers.map(async officer => {
        const loansCreated = await prisma.loan.aggregate({
          where: {
            loanOfficerId: officer.id,
            createdAt: { gte: startDate, lte: endDate },
          },
          _sum: { amount: true },
          _count: true,
        });

        const collectionsReceived = await prisma.payment.aggregate({
          where: {
            receivedBy: officer.id,
            status: 'COMPLETED',
            paymentDate: { gte: startDate, lte: endDate },
          },
          _sum: { amount: true },
          _count: true,
        });

        // Active portfolio
        const activePortfolio = await prisma.loan.aggregate({
          where: {
            loanOfficerId: officer.id,
            status: { in: ['ACTIVE', 'OVERDUE'] },
          },
          _sum: { outstandingBalance: true },
          _count: true,
        });

        return {
          officerId: officer.id,
          officerName: `${officer.firstName} ${officer.lastName}`,
          loansCreated: loansCreated._count || 0,
          disbursedAmount: Number(loansCreated._sum?.amount || 0),
          collectionsCount: collectionsReceived._count || 0,
          collectionsAmount: Number(collectionsReceived._sum?.amount || 0),
          activeLoans: activePortfolio._count || 0,
          portfolioBalance: Number(
            activePortfolio._sum?.outstandingBalance || 0
          ),
        };
      })
    );

    // Sort by disbursed amount
    officerStats.sort((a, b) => b.disbursedAmount - a.disbursedAmount);

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
          prisma.loan.aggregate({
            where: {
              branchId: branch.id,
            },
            _sum: { amount: true },
          }),
          prisma.loan.aggregate({
            where: {
              branchId: branch.id,
              status: { in: ['ACTIVE', 'OVERDUE'] },
            },
            _sum: { outstandingBalance: true },
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
          totalDisbursed: Number(totalDisbursed._sum?.amount || 0),
          totalOutstanding: Number(
            totalOutstanding._sum?.outstandingBalance || 0
          ),
          clientCount,
          parRatio: Math.round(parRatio * 100) / 100,
        };
      })
    );

    // Sort by outstanding balance
    branchStats.sort((a, b) => b.totalOutstanding - a.totalOutstanding);

    res.json({
      success: true,
      data: branchStats,
    });
  })
);

export default router;
