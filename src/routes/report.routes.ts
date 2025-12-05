/**
 * Report Routes
 * API endpoints for generating various financial reports
 */

import { Router } from 'express';
import { z } from 'zod';
const XLSX = require('xlsx');
import { prisma } from '../config/database';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware';
import { validateRequest, handleAsync } from '../middleware/validation.middleware';

const router = Router();

// All report routes require authentication
router.use(authenticateToken);

/**
 * Portfolio at Risk (PAR) Report
 * GET /api/reports/par
 */
const parSchema = z.object({
  query: z.object({
    asOfDate: z.string().optional(),
    branchId: z.string().optional(),
    parDays: z.string().optional().transform((v) => v ? parseInt(v) : 30),
  }),
});

router.get(
  '/par',
  requirePermission('reports:view'),
  validateRequest(parSchema),
  handleAsync(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const asOfDate = req.query.asOfDate ? new Date(req.query.asOfDate as string) : new Date();
    const branchId = req.query.branchId as string | undefined;
    const parDays = (req.query.parDays as unknown as number) || 30;

    // Get all active/overdue loans
    const loans = await prisma.loan.findMany({
      where: {
        organizationId,
        status: { in: ['ACTIVE', 'OVERDUE'] },
        ...(branchId && { branchId }),
      },
      include: {
        client: {
          select: { firstName: true, lastName: true, clientNumber: true },
        },
        repaymentSchedule: {
          where: {
            status: 'PENDING',
            dueDate: { lt: asOfDate },
          },
          orderBy: { dueDate: 'asc' },
        },
        branch: {
          select: { name: true, code: true },
        },
        loanOfficer: {
          select: { firstName: true, lastName: true },
        },
      },
    });

    // Calculate PAR for each loan
    const parLoans = loans.map((loan) => {
      const overdueSchedules = loan.repaymentSchedule;
      let daysOverdue = 0;
      let overdueAmount = 0;

      if (overdueSchedules.length > 0) {
        const oldestDue = overdueSchedules[0]!.dueDate;
        daysOverdue = Math.floor((asOfDate.getTime() - oldestDue.getTime()) / (1000 * 60 * 60 * 24));
        overdueAmount = overdueSchedules.reduce(
          (sum, s) => sum + Number(s.totalAmount) - Number(s.paidAmount),
          0
        );
      }

      return {
        loanNumber: loan.loanNumber,
        clientName: `${loan.client.firstName} ${loan.client.lastName}`,
        clientNumber: loan.client.clientNumber,
        branchName: loan.branch?.name || 'N/A',
        loanOfficer: loan.loanOfficer ? `${loan.loanOfficer.firstName} ${loan.loanOfficer.lastName}` : 'N/A',
        disbursedAmount: Number(loan.amount),
        outstandingBalance: Number(loan.outstandingBalance),
        overdueAmount,
        daysOverdue,
        parBucket: getParBucket(daysOverdue),
        status: loan.status,
      };
    }).filter((l) => l.daysOverdue > 0);

    // Calculate PAR ratios
    const totalOutstanding = loans.reduce((sum, l) => sum + Number(l.outstandingBalance), 0);
    const parByBucket: Record<string, { count: number; amount: number; outstanding: number }> = {
      '1-30': { count: 0, amount: 0, outstanding: 0 },
      '31-60': { count: 0, amount: 0, outstanding: 0 },
      '61-90': { count: 0, amount: 0, outstanding: 0 },
      '91-180': { count: 0, amount: 0, outstanding: 0 },
      '180+': { count: 0, amount: 0, outstanding: 0 },
    };

    for (const loan of parLoans) {
      const bucket = parByBucket[loan.parBucket];
      if (bucket) {
        bucket.count++;
        bucket.amount += loan.overdueAmount;
        bucket.outstanding += loan.outstandingBalance;
      }
    }

    // Calculate PAR ratios
    const parRatios = Object.entries(parByBucket).map(([bucket, data]) => ({
      bucket,
      loanCount: data.count,
      overdueAmount: data.amount,
      outstandingBalance: data.outstanding,
      parRatio: totalOutstanding > 0 ? (data.outstanding / totalOutstanding) * 100 : 0,
    }));

    // Overall PAR
    const totalPar = parLoans.filter((l) => l.daysOverdue >= parDays);
    const parAmount = totalPar.reduce((sum, l) => sum + l.outstandingBalance, 0);
    const parRatio = totalOutstanding > 0 ? (parAmount / totalOutstanding) * 100 : 0;

    res.json({
      success: true,
      data: {
        asOfDate,
        parDays,
        summary: {
          totalLoans: loans.length,
          totalOutstanding,
          parLoans: totalPar.length,
          parAmount,
          parRatio: Math.round(parRatio * 100) / 100,
        },
        byBucket: parRatios,
        details: parLoans.slice(0, 100), // Limit details for response size
      },
    });
  })
);

/**
 * Get PAR bucket for days overdue
 */
function getParBucket(days: number): string {
  if (days <= 30) return '1-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  if (days <= 180) return '91-180';
  return '180+';
}

/**
 * Aging Report
 * GET /api/reports/aging
 */
const agingSchema = z.object({
  query: z.object({
    asOfDate: z.string().optional(),
    branchId: z.string().optional(),
    groupBy: z.enum(['client', 'branch', 'officer', 'product']).default('client'),
  }),
});

router.get(
  '/aging',
  requirePermission('reports:view'),
  validateRequest(agingSchema),
  handleAsync(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const asOfDate = req.query.asOfDate ? new Date(req.query.asOfDate as string) : new Date();
    const branchId = req.query.branchId as string | undefined;

    // Get all overdue schedules
    const overdueSchedules = await prisma.repaymentSchedule.findMany({
      where: {
        status: 'PENDING',
        dueDate: { lt: asOfDate },
        loan: {
          organizationId,
          status: { in: ['ACTIVE', 'OVERDUE'] },
          ...(branchId && { branchId }),
        },
      },
      include: {
        loan: {
          include: {
            client: { select: { firstName: true, lastName: true, clientNumber: true } },
            branch: { select: { name: true } },
            product: { select: { name: true } },
            loanOfficer: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });

    // Aggregate by aging bucket
    const agingBuckets = {
      current: { count: 0, principal: 0, interest: 0, penalty: 0, total: 0 },
      '1-30': { count: 0, principal: 0, interest: 0, penalty: 0, total: 0 },
      '31-60': { count: 0, principal: 0, interest: 0, penalty: 0, total: 0 },
      '61-90': { count: 0, principal: 0, interest: 0, penalty: 0, total: 0 },
      '91-180': { count: 0, principal: 0, interest: 0, penalty: 0, total: 0 },
      '180+': { count: 0, principal: 0, interest: 0, penalty: 0, total: 0 },
    };

    const details: any[] = [];

    for (const schedule of overdueSchedules) {
      const daysOverdue = Math.floor(
        (asOfDate.getTime() - schedule.dueDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      const bucket = daysOverdue <= 0 ? 'current' : getParBucket(daysOverdue);

      const totalPaid = Number(schedule.paidAmount || 0);
      const principalDue = Number(schedule.principalAmount);
      const interestDue = Number(schedule.interestAmount);
      const penaltyDue = 0; // No penalty field in RepaymentSchedule
      const totalDue = Number(schedule.outstandingAmount);

      const bucketData = agingBuckets[bucket as keyof typeof agingBuckets];
      bucketData.count++;
      bucketData.principal += principalDue;
      bucketData.interest += interestDue;
      bucketData.penalty += penaltyDue;
      bucketData.total += totalDue;

      details.push({
        loanNumber: schedule.loan.loanNumber,
        clientName: `${schedule.loan.client.firstName} ${schedule.loan.client.lastName}`,
        branchName: schedule.loan.branch?.name || 'N/A',
        productName: schedule.loan.product?.name || 'N/A',
        dueDate: schedule.dueDate,
        daysOverdue,
        bucket,
        principalDue,
        interestDue,
        penaltyDue,
        totalDue,
      });
    }

    // Sort details by days overdue descending
    details.sort((a, b) => b.daysOverdue - a.daysOverdue);

    // Calculate totals
    const totals = Object.values(agingBuckets).reduce(
      (acc, bucket) => ({
        count: acc.count + bucket.count,
        principal: acc.principal + bucket.principal,
        interest: acc.interest + bucket.interest,
        penalty: acc.penalty + bucket.penalty,
        total: acc.total + bucket.total,
      }),
      { count: 0, principal: 0, interest: 0, penalty: 0, total: 0 }
    );

    res.json({
      success: true,
      data: {
        asOfDate,
        summary: agingBuckets,
        totals,
        details: details.slice(0, 500), // Limit for response size
      },
    });
  })
);

/**
 * Collection Report
 * GET /api/reports/collections
 */
const collectionsSchema = z.object({
  query: z.object({
    startDate: z.string(),
    endDate: z.string(),
    branchId: z.string().optional(),
    groupBy: z.enum(['day', 'week', 'month', 'officer', 'method']).default('day'),
  }),
});

router.get(
  '/collections',
  requirePermission('reports:view'),
  validateRequest(collectionsSchema),
  handleAsync(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const startDate = new Date(req.query.startDate as string);
    const endDate = new Date(req.query.endDate as string);
    const branchId = req.query.branchId as string | undefined;
    const groupBy = req.query.groupBy as string;

    // Get all payments in date range
    const payments = await prisma.payment.findMany({
      where: {
        loan: { organizationId },
        status: 'COMPLETED',
        paymentDate: { gte: startDate, lte: endDate },
        ...(branchId && { loan: { branchId } }),
      },
      include: {
        loan: {
          include: {
            client: { select: { firstName: true, lastName: true } },
            branch: { select: { name: true } },
          },
        },
        receiver: { select: { firstName: true, lastName: true } },
      },
      orderBy: { paymentDate: 'asc' },
    });

    // Group data
    let grouped: Record<string, { count: number; amount: number; details: any[] }> = {};

    for (const payment of payments) {
      let key: string;

      switch (groupBy) {
        case 'day':
          key = payment.paymentDate.toISOString().slice(0, 10);
          break;
        case 'week':
          const weekStart = new Date(payment.paymentDate);
          weekStart.setDate(weekStart.getDate() - weekStart.getDay());
          key = weekStart.toISOString().slice(0, 10);
          break;
        case 'month':
          key = payment.paymentDate.toISOString().slice(0, 7);
          break;
        case 'officer':
          key = payment.receiver
            ? `${payment.receiver.firstName} ${payment.receiver.lastName}`
            : 'Unknown';
          break;
        case 'method':
          key = payment.method || 'Unknown';
          break;
        default:
          key = payment.paymentDate.toISOString().slice(0, 10);
      }

      if (!grouped[key]) {
        grouped[key] = { count: 0, amount: 0, details: [] };
      }

      grouped[key]!.count++;
      grouped[key]!.amount += Number(payment.amount);
      grouped[key]!.details.push({
        receiptNumber: payment.paymentNumber,
        clientName: `${payment.loan.client.firstName} ${payment.loan.client.lastName}`,
        loanNumber: payment.loan.loanNumber,
        amount: Number(payment.amount),
        paymentMethod: payment.method,
        paymentDate: payment.paymentDate,
      });
    }

    // Calculate totals
    const totalAmount = payments.reduce((sum, p) => sum + Number(p.amount), 0);
    const totalCount = payments.length;

    // Convert to array and sort
    const groupedData = Object.entries(grouped)
      .map(([key, data]) => ({
        group: key,
        count: data.count,
        amount: data.amount,
        details: data.details.slice(0, 20), // Limit details per group
      }))
      .sort((a, b) => {
        if (groupBy === 'officer' || groupBy === 'method') {
          return b.amount - a.amount;
        }
        return a.group.localeCompare(b.group);
      });

    res.json({
      success: true,
      data: {
        period: { startDate, endDate },
        groupBy,
        summary: {
          totalPayments: totalCount,
          totalAmount,
        },
        grouped: groupedData,
      },
    });
  })
);

/**
 * Disbursement Report
 * GET /api/reports/disbursements
 */
const disbursementsSchema = z.object({
  query: z.object({
    startDate: z.string(),
    endDate: z.string(),
    branchId: z.string().optional(),
    productId: z.string().optional(),
  }),
});

router.get(
  '/disbursements',
  requirePermission('reports:view'),
  validateRequest(disbursementsSchema),
  handleAsync(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const startDate = new Date(req.query.startDate as string);
    const endDate = new Date(req.query.endDate as string);
    const branchId = req.query.branchId as string | undefined;
    const productId = req.query.productId as string | undefined;

    const loans = await prisma.loan.findMany({
      where: {
        organizationId,
        disbursedDate: { gte: startDate, lte: endDate },
        ...(branchId && { branchId }),
        ...(productId && { productId }),
      },
      include: {
        client: { select: { firstName: true, lastName: true, clientNumber: true } },
        branch: { select: { name: true, code: true } },
        product: { select: { name: true } },
        loanOfficer: { select: { firstName: true, lastName: true } },
      },
      orderBy: { disbursedDate: 'asc' },
    });

    // Group by product
    const byProduct: Record<string, { count: number; amount: number }> = {};
    // Group by branch
    const byBranch: Record<string, { count: number; amount: number }> = {};

    for (const loan of loans) {
      const productName = loan.product?.name || 'Unknown';
      const branchName = loan.branch?.name || 'Unknown';

      if (!byProduct[productName]) {
        byProduct[productName] = { count: 0, amount: 0 };
      }
      byProduct[productName].count++;
      byProduct[productName].amount += Number(loan.amount);

      if (!byBranch[branchName]) {
        byBranch[branchName] = { count: 0, amount: 0 };
      }
      byBranch[branchName].count++;
      byBranch[branchName].amount += Number(loan.amount);
    }

    // Calculate totals
    const totalAmount = loans.reduce((sum, l) => sum + Number(l.amount), 0);
    const totalCount = loans.length;
    const averageLoanSize = totalCount > 0 ? totalAmount / totalCount : 0;

    res.json({
      success: true,
      data: {
        period: { startDate, endDate },
        summary: {
          totalLoans: totalCount,
          totalDisbursed: totalAmount,
          averageLoanSize,
        },
        byProduct: Object.entries(byProduct).map(([product, data]) => ({
          product,
          ...data,
        })),
        byBranch: Object.entries(byBranch).map(([branch, data]) => ({
          branch,
          ...data,
        })),
        details: loans.slice(0, 500).map((loan) => ({
          loanNumber: loan.loanNumber,
          clientName: `${loan.client.firstName} ${loan.client.lastName}`,
          branchName: loan.branch?.name || 'N/A',
          productName: loan.product?.name || 'N/A',
          loanOfficer: loan.loanOfficer
            ? `${loan.loanOfficer.firstName} ${loan.loanOfficer.lastName}`
            : 'N/A',
          disbursementDate: loan.disbursedDate,
          disbursedAmount: Number(loan.amount),
          term: loan.term,
          interestRate: Number(loan.interestRate),
        })),
      },
    });
  })
);

/**
 * Export report to Excel
 * POST /api/reports/export
 */
const exportSchema = z.object({
  body: z.object({
    reportType: z.enum(['par', 'aging', 'collections', 'disbursements']),
    data: z.array(z.record(z.any())),
    filename: z.string().optional(),
  }),
});

router.post(
  '/export',
  requirePermission('reports:export'),
  validateRequest(exportSchema),
  handleAsync(async (req, res) => {
    const { reportType, data, filename } = req.body;

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, reportType.toUpperCase());

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const exportFilename = filename || `${reportType}_report_${new Date().toISOString().slice(0, 10)}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${exportFilename}`);
    res.send(buffer);
  })
);

/**
 * Loan Portfolio Summary Report
 * GET /api/reports/portfolio-summary
 */
router.get(
  '/portfolio-summary',
  requirePermission('reports:view'),
  handleAsync(async (req, res) => {
    const organizationId = req.user!.organizationId!;
    const branchId = req.query.branchId as string | undefined;

    const where = {
      organizationId,
      ...(branchId && { branchId }),
    };

    // Get loan counts by status
    const statusCounts = await prisma.loan.groupBy({
      by: ['status'],
      where,
      _count: true,
      _sum: { amount: true, outstandingBalance: true },
    });

    // Get product breakdown
    const productBreakdown = await prisma.loan.groupBy({
      by: ['productId'],
      where: { ...where, status: { in: ['ACTIVE', 'OVERDUE'] } },
      _count: true,
      _sum: { outstandingBalance: true },
    });

    // Get product names
    const productIds = productBreakdown.map((p) => p.productId).filter(Boolean);
    const products = await prisma.loanProduct.findMany({
      where: { id: { in: productIds as string[] } },
      select: { id: true, name: true },
    });
    const productMap = new Map(products.map((p) => [p.id, p.name]));

    // Get currency breakdown
    const currencyBreakdown = await prisma.loan.groupBy({
      by: ['currency'],
      where: { ...where, status: { in: ['ACTIVE', 'OVERDUE'] } },
      _count: true,
      _sum: { outstandingBalance: true },
    });

    res.json({
      success: true,
      data: {
        byStatus: statusCounts.map((s) => ({
          status: s.status,
          count: s._count,
          disbursedAmount: Number(s._sum.amount || 0),
          outstandingBalance: Number(s._sum.outstandingBalance || 0),
        })),
        byProduct: productBreakdown.map((p) => ({
          productId: p.productId,
          productName: productMap.get(p.productId || '') || 'Unknown',
          count: p._count,
          outstandingBalance: Number(p._sum.outstandingBalance || 0),
        })),
        byCurrency: currencyBreakdown.map((c) => ({
          currency: c.currency || 'USD',
          count: c._count,
          outstandingBalance: Number(c._sum.outstandingBalance || 0),
        })),
        generatedAt: new Date(),
      },
    });
  })
);

export default router;
