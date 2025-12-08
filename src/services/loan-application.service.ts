import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
const Decimal = Prisma.Decimal;
import {
  loanCalculationService,
  LoanCalculationInput,
} from './loan-calculations';
import { financialTransactionService } from './financial-transaction.service';

export interface LoanApplication {
  id: string;
  loanNumber: string;
  clientId: string;
  clientName?: string;
  productId: string;
  productName?: string;
  organizationId: string;
  branchId: string;
  branchName?: string;
  loanOfficerId: string;
  loanOfficerName?: string;
  amount: number;
  interestRate: number;
  calculationMethod: string;
  term: number;
  repaymentFrequency: string;
  installmentAmount: number;
  totalAmount: number;
  totalInterest: number;
  status: string;
  applicationDate: Date;
  approvedDate?: Date;
  disbursedDate?: Date;
  maturityDate?: Date;
  purpose?: string;
  collateralValue?: number;
  collateralDescription?: string;
  guarantorInfo?: any;
  notes?: string;
  outstandingBalance?: number;
  principalBalance?: number;
  interestBalance?: number;
}

export interface LoanApplicationFilters {
  status?: string;
  clientId?: string;
  productId?: string;
  branchId?: string;
  loanOfficerId?: string;
  amountFrom?: number;
  amountTo?: number;
  dateFrom?: Date;
  dateTo?: Date;
  page?: number;
  limit?: number;
}

// Validation schemas
export const createLoanApplicationSchema = z.object({
  clientId: z.string().uuid('Invalid client ID'),
  productId: z.string().uuid('Invalid product ID'),
  amount: z.coerce.number().positive('Loan amount must be positive'),
  termInMonths: z.coerce
    .number()
    .int()
    .positive('Term must be a positive integer'),
  purpose: z.string().min(1, 'Loan purpose is required'),
  collateralValue: z.coerce.number().min(0).optional(),
  collateralDescription: z.string().optional(),
  guarantorInfo: z.any().optional(),
  notes: z.string().optional(),
  branchId: z.string().uuid('Invalid branch ID').optional(),
});

export const approveLoanSchema = z.object({
  approvedAmount: z.number().positive().optional(),
  approvedTerm: z.number().int().positive().optional(),
  approvedInterestRate: z.number().min(0).optional(),
  notes: z.string().optional(),
});

export const disburseLoanSchema = z.object({
  disbursementMethod: z.enum([
    'CASH',
    'BANK_TRANSFER',
    'MOBILE_MONEY',
    'CHECK',
  ]),
  paymentMethodId: z
    .string()
    .uuid('Payment method ID is required for financial tracking'),
  disbursementAccount: z.string().optional(),
  disbursementFee: z.number().min(0).optional(),
  notes: z.string().optional(),
});

class LoanApplicationService {
  /**
   * Generate unique loan number
   */
  private async generateLoanNumber(organizationId: string): Promise<string> {
    const today = new Date();
    const year = today.getFullYear().toString().slice(-2);
    const month = (today.getMonth() + 1).toString().padStart(2, '0');

    // Get count of loans this month
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const count = await prisma.loan.count({
      where: {
        organizationId,
        createdAt: {
          gte: startOfMonth,
        },
      },
    });

    const sequence = (count + 1).toString().padStart(4, '0');
    return `LN${year}${month}${sequence}`;
  }

  /**
   * Create loan application
   */
  async createLoanApplication(
    applicationData: z.infer<typeof createLoanApplicationSchema>,
    organizationId: string,
    branchId: string,
    loanOfficerId: string
  ): Promise<LoanApplication> {
    // Get loan product details
    const product = await prisma.loanProduct.findFirst({
      where: {
        id: applicationData.productId,
        organizationId,
        isActive: true,
      },
    });

    if (!product) {
      throw new Error('Loan product not found or inactive');
    }

    // Validate loan amount against product limits
    if (
      applicationData.amount < parseFloat(product.minAmount.toString()) ||
      applicationData.amount > parseFloat(product.maxAmount.toString())
    ) {
      throw new Error(
        `Loan amount must be between ${product.minAmount} and ${product.maxAmount}`
      );
    }

    // Validate term against product limits
    if (
      applicationData.termInMonths < product.minTerm ||
      applicationData.termInMonths > product.maxTerm
    ) {
      throw new Error(
        `Loan term must be between ${product.minTerm} and ${product.maxTerm} months`
      );
    }

    // Calculate loan details
    const calculationInput: LoanCalculationInput = {
      principalAmount: new Decimal(applicationData.amount),
      annualInterestRate: product.interestRate,
      termInMonths: applicationData.termInMonths,
      repaymentFrequency: product.repaymentFrequency as any,
      calculationMethod: product.calculationMethod as any,
    };

    const loanCalculation =
      await loanCalculationService.calculateLoan(calculationInput);
    const loanNumber = await this.generateLoanNumber(organizationId);

    // Calculate maturity date
    const maturityDate = new Date();
    maturityDate.setMonth(
      maturityDate.getMonth() + applicationData.termInMonths
    );

    const loan = await prisma.loan.create({
      data: {
        loanNumber,
        clientId: applicationData.clientId,
        productId: applicationData.productId,
        organizationId,
        branchId,
        loanOfficerId,
        amount: applicationData.amount,
        interestRate: product.interestRate,
        calculationMethod: product.calculationMethod,
        term: applicationData.termInMonths,
        repaymentFrequency: product.repaymentFrequency,
        installmentAmount: loanCalculation.monthlyInstallment,
        totalAmount: loanCalculation.totalAmount,
        totalInterest: loanCalculation.totalInterest,
        status: 'PENDING',
        applicationDate: new Date(),
        maturityDate,
        purpose: applicationData.purpose,
        collateralValue: applicationData.collateralValue,
        collateralDescription: applicationData.collateralDescription,
        guarantorInfo: applicationData.guarantorInfo,
        notes: applicationData.notes,
        outstandingBalance: loanCalculation.totalAmount,
        principalBalance: applicationData.amount,
        interestBalance: loanCalculation.totalInterest,
        penaltyBalance: 0,
      },
      include: {
        client: true,
        product: true,
        branch: true,
        loanOfficer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    // Generate repayment schedule
    await this.generateRepaymentSchedule(
      loan.id,
      loanCalculation.repaymentSchedule
    );

    return this.mapLoanToApplication(loan);
  }

  /**
   * Get loan applications with filters
   */
  async getLoanApplications(
    filters: LoanApplicationFilters,
    organizationId: string
  ): Promise<{
    applications: LoanApplication[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = filters.page || 1;
    const limit = filters.limit || 10;
    const skip = (page - 1) * limit;

    // Build where clause
    const where: any = {
      organizationId,
    };

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.clientId) {
      where.clientId = filters.clientId;
    }

    if (filters.productId) {
      where.productId = filters.productId;
    }

    if (filters.branchId) {
      where.branchId = filters.branchId;
    }

    if (filters.loanOfficerId) {
      where.loanOfficerId = filters.loanOfficerId;
    }

    if (filters.amountFrom || filters.amountTo) {
      where.amount = {};
      if (filters.amountFrom) where.amount.gte = filters.amountFrom;
      if (filters.amountTo) where.amount.lte = filters.amountTo;
    }

    if (filters.dateFrom || filters.dateTo) {
      where.applicationDate = {};
      if (filters.dateFrom) where.applicationDate.gte = filters.dateFrom;
      if (filters.dateTo) where.applicationDate.lte = filters.dateTo;
    }

    const [loans, total] = await Promise.all([
      prisma.loan.findMany({
        where,
        skip,
        take: limit,
        include: {
          client: true,
          product: true,
          branch: true,
          loanOfficer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
        orderBy: [{ applicationDate: 'desc' }],
      }),
      prisma.loan.count({ where }),
    ]);

    return {
      applications: loans.map(loan => this.mapLoanToApplication(loan)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get loan application by ID
   */
  async getLoanApplicationById(
    loanId: string,
    organizationId: string
  ): Promise<LoanApplication | null> {
    const loan = await prisma.loan.findFirst({
      where: {
        id: loanId,
        organizationId,
      },
      include: {
        client: true,
        product: true,
        branch: true,
        loanOfficer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        repaymentSchedule: true,
        payments: true,
        loanCharges: {
          include: {
            charge: true,
          },
        },
      },
    });

    return loan ? this.mapLoanToApplication(loan) : null;
  }

  /**
   * Approve loan application
   */
  async approveLoanApplication(
    loanId: string,
    approvalData: z.infer<typeof approveLoanSchema>,
    organizationId: string,
    approvedBy: string
  ): Promise<LoanApplication> {
    const loan = await prisma.loan.findFirst({
      where: {
        id: loanId,
        organizationId,
        status: 'PENDING',
      },
      include: {
        product: true,
      },
    });

    if (!loan) {
      throw new Error('Loan application not found or not in pending status');
    }

    // If approved amount/term/rate is different, recalculate
    let updatedData: any = {
      status: 'APPROVED',
      approvedDate: new Date(),
      notes: approvalData.notes
        ? `${loan.notes || ''}\n\nApproval Notes: ${approvalData.notes}`
        : loan.notes,
    };

    if (
      approvalData.approvedAmount ||
      approvalData.approvedTerm ||
      approvalData.approvedInterestRate
    ) {
      const calculationInput: LoanCalculationInput = {
        principalAmount: approvalData.approvedAmount
          ? new Decimal(approvalData.approvedAmount)
          : loan.amount,
        annualInterestRate: approvalData.approvedInterestRate
          ? new Decimal(approvalData.approvedInterestRate)
          : loan.interestRate,
        termInMonths: approvalData.approvedTerm || loan.term,
        repaymentFrequency: loan.repaymentFrequency as any,
        calculationMethod: loan.calculationMethod as any,
      };

      const loanCalculation =
        await loanCalculationService.calculateLoan(calculationInput);

      updatedData = {
        ...updatedData,
        amount: approvalData.approvedAmount || loan.amount,
        interestRate: approvalData.approvedInterestRate || loan.interestRate,
        term: approvalData.approvedTerm || loan.term,
        installmentAmount: loanCalculation.monthlyInstallment,
        totalAmount: loanCalculation.totalAmount,
        totalInterest: loanCalculation.totalInterest,
        outstandingBalance: loanCalculation.totalAmount,
        principalBalance:
          approvalData.approvedAmount || parseFloat(loan.amount.toString()),
        interestBalance: loanCalculation.totalInterest,
      };

      // Regenerate repayment schedule if loan terms changed
      await prisma.repaymentSchedule.deleteMany({
        where: { loanId },
      });
      await this.generateRepaymentSchedule(
        loanId,
        loanCalculation.repaymentSchedule
      );
    }

    const updatedLoan = await prisma.loan.update({
      where: { id: loanId },
      data: updatedData,
      include: {
        client: true,
        product: true,
        branch: true,
        loanOfficer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    return this.mapLoanToApplication(updatedLoan);
  }

  /**
   * Reject loan application
   */
  async rejectLoanApplication(
    loanId: string,
    rejectionReason: string,
    organizationId: string,
    rejectedBy: string
  ): Promise<LoanApplication> {
    const updatedLoan = await prisma.loan.update({
      where: {
        id: loanId,
        organizationId,
        status: 'PENDING',
      },
      data: {
        status: 'CANCELLED',
        notes: rejectionReason,
        updatedAt: new Date(),
      },
      include: {
        client: true,
        product: true,
        branch: true,
        loanOfficer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    return this.mapLoanToApplication(updatedLoan);
  }

  /**
   * Disburse approved loan
   */
  async disburseLoan(
    loanId: string,
    disbursementData: z.infer<typeof disburseLoanSchema>,
    organizationId: string,
    disbursedBy: string
  ): Promise<LoanApplication> {
    const loan = await prisma.loan.findFirst({
      where: {
        id: loanId,
        organizationId,
        status: 'APPROVED',
      },
      include: {
        branch: { select: { id: true } },
        product: { select: { currency: true } },
      },
    });

    if (!loan) {
      throw new Error('Loan not found or not in approved status');
    }

    const disbursementDate = new Date();
    const disbursementAmount = parseFloat(loan.amount.toString());

    // Update loan status to ACTIVE
    const updatedLoan = await prisma.loan.update({
      where: { id: loanId },
      data: {
        status: 'ACTIVE',
        disbursedDate: disbursementDate,
        notes: disbursementData.notes
          ? `${loan.notes || ''}\n\nDisbursement Notes: ${disbursementData.notes}`
          : loan.notes,
      },
      include: {
        client: true,
        product: true,
        branch: true,
        loanOfficer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    // Create disbursement payment record
    const payment = await prisma.payment.create({
      data: {
        paymentNumber: `DISB-${loan.loanNumber}`,
        loanId,
        amount: disbursementAmount,
        principalAmount: disbursementAmount,
        interestAmount: 0,
        penaltyAmount: 0,
        type: 'LOAN_DISBURSEMENT',
        method: disbursementData.disbursementMethod,
        status: 'COMPLETED',
        paymentDate: disbursementDate,
        receivedBy: disbursedBy,
        notes: `Loan disbursement via ${disbursementData.disbursementMethod}`,
      },
    });

    // Create financial transaction for the disbursement (expense)
    await financialTransactionService.recordLoanDisbursement(
      organizationId,
      loan.branchId,
      loanId,
      loan.loanNumber,
      disbursementAmount,
      loan.product?.currency || 'USD',
      disbursementData.paymentMethodId,
      disbursedBy
    );

    return this.mapLoanToApplication(updatedLoan);
  }

  /**
   * Generate repayment schedule for loan
   */
  private async generateRepaymentSchedule(
    loanId: string,
    schedule: any[]
  ): Promise<void> {
    const repaymentData = schedule.map((installment, index) => ({
      loanId,
      installmentNumber: index + 1,
      dueDate: installment.dueDate,
      principalAmount: installment.principalAmount,
      interestAmount: installment.interestAmount,
      totalAmount: installment.totalAmount,
      outstandingAmount: installment.totalAmount,
      status: 'PENDING' as const,
    }));

    await prisma.repaymentSchedule.createMany({
      data: repaymentData,
    });
  }

  /**
   * Get loan application statistics
   */
  async getLoanApplicationStatistics(
    organizationId: string,
    branchId?: string
  ): Promise<{
    total: number;
    pending: number;
    approved: number;
    active: number;
    completed: number;
    cancelled: number;
    overdue: number;
    totalAmount: number;
    averageAmount: number;
    averageTerm: number;
  }> {
    const where: any = { organizationId };
    if (branchId) {
      where.branchId = branchId;
    }

    const [
      total,
      pending,
      approved,
      active,
      completed,
      cancelled,
      overdue,
      aggregates,
    ] = await Promise.all([
      prisma.loan.count({ where }),
      prisma.loan.count({ where: { ...where, status: 'PENDING' } }),
      prisma.loan.count({ where: { ...where, status: 'APPROVED' } }),
      prisma.loan.count({ where: { ...where, status: 'ACTIVE' } }),
      prisma.loan.count({ where: { ...where, status: 'COMPLETED' } }),
      prisma.loan.count({ where: { ...where, status: 'CANCELLED' } }),
      prisma.loan.count({ where: { ...where, status: 'OVERDUE' } }),
      prisma.loan.aggregate({
        where,
        _sum: { amount: true },
        _avg: { amount: true, term: true },
      }),
    ]);

    return {
      total,
      pending,
      approved,
      active,
      completed,
      cancelled,
      overdue,
      totalAmount: parseFloat(aggregates._sum.amount?.toString() || '0'),
      averageAmount: parseFloat(aggregates._avg.amount?.toString() || '0'),
      averageTerm: parseFloat(aggregates._avg.term?.toString() || '0'),
    };
  }

  /**
   * Map Prisma loan to LoanApplication
   */
  private mapLoanToApplication(loan: any): LoanApplication {
    // Build client name from client relation if available
    const clientName = loan.client
      ? `${loan.client.firstName || ''} ${loan.client.lastName || ''}`.trim()
      : undefined;

    // Build loan officer name from loanOfficer relation if available
    const loanOfficerName = loan.loanOfficer
      ? `${loan.loanOfficer.firstName || ''} ${loan.loanOfficer.lastName || ''}`.trim()
      : undefined;

    return {
      id: loan.id,
      loanNumber: loan.loanNumber,
      clientId: loan.clientId,
      clientName,
      productId: loan.productId,
      productName: loan.product?.name,
      organizationId: loan.organizationId,
      branchId: loan.branchId,
      branchName: loan.branch?.name,
      loanOfficerId: loan.loanOfficerId,
      loanOfficerName,
      amount: parseFloat(loan.amount.toString()),
      interestRate: parseFloat(loan.interestRate.toString()),
      calculationMethod: loan.calculationMethod,
      term: loan.term,
      repaymentFrequency: loan.repaymentFrequency,
      installmentAmount: parseFloat(loan.installmentAmount.toString()),
      totalAmount: parseFloat(loan.totalAmount.toString()),
      totalInterest: parseFloat(loan.totalInterest.toString()),
      status: loan.status,
      applicationDate: loan.applicationDate,
      approvedDate: loan.approvedDate,
      disbursedDate: loan.disbursedDate,
      maturityDate: loan.maturityDate,
      purpose: loan.purpose,
      collateralValue: loan.collateralValue
        ? parseFloat(loan.collateralValue.toString())
        : undefined,
      collateralDescription: loan.collateralDescription,
      guarantorInfo: loan.guarantorInfo,
      notes: loan.notes,
      outstandingBalance: loan.outstandingBalance
        ? parseFloat(loan.outstandingBalance.toString())
        : undefined,
      principalBalance: loan.principalBalance
        ? parseFloat(loan.principalBalance.toString())
        : undefined,
      interestBalance: loan.interestBalance
        ? parseFloat(loan.interestBalance.toString())
        : undefined,
    };
  }
}

export const loanApplicationService = new LoanApplicationService();
