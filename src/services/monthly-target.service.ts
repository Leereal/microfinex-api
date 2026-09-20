import { prisma } from '../config/database';
import {
  Prisma,
  Currency,
  TargetType,
  LoanStatus,
  PaymentStatus,
} from '@prisma/client';

export interface CreateMonthlyTargetInput {
  organizationId: string;
  branchId: string;
  currency: Currency;
  targetType: TargetType;
  targetAmount: number;
  year: number;
  month: number;
  notes?: string;
  createdBy?: string;
}

export interface UpdateMonthlyTargetInput {
  targetAmount?: number;
  notes?: string | null;
  isActive?: boolean;
  updatedBy?: string;
}

export interface MonthlyTargetFilters {
  organizationId: string;
  branchId?: string;
  currency?: Currency;
  targetType?: TargetType;
  year?: number;
  month?: number;
  isActive?: boolean;
  page?: number;
  limit?: number;
}

/** One loan, top-up or repayment counted towards a monthly target. */
export interface TargetContribution {
  id: string;
  kind: 'DISBURSEMENT' | 'TOP_UP' | 'REPAYMENT';
  branchName: string;
  reference: string;
  loanId: string;
  loanNumber: string;
  clientName: string;
  date: Date | null;
  amount: number;
  method?: string;
  handledBy: string;
}

const clientName = (
  client?: {
    firstName?: string | null;
    lastName?: string | null;
    businessName?: string | null;
  } | null
): string =>
  [client?.firstName, client?.lastName].filter(Boolean).join(' ') ||
  client?.businessName ||
  'Unknown client';

const personName = (
  person?: { firstName?: string | null; lastName?: string | null } | null
): string =>
  [person?.firstName, person?.lastName].filter(Boolean).join(' ') || '-';

export interface TargetProgress {
  id: string;
  branchId: string;
  branchName: string;
  branchCode: string;
  currency: Currency;
  targetType: TargetType;
  targetAmount: number;
  achievedAmount: number;
  remainingAmount: number;
  percentageAchieved: number;
  year: number;
  month: number;
  isOnTrack: boolean;
}

export interface OrganizationTargetSummary {
  currency: Currency;
  targetType: TargetType;
  totalTarget: number;
  totalAchieved: number;
  totalRemaining: number;
  percentageAchieved: number;
  year: number;
  month: number;
  branchCount: number;
  branchesOnTrack: number;
  branchesAchieved: number;
}

class MonthlyTargetService {
  /**
   * Create a new monthly target
   */
  async create(data: CreateMonthlyTargetInput) {
    // Check if target already exists for this combination
    const existing = await prisma.monthlyTarget.findUnique({
      where: {
        organizationId_branchId_currency_targetType_year_month: {
          organizationId: data.organizationId,
          branchId: data.branchId,
          currency: data.currency,
          targetType: data.targetType,
          year: data.year,
          month: data.month,
        },
      },
    });

    if (existing) {
      throw new Error(
        `Target already exists for this branch, currency, type, and period. Use update instead.`
      );
    }

    return prisma.monthlyTarget.create({
      data: {
        organizationId: data.organizationId,
        branchId: data.branchId,
        currency: data.currency,
        targetType: data.targetType,
        targetAmount: new Prisma.Decimal(data.targetAmount),
        year: data.year,
        month: data.month,
        notes: data.notes,
        createdBy: data.createdBy,
      },
      include: {
        branch: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
      },
    });
  }

  /**
   * Create or update a monthly target (upsert)
   */
  async upsert(data: CreateMonthlyTargetInput) {
    return prisma.monthlyTarget.upsert({
      where: {
        organizationId_branchId_currency_targetType_year_month: {
          organizationId: data.organizationId,
          branchId: data.branchId,
          currency: data.currency,
          targetType: data.targetType,
          year: data.year,
          month: data.month,
        },
      },
      update: {
        targetAmount: new Prisma.Decimal(data.targetAmount),
        notes: data.notes,
        updatedBy: data.createdBy,
        isActive: true,
      },
      create: {
        organizationId: data.organizationId,
        branchId: data.branchId,
        currency: data.currency,
        targetType: data.targetType,
        targetAmount: new Prisma.Decimal(data.targetAmount),
        year: data.year,
        month: data.month,
        notes: data.notes,
        createdBy: data.createdBy,
      },
      include: {
        branch: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
      },
    });
  }

  /**
   * Bulk upsert targets for multiple branches
   */
  async bulkUpsert(
    organizationId: string,
    targets: Omit<CreateMonthlyTargetInput, 'organizationId'>[],
    createdBy?: string
  ) {
    const results = await Promise.all(
      targets.map(target =>
        this.upsert({
          ...target,
          organizationId,
          createdBy,
        })
      )
    );
    return results;
  }

  /**
   * Get a single target by ID
   */
  async getById(id: string, organizationId: string) {
    return prisma.monthlyTarget.findFirst({
      where: { id, organizationId },
      include: {
        branch: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
      },
    });
  }

  /**
   * Get all targets with filters
   */
  async getAll(filters: MonthlyTargetFilters) {
    const {
      organizationId,
      branchId,
      currency,
      targetType,
      year,
      month,
      isActive,
      page = 1,
      limit = 50,
    } = filters;

    const where: Prisma.MonthlyTargetWhereInput = {
      organizationId,
      ...(branchId && { branchId }),
      ...(currency && { currency }),
      ...(targetType && { targetType }),
      ...(year && { year }),
      ...(month && { month }),
      ...(isActive !== undefined && { isActive }),
    };

    const [targets, total] = await Promise.all([
      prisma.monthlyTarget.findMany({
        where,
        include: {
          branch: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
        },
        orderBy: [
          { year: 'desc' },
          { month: 'desc' },
          { branch: { name: 'asc' } },
        ],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.monthlyTarget.count({ where }),
    ]);

    return {
      data: targets,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Update a target
   */
  async update(
    id: string,
    organizationId: string,
    data: UpdateMonthlyTargetInput
  ) {
    const existing = await prisma.monthlyTarget.findFirst({
      where: { id, organizationId },
    });

    if (!existing) {
      throw new Error('Target not found');
    }

    return prisma.monthlyTarget.update({
      where: { id },
      data: {
        ...(data.targetAmount !== undefined && {
          targetAmount: new Prisma.Decimal(data.targetAmount),
        }),
        ...(data.notes !== undefined && { notes: data.notes }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        ...(data.updatedBy && { updatedBy: data.updatedBy }),
      },
      include: {
        branch: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
      },
    });
  }

  /**
   * Delete a target
   */
  async delete(id: string, organizationId: string) {
    const existing = await prisma.monthlyTarget.findFirst({
      where: { id, organizationId },
    });

    if (!existing) {
      throw new Error('Target not found');
    }

    return prisma.monthlyTarget.delete({ where: { id } });
  }

  /**
   * Get disbursements for a specific month/branch/currency
   *
   * Counted as principal advanced, which is two things: the loans first paid
   * out this month, and any top-up made this month on a loan paid out earlier.
   * A top-up raises the loan's principal, so charging the whole of it to the
   * original disbursement date would credit it to the wrong month and leave the
   * month it actually happened in showing nothing.
   */
  private async getDisbursementsAmount(
    organizationId: string,
    branchId: string,
    currency: Currency,
    year: number,
    month: number
  ): Promise<number> {
    const items = await this.getDisbursementBreakdown(
      organizationId,
      branchId,
      currency,
      year,
      month
    );

    return items.reduce((total, item) => total + item.amount, 0);
  }

  /**
   * Get repayments for a specific month/branch/currency
   *
   * Money the lender paid out sits in the same table as money it took in, so
   * this has to say which it wants. It did not, and a branch that had disbursed
   * two loans and collected nothing showed its whole disbursement as repayments
   * collected.
   */
  private async getRepaymentsAmount(
    organizationId: string,
    branchId: string,
    currency: Currency,
    year: number,
    month: number
  ): Promise<number> {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);

    const result = await prisma.payment.aggregate({
      where: {
        loan: {
          organizationId,
          branchId,
          currency,
        },
        status: PaymentStatus.COMPLETED,
        type: { notIn: ['LOAN_DISBURSEMENT', 'LOAN_TOPUP'] },
        paymentDate: {
          gte: startDate,
          lte: endDate,
        },
      },
      _sum: {
        amount: true,
      },
    });

    return Number(result._sum.amount || 0);
  }

  /**
   * The individual advances behind a disbursement figure.
   *
   * A target that only shows a total is hard to trust and impossible to check;
   * this is what the number is made of, so it can be opened up and every loan
   * and top-up in it seen.
   */
  async getDisbursementBreakdown(
    organizationId: string,
    branchId: string | undefined,
    currency: Currency,
    year: number,
    month: number
  ): Promise<TargetContribution[]> {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);

    const loans = await prisma.loan.findMany({
      where: {
        organizationId,
        // Omitted at organization level, where the figure covers every branch.
        ...(branchId ? { branchId } : {}),
        currency,
        status: {
          in: [LoanStatus.ACTIVE, LoanStatus.COMPLETED, LoanStatus.DEFAULTED],
        },
        disbursedDate: { gte: startDate, lte: endDate },
      },
      select: {
        id: true,
        loanNumber: true,
        amount: true,
        disbursedDate: true,
        client: {
          select: { firstName: true, lastName: true, businessName: true },
        },
        branch: { select: { name: true } },
        disbursedBy: { select: { firstName: true, lastName: true } },
      },
    });

    /**
     * A loan's `amount` is its principal today, top-ups included. What was
     * advanced on the day it was paid out is that less everything added since.
     */
    const topUpTotals = loans.length
      ? await prisma.payment.groupBy({
          by: ['loanId'],
          where: {
            loanId: { in: loans.map(loan => loan.id) },
            type: 'LOAN_TOPUP',
            status: PaymentStatus.COMPLETED,
          },
          _sum: { principalAmount: true },
        })
      : [];

    const toppedUp = new Map(
      topUpTotals.map(row => [row.loanId, Number(row._sum.principalAmount || 0)])
    );

    const contributions: TargetContribution[] = loans.map(loan => ({
      id: loan.id,
      branchName: loan.branch?.name ?? '-',
      kind: 'DISBURSEMENT' as const,
      reference: loan.loanNumber,
      loanId: loan.id,
      loanNumber: loan.loanNumber,
      clientName: clientName(loan.client),
      date: loan.disbursedDate,
      amount: Math.max(Number(loan.amount) - (toppedUp.get(loan.id) ?? 0), 0),
      handledBy: personName(loan.disbursedBy),
    }));

    const topUps = await prisma.payment.findMany({
      where: {
        loan: { organizationId, ...(branchId ? { branchId } : {}), currency },
        type: 'LOAN_TOPUP',
        status: PaymentStatus.COMPLETED,
        paymentDate: { gte: startDate, lte: endDate },
      },
      select: {
        id: true,
        paymentNumber: true,
        principalAmount: true,
        amount: true,
        paymentDate: true,
        loanId: true,
        loan: {
          select: {
            loanNumber: true,
            branch: { select: { name: true } },
            client: {
              select: {
                firstName: true,
                lastName: true,
                businessName: true,
              },
            },
          },
        },
        receiver: { select: { firstName: true, lastName: true } },
      },
    });

    for (const topUp of topUps) {
      contributions.push({
        id: topUp.id,
        kind: 'TOP_UP',
        branchName: topUp.loan?.branch?.name ?? '-',
        reference: topUp.paymentNumber,
        loanId: topUp.loanId,
        loanNumber: topUp.loan?.loanNumber ?? '',
        clientName: clientName(topUp.loan?.client),
        date: topUp.paymentDate,
        amount: Number(topUp.principalAmount ?? topUp.amount ?? 0),
        handledBy: personName(topUp.receiver),
      });
    }

    return contributions.sort(
      (a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0)
    );
  }

  /** The individual repayments behind a repayment figure. */
  async getRepaymentBreakdown(
    organizationId: string,
    branchId: string | undefined,
    currency: Currency,
    year: number,
    month: number
  ): Promise<TargetContribution[]> {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);

    const payments = await prisma.payment.findMany({
      where: {
        loan: { organizationId, ...(branchId ? { branchId } : {}), currency },
        status: PaymentStatus.COMPLETED,
        type: { notIn: ['LOAN_DISBURSEMENT', 'LOAN_TOPUP'] },
        paymentDate: { gte: startDate, lte: endDate },
      },
      select: {
        id: true,
        paymentNumber: true,
        transactionRef: true,
        amount: true,
        method: true,
        paymentDate: true,
        loanId: true,
        loan: {
          select: {
            loanNumber: true,
            branch: { select: { name: true } },
            client: {
              select: {
                firstName: true,
                lastName: true,
                businessName: true,
              },
            },
          },
        },
        receiver: { select: { firstName: true, lastName: true } },
      },
      orderBy: { paymentDate: 'asc' },
    });

    return payments.map(payment => ({
      id: payment.id,
      kind: 'REPAYMENT' as const,
      branchName: payment.loan?.branch?.name ?? '-',
      reference: payment.transactionRef || payment.paymentNumber,
      loanId: payment.loanId,
      loanNumber: payment.loan?.loanNumber ?? '',
      clientName: clientName(payment.loan?.client),
      date: payment.paymentDate,
      amount: Number(payment.amount ?? 0),
      method: payment.method,
      handledBy: personName(payment.receiver),
    }));
  }

  /** Everything that made up one target's achieved figure. */
  async getTargetBreakdown(
    organizationId: string,
    branchId: string | undefined,
    currency: Currency,
    targetType: TargetType,
    year: number,
    month: number
  ): Promise<{ items: TargetContribution[]; total: number }> {
    const items =
      targetType === TargetType.DISBURSEMENT
        ? await this.getDisbursementBreakdown(
            organizationId,
            branchId,
            currency,
            year,
            month
          )
        : await this.getRepaymentBreakdown(
            organizationId,
            branchId,
            currency,
            year,
            month
          );

    return {
      items,
      total: items.reduce((sum, item) => sum + item.amount, 0),
    };
  }

  /**
   * Get target progress for a specific month
   */
  async getTargetProgress(
    organizationId: string,
    year: number,
    month: number,
    branchId?: string,
    currency?: Currency,
    targetType?: TargetType
  ): Promise<TargetProgress[]> {
    const targets = await prisma.monthlyTarget.findMany({
      where: {
        organizationId,
        year,
        month,
        isActive: true,
        ...(branchId && { branchId }),
        ...(currency && { currency }),
        ...(targetType && { targetType }),
      },
      include: {
        branch: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
      },
      orderBy: [
        { branch: { name: 'asc' } },
        { currency: 'asc' },
        { targetType: 'asc' },
      ],
    });

    const progressPromises = targets.map(async target => {
      let achievedAmount: number;

      if (target.targetType === TargetType.DISBURSEMENT) {
        achievedAmount = await this.getDisbursementsAmount(
          organizationId,
          target.branchId,
          target.currency,
          year,
          month
        );
      } else {
        achievedAmount = await this.getRepaymentsAmount(
          organizationId,
          target.branchId,
          target.currency,
          year,
          month
        );
      }

      const targetAmount = Number(target.targetAmount);
      const remainingAmount = Math.max(0, targetAmount - achievedAmount);
      const percentageAchieved =
        targetAmount > 0 ? (achievedAmount / targetAmount) * 100 : 0;

      // On track if achieved >= expected progress based on current day of month
      const today = new Date();
      const daysInMonth = new Date(year, month, 0).getDate();
      const currentDay =
        today.getFullYear() === year && today.getMonth() + 1 === month
          ? today.getDate()
          : daysInMonth;
      const expectedProgress = (currentDay / daysInMonth) * 100;
      const isOnTrack = percentageAchieved >= expectedProgress * 0.8; // 80% of expected is on track

      return {
        id: target.id,
        branchId: target.branchId,
        branchName: target.branch.name,
        branchCode: target.branch.code,
        currency: target.currency,
        targetType: target.targetType,
        targetAmount,
        achievedAmount,
        remainingAmount,
        percentageAchieved: Math.round(percentageAchieved * 100) / 100,
        year,
        month,
        isOnTrack,
      };
    });

    return Promise.all(progressPromises);
  }

  /**
   * Get organization-wide target summary (aggregated from all branches)
   */
  async getOrganizationSummary(
    organizationId: string,
    year: number,
    month: number,
    currency?: Currency,
    targetType?: TargetType
  ): Promise<OrganizationTargetSummary[]> {
    // Get all targets grouped by currency and type
    const targets = await prisma.monthlyTarget.groupBy({
      by: ['currency', 'targetType'],
      where: {
        organizationId,
        year,
        month,
        isActive: true,
        ...(currency && { currency }),
        ...(targetType && { targetType }),
      },
      _sum: {
        targetAmount: true,
      },
      _count: {
        branchId: true,
      },
    });

    const summaryPromises = targets.map(async group => {
      // Get all branch targets for this currency/type
      const branchTargets = await prisma.monthlyTarget.findMany({
        where: {
          organizationId,
          year,
          month,
          currency: group.currency,
          targetType: group.targetType,
          isActive: true,
        },
        select: {
          branchId: true,
          targetAmount: true,
        },
      });

      // Calculate achieved amounts for each branch
      let totalAchieved = 0;
      let branchesAchieved = 0;
      let branchesOnTrack = 0;

      const today = new Date();
      const daysInMonth = new Date(year, month, 0).getDate();
      const currentDay =
        today.getFullYear() === year && today.getMonth() + 1 === month
          ? today.getDate()
          : daysInMonth;
      const expectedProgressRatio = currentDay / daysInMonth;

      for (const bt of branchTargets) {
        let achieved: number;
        if (group.targetType === TargetType.DISBURSEMENT) {
          achieved = await this.getDisbursementsAmount(
            organizationId,
            bt.branchId,
            group.currency,
            year,
            month
          );
        } else {
          achieved = await this.getRepaymentsAmount(
            organizationId,
            bt.branchId,
            group.currency,
            year,
            month
          );
        }

        totalAchieved += achieved;
        const targetAmt = Number(bt.targetAmount);
        if (achieved >= targetAmt) {
          branchesAchieved++;
          branchesOnTrack++;
        } else if (achieved >= expectedProgressRatio * targetAmt * 0.8) {
          branchesOnTrack++;
        }
      }

      const totalTarget = Number(group._sum.targetAmount || 0);
      const totalRemaining = Math.max(0, totalTarget - totalAchieved);
      const percentageAchieved =
        totalTarget > 0 ? (totalAchieved / totalTarget) * 100 : 0;

      return {
        currency: group.currency,
        targetType: group.targetType,
        totalTarget,
        totalAchieved,
        totalRemaining,
        percentageAchieved: Math.round(percentageAchieved * 100) / 100,
        year,
        month,
        branchCount: group._count.branchId,
        branchesOnTrack,
        branchesAchieved,
      };
    });

    return Promise.all(summaryPromises);
  }

  /**
   * Get historical target data for trend analysis
   */
  async getHistoricalData(
    organizationId: string,
    branchId?: string,
    currency?: Currency,
    targetType?: TargetType,
    months: number = 12
  ) {
    const now = new Date();
    const results: Array<{
      year: number;
      month: number;
      currency: Currency;
      targetType: TargetType;
      totalTarget: number;
      totalAchieved: number;
      percentageAchieved: number;
    }> = [];

    for (let i = 0; i < months; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const year = date.getFullYear();
      const month = date.getMonth() + 1;

      if (branchId) {
        // Get specific branch progress
        const progress = await this.getTargetProgress(
          organizationId,
          year,
          month,
          branchId,
          currency,
          targetType
        );

        for (const p of progress) {
          results.push({
            year,
            month,
            currency: p.currency,
            targetType: p.targetType,
            totalTarget: p.targetAmount,
            totalAchieved: p.achievedAmount,
            percentageAchieved: p.percentageAchieved,
          });
        }
      } else {
        // Get org-wide summary
        const summary = await this.getOrganizationSummary(
          organizationId,
          year,
          month,
          currency,
          targetType
        );

        for (const s of summary) {
          results.push({
            year,
            month,
            currency: s.currency,
            targetType: s.targetType,
            totalTarget: s.totalTarget,
            totalAchieved: s.totalAchieved,
            percentageAchieved: s.percentageAchieved,
          });
        }
      }
    }

    return results;
  }

  /**
   * Get dashboard summary for current month
   */
  async getDashboardSummary(organizationId: string, branchId?: string) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    if (branchId) {
      // Get branch-specific progress
      const progress = await this.getTargetProgress(
        organizationId,
        year,
        month,
        branchId
      );

      const disbursements = progress.filter(
        p => p.targetType === TargetType.DISBURSEMENT
      );
      const repayments = progress.filter(
        p => p.targetType === TargetType.REPAYMENT
      );

      return {
        year,
        month,
        branchId,
        disbursements,
        repayments,
      };
    } else {
      // Get org-wide summary
      const summary = await this.getOrganizationSummary(
        organizationId,
        year,
        month
      );

      const disbursements = summary.filter(
        s => s.targetType === TargetType.DISBURSEMENT
      );
      const repayments = summary.filter(
        s => s.targetType === TargetType.REPAYMENT
      );

      return {
        year,
        month,
        disbursements,
        repayments,
      };
    }
  }
}

export const monthlyTargetService = new MonthlyTargetService();
