import { prisma } from '../config/database';
import {
  Prisma,
  FinancialTransactionType,
  FinancialTransactionStatus,
} from '@prisma/client';
import { paymentMethodService } from './payment-method.service';

export interface CreateFinancialTransactionInput {
  organizationId: string;
  branchId?: string;
  type: FinancialTransactionType;
  incomeCategoryId?: string;
  expenseCategoryId?: string;
  paymentMethodId: string;
  amount: number;
  currency?: string;
  description: string;
  reference?: string;
  relatedLoanId?: string;
  relatedPaymentId?: string;
  transactionDate?: Date;
  notes?: string;
  attachments?: any;
  processedBy: string;
}

export interface UpdateFinancialTransactionInput {
  description?: string;
  reference?: string;
  notes?: string;
  attachments?: any;
}

export interface FinancialTransactionFilters {
  organizationId: string;
  branchId?: string;
  type?: FinancialTransactionType;
  status?: FinancialTransactionStatus;
  paymentMethodId?: string;
  incomeCategoryId?: string;
  expenseCategoryId?: string;
  startDate?: Date;
  endDate?: Date;
  search?: string;
  page?: number;
  limit?: number;
}

export interface FinancialSummary {
  totalIncome: number;
  totalExpenses: number;
  netBalance: number;
  transactionCount: number;
  incomeCount: number;
  expenseCount: number;
  balanceByPaymentMethod: {
    id: string;
    name: string;
    type: string;
    balance: number;
  }[];
  incomeByCategory: {
    id: string;
    name: string;
    total: number;
  }[];
  expensesByCategory: {
    id: string;
    name: string;
    total: number;
  }[];
}

class FinancialTransactionService {
  /**
   * Generate unique transaction number
   */
  private async generateTransactionNumber(
    organizationId: string
  ): Promise<string> {
    const count = await prisma.financialTransaction.count({
      where: { organizationId },
    });

    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const sequence = (count + 1).toString().padStart(6, '0');

    return `TXN${year}${month}${sequence}`;
  }

  /**
   * Get all financial transactions with optional filters
   */
  async getAll(filters: FinancialTransactionFilters) {
    const {
      organizationId,
      branchId,
      type,
      status,
      paymentMethodId,
      incomeCategoryId,
      expenseCategoryId,
      startDate,
      endDate,
      search,
      page = 1,
      limit = 50,
    } = filters;

    const where: Prisma.FinancialTransactionWhereInput = {
      organizationId,
    };

    if (branchId) {
      where.branchId = branchId;
    }

    if (type) {
      where.type = type;
    }

    if (status) {
      where.status = status;
    }

    if (paymentMethodId) {
      where.paymentMethodId = paymentMethodId;
    }

    if (incomeCategoryId) {
      where.incomeCategoryId = incomeCategoryId;
    }

    if (expenseCategoryId) {
      where.expenseCategoryId = expenseCategoryId;
    }

    if (startDate || endDate) {
      where.transactionDate = {};
      if (startDate) {
        where.transactionDate.gte = startDate;
      }
      if (endDate) {
        where.transactionDate.lte = endDate;
      }
    }

    if (search) {
      where.OR = [
        { transactionNumber: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { reference: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [transactions, total] = await Promise.all([
      prisma.financialTransaction.findMany({
        where,
        include: {
          paymentMethod: {
            select: { id: true, name: true, code: true, type: true },
          },
          incomeCategory: {
            select: { id: true, name: true, code: true },
          },
          expenseCategory: {
            select: { id: true, name: true, code: true },
          },
          branch: {
            select: { id: true, name: true, code: true },
          },
          processor: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          approver: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          relatedLoan: {
            select: { id: true, loanNumber: true },
          },
        },
        orderBy: { transactionDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.financialTransaction.count({ where }),
    ]);

    return {
      transactions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get a single transaction by ID
   */
  async getById(id: string, organizationId: string) {
    return prisma.financialTransaction.findFirst({
      where: { id, organizationId },
      include: {
        paymentMethod: true,
        incomeCategory: true,
        expenseCategory: true,
        branch: true,
        processor: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        approver: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        voider: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        relatedLoan: true,
      },
    });
  }

  /**
   * Get financial summary for organization
   */
  async getSummary(
    organizationId: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<FinancialSummary> {
    const dateFilter: Prisma.FinancialTransactionWhereInput = {
      organizationId,
      status: 'COMPLETED',
    };

    if (startDate || endDate) {
      dateFilter.transactionDate = {};
      if (startDate) {
        dateFilter.transactionDate.gte = startDate;
      }
      if (endDate) {
        dateFilter.transactionDate.lte = endDate;
      }
    }

    // Get totals by type
    const incomeTotal = await prisma.financialTransaction.aggregate({
      where: { ...dateFilter, type: 'INCOME' },
      _sum: { amount: true },
      _count: true,
    });

    const expenseTotal = await prisma.financialTransaction.aggregate({
      where: { ...dateFilter, type: 'EXPENSE' },
      _sum: { amount: true },
      _count: true,
    });

    // Get payment method balances
    const paymentMethods = await prisma.paymentMethod.findMany({
      where: { organizationId, isActive: true },
      select: {
        id: true,
        name: true,
        type: true,
        currentBalance: true,
      },
    });

    // Get income by category
    const incomeByCategory = await prisma.financialTransaction.groupBy({
      by: ['incomeCategoryId'],
      where: { ...dateFilter, type: 'INCOME', incomeCategoryId: { not: null } },
      _sum: { amount: true },
    });

    const incomeCategoryIds = incomeByCategory
      .map(i => i.incomeCategoryId)
      .filter(Boolean) as string[];
    const incomeCategories = await prisma.incomeCategory.findMany({
      where: { id: { in: incomeCategoryIds } },
      select: { id: true, name: true },
    });

    // Get expenses by category
    const expensesByCategory = await prisma.financialTransaction.groupBy({
      by: ['expenseCategoryId'],
      where: {
        ...dateFilter,
        type: 'EXPENSE',
        expenseCategoryId: { not: null },
      },
      _sum: { amount: true },
    });

    const expenseCategoryIds = expensesByCategory
      .map(e => e.expenseCategoryId)
      .filter(Boolean) as string[];
    const expenseCategories = await prisma.expenseCategory.findMany({
      where: { id: { in: expenseCategoryIds } },
      select: { id: true, name: true },
    });

    const totalIncome = Number(incomeTotal._sum.amount || 0);
    const totalExpenses = Number(expenseTotal._sum.amount || 0);
    const incomeCount = incomeTotal._count || 0;
    const expenseCount = expenseTotal._count || 0;

    return {
      totalIncome,
      totalExpenses,
      netBalance: totalIncome - totalExpenses,
      transactionCount: incomeCount + expenseCount,
      incomeCount,
      expenseCount,
      balanceByPaymentMethod: paymentMethods.map(pm => ({
        id: pm.id,
        name: pm.name,
        type: pm.type,
        balance: Number(pm.currentBalance),
      })),
      incomeByCategory: incomeByCategory.map(ic => {
        const category = incomeCategories.find(
          c => c.id === ic.incomeCategoryId
        );
        return {
          id: ic.incomeCategoryId!,
          name: category?.name || 'Unknown',
          total: Number(ic._sum.amount || 0),
        };
      }),
      expensesByCategory: expensesByCategory.map(ec => {
        const category = expenseCategories.find(
          c => c.id === ec.expenseCategoryId
        );
        return {
          id: ec.expenseCategoryId!,
          name: category?.name || 'Unknown',
          total: Number(ec._sum.amount || 0),
        };
      }),
    };
  }

  /**
   * Create a new financial transaction
   */
  async create(input: CreateFinancialTransactionInput) {
    const {
      organizationId,
      branchId,
      type,
      incomeCategoryId,
      expenseCategoryId,
      paymentMethodId,
      amount,
      currency = 'USD',
      description,
      reference,
      relatedLoanId,
      relatedPaymentId,
      transactionDate = new Date(),
      notes,
      attachments,
      processedBy,
    } = input;

    // Validate category based on type
    if (type === 'INCOME' && !incomeCategoryId) {
      throw new Error('Income category is required for income transactions');
    }
    if (type === 'EXPENSE' && !expenseCategoryId) {
      throw new Error('Expense category is required for expense transactions');
    }

    // Get payment method and verify it exists
    const paymentMethod = await prisma.paymentMethod.findFirst({
      where: { id: paymentMethodId, organizationId },
    });

    if (!paymentMethod) {
      throw new Error('Payment method not found');
    }

    // Calculate balance before/after
    const balanceBefore = Number(paymentMethod.currentBalance);
    const balanceAfter =
      type === 'INCOME' ? balanceBefore + amount : balanceBefore - amount;

    // Check if expense would cause negative balance (optional - could allow overdraft)
    if (type === 'EXPENSE' && balanceAfter < 0) {
      throw new Error(
        `Insufficient balance in ${paymentMethod.name}. Available: ${balanceBefore}, Required: ${amount}`
      );
    }

    // Generate transaction number
    const transactionNumber =
      await this.generateTransactionNumber(organizationId);

    // Create transaction and update balance in a transaction
    const result = await prisma.$transaction(async tx => {
      // Create the transaction record
      const transaction = await tx.financialTransaction.create({
        data: {
          organizationId,
          branchId,
          transactionNumber,
          type,
          incomeCategoryId: type === 'INCOME' ? incomeCategoryId : null,
          expenseCategoryId: type === 'EXPENSE' ? expenseCategoryId : null,
          paymentMethodId,
          amount,
          currency,
          description,
          reference,
          relatedLoanId,
          relatedPaymentId,
          transactionDate,
          balanceBefore,
          balanceAfter,
          status: 'COMPLETED',
          notes,
          attachments,
          processedBy,
        },
        include: {
          paymentMethod: true,
          incomeCategory: true,
          expenseCategory: true,
          processor: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      });

      // Update payment method balance
      await tx.paymentMethod.update({
        where: { id: paymentMethodId },
        data: { currentBalance: balanceAfter },
      });

      return transaction;
    });

    return result;
  }

  /**
   * Update a financial transaction (limited fields)
   */
  async update(
    id: string,
    organizationId: string,
    input: UpdateFinancialTransactionInput
  ) {
    const existingTransaction = await this.getById(id, organizationId);
    if (!existingTransaction) {
      throw new Error('Transaction not found');
    }

    if (existingTransaction.status === 'VOIDED') {
      throw new Error('Cannot update voided transaction');
    }

    return prisma.financialTransaction.update({
      where: { id },
      data: input,
    });
  }

  /**
   * Void a financial transaction
   */
  async void(
    id: string,
    organizationId: string,
    voidedBy: string,
    voidReason: string
  ) {
    const existingTransaction = await this.getById(id, organizationId);
    if (!existingTransaction) {
      throw new Error('Transaction not found');
    }

    if (existingTransaction.status === 'VOIDED') {
      throw new Error('Transaction is already voided');
    }

    const amount = Number(existingTransaction.amount);
    const isIncome = existingTransaction.type === 'INCOME';

    // Void transaction and reverse the balance
    return prisma.$transaction(async tx => {
      // Void the transaction
      const voidedTransaction = await tx.financialTransaction.update({
        where: { id },
        data: {
          status: 'VOIDED',
          voidedBy,
          voidedAt: new Date(),
          voidReason,
        },
      });

      // Reverse the balance on payment method
      // If it was income, subtract. If it was expense, add back.
      const paymentMethod = await tx.paymentMethod.findUnique({
        where: { id: existingTransaction.paymentMethodId },
      });

      if (paymentMethod) {
        const currentBalance = Number(paymentMethod.currentBalance);
        const newBalance = isIncome
          ? currentBalance - amount
          : currentBalance + amount;

        await tx.paymentMethod.update({
          where: { id: existingTransaction.paymentMethodId },
          data: { currentBalance: newBalance },
        });
      }

      return voidedTransaction;
    });
  }

  /**
   * Record a loan disbursement as expense
   */
  async recordLoanDisbursement(
    organizationId: string,
    branchId: string,
    loanId: string,
    loanNumber: string,
    amount: number,
    currency: string,
    paymentMethodId: string,
    processedBy: string
  ) {
    // Find the LOAN_DISBURSEMENT expense category
    const disbursementCategory = await prisma.expenseCategory.findFirst({
      where: {
        organizationId,
        code: 'LOAN_DISBURSEMENT',
      },
    });

    if (!disbursementCategory) {
      throw new Error(
        'Loan disbursement expense category not found. Please seed default categories.'
      );
    }

    return this.create({
      organizationId,
      branchId,
      type: 'EXPENSE',
      expenseCategoryId: disbursementCategory.id,
      paymentMethodId,
      amount,
      currency,
      description: `Loan disbursement for ${loanNumber}`,
      relatedLoanId: loanId,
      processedBy,
    });
  }

  /**
   * Record a loan repayment as income
   */
  async recordLoanRepayment(
    organizationId: string,
    branchId: string,
    loanId: string,
    loanNumber: string,
    paymentId: string,
    amount: number,
    currency: string,
    paymentMethodId: string,
    processedBy: string
  ) {
    // Find the LOAN_REPAYMENT income category
    const repaymentCategory = await prisma.incomeCategory.findFirst({
      where: {
        organizationId,
        code: 'LOAN_REPAYMENT',
      },
    });

    if (!repaymentCategory) {
      throw new Error(
        'Loan repayment income category not found. Please seed default categories.'
      );
    }

    return this.create({
      organizationId,
      branchId,
      type: 'INCOME',
      incomeCategoryId: repaymentCategory.id,
      paymentMethodId,
      amount,
      currency,
      description: `Loan repayment for ${loanNumber}`,
      relatedLoanId: loanId,
      relatedPaymentId: paymentId,
      processedBy,
    });
  }

  /**
   * Get balance history for a payment method
   */
  async getPaymentMethodHistory(
    paymentMethodId: string,
    organizationId: string,
    startDate?: Date,
    endDate?: Date,
    page = 1,
    limit = 50
  ) {
    const where: Prisma.FinancialTransactionWhereInput = {
      paymentMethodId,
      organizationId,
      status: 'COMPLETED',
    };

    if (startDate || endDate) {
      where.transactionDate = {};
      if (startDate) {
        where.transactionDate.gte = startDate;
      }
      if (endDate) {
        where.transactionDate.lte = endDate;
      }
    }

    const [transactions, total, paymentMethod] = await Promise.all([
      prisma.financialTransaction.findMany({
        where,
        include: {
          incomeCategory: { select: { name: true } },
          expenseCategory: { select: { name: true } },
          processor: { select: { firstName: true, lastName: true } },
        },
        orderBy: { transactionDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.financialTransaction.count({ where }),
      prisma.paymentMethod.findUnique({ where: { id: paymentMethodId } }),
    ]);

    return {
      paymentMethod,
      transactions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}

export const financialTransactionService = new FinancialTransactionService();
