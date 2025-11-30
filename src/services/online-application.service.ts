import { prisma } from '../config/database';
import { OnlineApplication, ApplicationSource, ApplicationStatus, ApplicationType, DisbursementPreference, LoanStatus, Prisma } from '@prisma/client';

// ===== ONLINE APPLICATION SERVICE =====
// Based on actual schema:
// model OnlineApplication {
//   id, source, applicationType, clientPhone, clientName, idNumber, amount,
//   productId, disbursementPreference, bankAccount, mobileNumber,
//   verificationCode, verificationExpiry, status, notes, createdAt, updatedAt
//   loans (relation)
// }

interface CreateApplicationData {
  source: ApplicationSource;
  applicationType: ApplicationType;
  clientPhone: string;
  clientName?: string;
  idNumber?: string;
  amount: number;
  productId: string;
  disbursementPreference: DisbursementPreference;
  bankAccount?: string;
  mobileNumber?: string;
  notes?: string;
}

interface UpdateApplicationData {
  clientName?: string;
  idNumber?: string;
  amount?: number;
  productId?: string;
  disbursementPreference?: DisbursementPreference;
  bankAccount?: string;
  mobileNumber?: string;
  notes?: string;
}

interface ApplicationFilters {
  search?: string;
  source?: ApplicationSource;
  applicationType?: ApplicationType;
  status?: ApplicationStatus;
  productId?: string;
  startDate?: Date;
  endDate?: Date;
  page?: number;
  limit?: number;
}

export const onlineApplicationService = {
  // Create a new online application (can be called from webhooks or web forms)
  async createApplication(data: CreateApplicationData): Promise<OnlineApplication> {
    // Generate verification code
    const verificationCode = Math.random().toString().substring(2, 8);
    const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    return prisma.onlineApplication.create({
      data: {
        source: data.source,
        applicationType: data.applicationType,
        clientPhone: data.clientPhone,
        clientName: data.clientName,
        idNumber: data.idNumber,
        amount: new Prisma.Decimal(data.amount),
        productId: data.productId,
        disbursementPreference: data.disbursementPreference,
        bankAccount: data.bankAccount,
        mobileNumber: data.mobileNumber,
        notes: data.notes,
        verificationCode,
        verificationExpiry,
        status: ApplicationStatus.PENDING,
      },
    });
  },

  // Get all applications with filters
  async getApplications(filters: ApplicationFilters = {}) {
    const { search, source, applicationType, status, productId, startDate, endDate, page = 1, limit = 20 } = filters;
    const skip = (page - 1) * limit;

    const where: Prisma.OnlineApplicationWhereInput = {
      ...(source && { source }),
      ...(applicationType && { applicationType }),
      ...(status && { status }),
      ...(productId && { productId }),
      ...(startDate && { createdAt: { gte: startDate } }),
      ...(endDate && { createdAt: { lte: endDate } }),
      ...(search && {
        OR: [
          { clientName: { contains: search, mode: 'insensitive' as const } },
          { clientPhone: { contains: search, mode: 'insensitive' as const } },
          { idNumber: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [applications, total] = await Promise.all([
      prisma.onlineApplication.findMany({
        where,
        skip,
        take: limit,
        include: {
          loans: {
            select: { id: true, amount: true, status: true },
            take: 1,
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.onlineApplication.count({ where }),
    ]);

    return {
      data: applications,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  // Get application by ID
  async getApplicationById(id: string): Promise<OnlineApplication | null> {
    return prisma.onlineApplication.findUnique({
      where: { id },
      include: {
        loans: {
          include: {
            payments: {
              orderBy: { paymentDate: 'asc' },
              take: 5,
            },
          },
        },
      },
    });
  },

  // Get application by phone (for duplicate checking)
  async getApplicationByPhone(phone: string, status?: ApplicationStatus): Promise<OnlineApplication | null> {
    return prisma.onlineApplication.findFirst({
      where: {
        clientPhone: phone,
        ...(status && { status }),
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  // Update application
  async updateApplication(id: string, data: UpdateApplicationData): Promise<OnlineApplication | null> {
    const application = await prisma.onlineApplication.findUnique({ where: { id } });
    if (!application) return null;

    return prisma.onlineApplication.update({
      where: { id },
      data: {
        ...(data.clientName && { clientName: data.clientName }),
        ...(data.idNumber && { idNumber: data.idNumber }),
        ...(data.amount && { amount: new Prisma.Decimal(data.amount) }),
        ...(data.productId && { productId: data.productId }),
        ...(data.disbursementPreference && { disbursementPreference: data.disbursementPreference }),
        ...(data.bankAccount !== undefined && { bankAccount: data.bankAccount }),
        ...(data.mobileNumber !== undefined && { mobileNumber: data.mobileNumber }),
        ...(data.notes !== undefined && { notes: data.notes }),
      },
    });
  },

  // Verify application with code
  async verifyApplication(id: string, code: string): Promise<OnlineApplication | null> {
    const application = await prisma.onlineApplication.findUnique({ where: { id } });
    if (!application) return null;

    // Check if verification code matches and hasn't expired
    if (application.verificationCode !== code) {
      throw new Error('Invalid verification code');
    }

    if (application.verificationExpiry && new Date() > application.verificationExpiry) {
      throw new Error('Verification code has expired');
    }

    return prisma.onlineApplication.update({
      where: { id },
      data: {
        status: ApplicationStatus.VERIFIED,
        verificationCode: null, // Clear the code after verification
        verificationExpiry: null,
      },
    });
  },

  // Resend verification code
  async resendVerificationCode(id: string): Promise<OnlineApplication | null> {
    const application = await prisma.onlineApplication.findUnique({ where: { id } });
    if (!application) return null;

    if (application.status !== ApplicationStatus.PENDING) {
      throw new Error('Application is not in pending status');
    }

    const verificationCode = Math.random().toString().substring(2, 8);
    const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

    return prisma.onlineApplication.update({
      where: { id },
      data: {
        verificationCode,
        verificationExpiry,
      },
    });
  },

  // Process application (approve/reject)
  async processApplication(
    id: string,
    action: 'approve' | 'reject',
    notes?: string
  ): Promise<OnlineApplication | null> {
    const application = await prisma.onlineApplication.findUnique({ where: { id } });
    if (!application) return null;

    const newStatus = action === 'approve' ? ApplicationStatus.PROCESSED : ApplicationStatus.REJECTED;

    return prisma.onlineApplication.update({
      where: { id },
      data: {
        status: newStatus,
        notes: notes || application.notes,
      },
    });
  },

  // Convert application to loan (creates a loan from this application)
  async convertToLoan(
    id: string,
    loanData: {
      clientId: string;
      organizationId: string;
      loanOfficerId: string; // Required
      branchId: string; // Required
      interestRate: number;
      term: number;
      repaymentFrequency: 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUAL' | 'ANNUAL';
      purpose?: string;
    }
  ): Promise<{ application: OnlineApplication; loanId: string } | null> {
    const application = await prisma.onlineApplication.findUnique({ where: { id } });
    if (!application) return null;

    if (application.status !== ApplicationStatus.VERIFIED && application.status !== ApplicationStatus.PROCESSED) {
      throw new Error('Application must be verified or processed before converting to loan');
    }

    // Calculate loan values
    const amount = application.amount;
    const interestRate = new Prisma.Decimal(loanData.interestRate);
    const term = loanData.term;
    
    // Simple interest calculation (can be enhanced)
    const totalInterest = amount.mul(interestRate).mul(term).div(1200); // Monthly rate
    const totalAmount = amount.add(totalInterest);
    const installmentAmount = totalAmount.div(term);
    
    // Generate loan number
    const loanCount = await prisma.loan.count({ where: { organizationId: loanData.organizationId } });
    const loanNumber = `LN-${Date.now()}-${(loanCount + 1).toString().padStart(6, '0')}`;

    // Create loan in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create the loan
      const loan = await tx.loan.create({
        data: {
          loanNumber,
          organizationId: loanData.organizationId,
          clientId: loanData.clientId,
          productId: application.productId,
          amount,
          interestRate,
          term,
          repaymentFrequency: loanData.repaymentFrequency,
          installmentAmount,
          totalAmount,
          totalInterest,
          status: LoanStatus.PENDING,
          purpose: loanData.purpose,
          loanOfficerId: loanData.loanOfficerId,
          branchId: loanData.branchId,
          applicationDate: new Date(),
          onlineApplicationId: application.id,
        },
      });

      // Update application status
      const updatedApplication = await tx.onlineApplication.update({
        where: { id },
        data: {
          status: ApplicationStatus.PROCESSED,
          notes: `Converted to loan: ${loan.id}`,
        },
      });

      return { application: updatedApplication, loanId: loan.id };
    });

    return result;
  },

  // Update status directly
  async updateStatus(id: string, status: ApplicationStatus, notes?: string): Promise<OnlineApplication | null> {
    const application = await prisma.onlineApplication.findUnique({ where: { id } });
    if (!application) return null;

    return prisma.onlineApplication.update({
      where: { id },
      data: {
        status,
        ...(notes && { notes }),
      },
    });
  },

  // Delete application
  async deleteApplication(id: string): Promise<boolean> {
    const application = await prisma.onlineApplication.findUnique({
      where: { id },
      include: { loans: { select: { id: true } } },
    });
    if (!application) return false;

    // Only allow deletion if no loans are linked
    if (application.loans.length > 0) {
      throw new Error('Cannot delete application with linked loans');
    }

    await prisma.onlineApplication.delete({ where: { id } });
    return true;
  },

  // Get application statistics
  async getApplicationStats(startDate?: Date, endDate?: Date) {
    const where: Prisma.OnlineApplicationWhereInput = {
      ...(startDate && { createdAt: { gte: startDate } }),
      ...(endDate && { createdAt: { lte: endDate } }),
    };

    const [
      totalApplications,
      bySource,
      byStatus,
      byType,
      amountStats,
    ] = await Promise.all([
      prisma.onlineApplication.count({ where }),
      prisma.onlineApplication.groupBy({
        by: ['source'],
        where,
        _count: true,
      }),
      prisma.onlineApplication.groupBy({
        by: ['status'],
        where,
        _count: true,
      }),
      prisma.onlineApplication.groupBy({
        by: ['applicationType'],
        where,
        _count: true,
      }),
      prisma.onlineApplication.aggregate({
        where,
        _sum: { amount: true },
        _avg: { amount: true },
        _min: { amount: true },
        _max: { amount: true },
      }),
    ]);

    // Count how many have been converted to loans
    const convertedToLoans = await prisma.loan.count({
      where: {
        onlineApplicationId: { not: null },
        ...(startDate && { createdAt: { gte: startDate } }),
        ...(endDate && { createdAt: { lte: endDate } }),
      },
    });

    return {
      total: totalApplications,
      converted: convertedToLoans,
      conversionRate: totalApplications > 0 
        ? ((convertedToLoans / totalApplications) * 100).toFixed(2) 
        : '0.00',
      bySource: bySource.map(s => ({
        source: s.source,
        count: s._count,
      })),
      byStatus: byStatus.map(s => ({
        status: s.status,
        count: s._count,
      })),
      byType: byType.map(t => ({
        type: t.applicationType,
        count: t._count,
      })),
      amounts: {
        total: amountStats._sum.amount,
        average: amountStats._avg.amount,
        min: amountStats._min.amount,
        max: amountStats._max.amount,
      },
    };
  },

  // Find potential duplicate applications
  async findDuplicates(phone: string, idNumber?: string) {
    const where: Prisma.OnlineApplicationWhereInput = {
      OR: [
        { clientPhone: phone },
        ...(idNumber ? [{ idNumber }] : []),
      ],
    };

    return prisma.onlineApplication.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
  },

  // Bulk update status
  async bulkUpdateStatus(
    applicationIds: string[],
    status: ApplicationStatus,
    notes?: string
  ) {
    return prisma.onlineApplication.updateMany({
      where: {
        id: { in: applicationIds },
      },
      data: {
        status,
        ...(notes && { notes }),
      },
    });
  },

  // Get expired applications (verification code expired)
  async getExpiredApplications() {
    return prisma.onlineApplication.findMany({
      where: {
        status: ApplicationStatus.PENDING,
        verificationExpiry: { lt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  // Expire pending applications
  async expirePendingApplications() {
    return prisma.onlineApplication.updateMany({
      where: {
        status: ApplicationStatus.PENDING,
        verificationExpiry: { lt: new Date() },
      },
      data: {
        status: ApplicationStatus.EXPIRED,
        notes: 'Verification code expired',
      },
    });
  },
};
