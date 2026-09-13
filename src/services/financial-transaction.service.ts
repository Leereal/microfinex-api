import { prisma } from '../config/database';
import {
  Prisma,
  FinancialTransactionType,
  FinancialTransactionStatus,
} from '@prisma/client';
import { paymentMethodService } from './payment-method.service';
import { toMoney, roundMoney } from '../utils/money';

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

export interface CurrencySummary {
  currency: string;
  totalIncome: number;
  totalExpenses: number;
  netBalance: number;
  incomeCount: number;
  expenseCount: number;
}

export interface FinancialSummary {
  /**
   * Amounts live in byCurrency only. A totalIncome/totalExpenses/netBalance
   * triple used to sit here, summed across every currency - the figure the
   * dashboard showed, and one that added USD to ZiG.
   */
  transactionCount: number;
  incomeCount: number;
  expenseCount: number;
  byCurrency: CurrencySummary[];
  balanceByPaymentMethod: {
    id: string;
    name: string;
    type: string;
    currency: string;
    balance: number;
  }[];
  incomeByCategory: {
    id: string;
    name: string;
    currency: string;
    total: number;
  }[];
  expensesByCategory: {
    id: string;
    name: string;
    currency: string;
    total: number;
  }[];
}

class FinancialTransactionService {
  /**
   * Generate unique transaction number
   */
  private async generateTransactionNumber(
    organizationId: string,
    client: Prisma.TransactionClient | typeof prisma = prisma
  ): Promise<string> {
    const count = await client.financialTransaction.count({
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

    // Get totals by type and currency
    const incomeByCurrency = await prisma.financialTransaction.groupBy({
      by: ['currency'],
      where: { ...dateFilter, type: 'INCOME' },
      _sum: { amount: true },
      _count: true,
    });

    const expenseByCurrency = await prisma.financialTransaction.groupBy({
      by: ['currency'],
      where: { ...dateFilter, type: 'EXPENSE' },
      _sum: { amount: true },
      _count: true,
    });

    // Build currency summary
    const currencyMap = new Map<string, CurrencySummary>();

    for (const income of incomeByCurrency) {
      const currency = income.currency || 'USD';
      if (!currencyMap.has(currency)) {
        currencyMap.set(currency, {
          currency,
          totalIncome: 0,
          totalExpenses: 0,
          netBalance: 0,
          incomeCount: 0,
          expenseCount: 0,
        });
      }
      const summary = currencyMap.get(currency)!;
      summary.totalIncome = Number(income._sum.amount || 0);
      summary.incomeCount = income._count || 0;
    }

    for (const expense of expenseByCurrency) {
      const currency = expense.currency || 'USD';
      if (!currencyMap.has(currency)) {
        currencyMap.set(currency, {
          currency,
          totalIncome: 0,
          totalExpenses: 0,
          netBalance: 0,
          incomeCount: 0,
          expenseCount: 0,
        });
      }
      const summary = currencyMap.get(currency)!;
      summary.totalExpenses = Number(expense._sum.amount || 0);
      summary.expenseCount = expense._count || 0;
    }

    // Calculate net balance for each currency
    for (const summary of currencyMap.values()) {
      summary.netBalance = summary.totalIncome - summary.totalExpenses;
    }

    const byCurrency = Array.from(currencyMap.values()).sort((a, b) =>
      a.currency.localeCompare(b.currency)
    );

    // Counts add across currencies; amounts do not. There used to be a
    // totalIncome/totalExpenses pair here summing USD, ZAR and ZiG into one
    // figure "for backwards compatibility" - it was the number the dashboard
    // displayed, and it meant nothing. Callers read byCurrency instead.
    const incomeCount = byCurrency.reduce((sum, c) => sum + c.incomeCount, 0);
    const expenseCount = byCurrency.reduce((sum, c) => sum + c.expenseCount, 0);

    // Get payment method balances with currency
    const paymentMethods = await prisma.paymentMethod.findMany({
      where: { organizationId, isActive: true },
      select: {
        id: true,
        name: true,
        type: true,
        currency: true,
        currentBalance: true,
      },
    });

    // Get income by category and currency
    const incomeByCategory = await prisma.financialTransaction.groupBy({
      by: ['incomeCategoryId', 'currency'],
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

    // Get expenses by category and currency
    const expensesByCategory = await prisma.financialTransaction.groupBy({
      by: ['expenseCategoryId', 'currency'],
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

    return {
      transactionCount: incomeCount + expenseCount,
      incomeCount,
      expenseCount,
      byCurrency,
      balanceByPaymentMethod: paymentMethods.map(pm => ({
        id: pm.id,
        name: pm.name,
        type: pm.type,
        currency: pm.currency || 'USD',
        balance: Number(pm.currentBalance),
      })),
      incomeByCategory: incomeByCategory.map(ic => {
        const category = incomeCategories.find(
          c => c.id === ic.incomeCategoryId
        );
        return {
          id: ic.incomeCategoryId!,
          name: category?.name || 'Unknown',
          currency: ic.currency || 'USD',
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
          currency: ec.currency || 'USD',
          total: Number(ec._sum.amount || 0),
        };
      }),
    };
  }

  /**
   * Create a new financial transaction.
   *
   * Pass `client` to enlist in a caller's transaction so the ledger entry and
   * whatever prompted it (a loan repayment, say) commit or roll back together.
   * Without it the write runs in its own transaction as before.
   */
  async create(
    input: CreateFinancialTransactionInput,
    client?: Prisma.TransactionClient
  ) {
    if (client) {
      return this.createWithin(client, input);
    }
    return prisma.$transaction(tx => this.createWithin(tx, input));
  }

  private async createWithin(
    tx: Prisma.TransactionClient,
    input: CreateFinancialTransactionInput
  ) {
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
    const paymentMethod = await tx.paymentMethod.findFirst({
      where: { id: paymentMethodId, organizationId },
    });

    if (!paymentMethod) {
      throw new Error('Payment method not found');
    }

    // Calculate balance before/after using decimal arithmetic - float rounding
    // here would slowly drift every payment method's recorded balance.
    const balanceBefore = toMoney(paymentMethod.currentBalance);
    const movement = toMoney(amount);
    const balanceAfter = roundMoney(
      type === 'INCOME'
        ? balanceBefore.add(movement)
        : balanceBefore.sub(movement)
    );

    // Check if expense would cause negative balance (optional - could allow overdraft)
    if (type === 'EXPENSE' && balanceAfter.lt(0)) {
      throw new Error(
        `Insufficient balance in ${paymentMethod.name}. Available: ${balanceBefore.toFixed(2)}, Required: ${movement.toFixed(2)}`
      );
    }

    // Generate transaction number
    const transactionNumber = await this.generateTransactionNumber(
      organizationId,
      tx
    );

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
   * Record multiple loan repayment transactions - one for each category (penalty, interest, principal)
   * This creates separate FinancialTransaction records for each component
   */
  async recordLoanRepaymentComponents(
    organizationId: string,
    branchId: string,
    loanId: string,
    loanNumber: string,
    paymentId: string,
    components: {
      penaltyAmount: number;
      interestAmount: number;
      principalAmount: number;
    },
    currency: string,
    paymentMethodId: string,
    processedBy: string,
    client?: Prisma.TransactionClient
  ): Promise<{ penalty?: any; interest?: any; principal?: any }> {
    const results: { penalty?: any; interest?: any; principal?: any } = {};
    const db = client ?? prisma;

    const components_: Array<{
      key: 'penalty' | 'interest' | 'principal';
      amount: number;
      code: string;
      label: string;
    }> = [
      {
        key: 'penalty',
        amount: components.penaltyAmount,
        code: 'PENALTY_INCOME',
        label: 'Penalty payment',
      },
      {
        key: 'interest',
        amount: components.interestAmount,
        code: 'INTEREST_INCOME',
        label: 'Interest payment',
      },
      {
        key: 'principal',
        amount: components.principalAmount,
        code: 'LOAN_REPAYMENT',
        label: 'Principal repayment',
      },
    ];

    /**
     * Written as one batch rather than three passes.
     *
     * Each component used to be created on its own, and each creation looked up
     * its income category, re-read the payment method, counted every
     * transaction in the organization to derive a number, wrote the row with
     * four joins attached, then updated the payment method balance. Five round
     * trips each, fifteen in all - and against a hosted database at roughly
     * 300ms a query that alone is most of a five-second transaction budget,
     * which is why recording a repayment timed out.
     *
     * The same work needs one read of the categories, one of the payment
     * method, one count, one insert and one balance update. The balances are
     * chained locally so each row still records what the payment method held
     * before and after it.
     */
    const payable = components_.filter(component => component.amount > 0);
    if (payable.length === 0) return results;

    const categories = await db.incomeCategory.findMany({
      where: {
        organizationId,
        code: { in: payable.map(component => component.code) },
      },
      select: { id: true, code: true },
    });

    const categoryByCode = new Map(
      categories.map(category => [category.code, category.id])
    );

    const billable = payable.filter(component =>
      categoryByCode.has(component.code)
    );
    if (billable.length === 0) return results;

    const paymentMethod = await db.paymentMethod.findFirst({
      where: { id: paymentMethodId, organizationId },
      select: { id: true, currentBalance: true },
    });

    if (!paymentMethod) {
      throw new Error('Payment method not found');
    }

    // One count for the batch; the rows that follow take consecutive numbers.
    const existingCount = await db.financialTransaction.count({
      where: { organizationId },
    });

    const date = new Date();
    const prefix = `TXN${date.getFullYear().toString().slice(-2)}${(
      date.getMonth() + 1
    )
      .toString()
      .padStart(2, '0')}`;

    let running = toMoney(paymentMethod.currentBalance);
    const rows = billable.map((component, index) => {
      const before = running;
      running = roundMoney(before.add(toMoney(component.amount)));

      return {
        organizationId,
        branchId,
        transactionNumber: `${prefix}${(existingCount + index + 1)
          .toString()
          .padStart(6, '0')}`,
        type: 'INCOME' as const,
        incomeCategoryId: categoryByCode.get(component.code)!,
        paymentMethodId,
        amount: component.amount,
        currency: currency as any,
        description: `${component.label} for loan ${loanNumber}`,
        relatedLoanId: loanId,
        relatedPaymentId: paymentId,
        transactionDate: date,
        balanceBefore: before,
        balanceAfter: running,
        status: 'COMPLETED' as const,
        processedBy,
      };
    });

    await db.financialTransaction.createMany({ data: rows });

    await db.paymentMethod.update({
      where: { id: paymentMethodId },
      data: { currentBalance: running },
    });

    billable.forEach((component, index) => {
      results[component.key] = rows[index];
    });

    return results;
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
      // Scoped to the organization: findUnique on the id alone would return a
      // payment method belonging to somebody else. The transaction query is
      // already scoped, so only this object was exposed, but it carries the
      // name, account number and balance.
      prisma.paymentMethod.findFirst({
        where: { id: paymentMethodId, organizationId },
      }),
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

  /**
   * Void all financial transactions associated with a payment
   * Used when reversing/cancelling a payment to maintain ledger consistency
   */
  async voidByPaymentId(
    paymentId: string,
    voidedBy: string,
    reason?: string,
    client?: Prisma.TransactionClient
  ): Promise<{ voidedCount: number; restoredAmount: number }> {
    const db = client ?? prisma;

    // Find all transactions linked to this payment
    const transactions = await db.financialTransaction.findMany({
      where: {
        relatedPaymentId: paymentId,
        status: 'COMPLETED',
      },
      include: {
        paymentMethod: true,
      },
    });

    if (transactions.length === 0) {
      return { voidedCount: 0, restoredAmount: 0 };
    }

    let totalRestoredAmount = toMoney(0);

    // Void each transaction and reverse the balance change
    for (const transaction of transactions) {
      const amount = toMoney(transaction.amount);

      // Update transaction status to VOIDED
      await db.financialTransaction.update({
        where: { id: transaction.id },
        data: {
          status: 'VOIDED',
          notes: `${transaction.notes || ''}\n\nVOIDED by ${voidedBy}: ${reason || 'Payment reversal'}`,
        },
      });

      // Reverse the balance change on the payment method
      // INCOME transactions increased the balance, so we decrease it
      // EXPENSE transactions decreased the balance, so we increase it
      if (transaction.paymentMethodId) {
        const balanceAdjustment =
          transaction.type === 'INCOME' ? amount.negated() : amount;

        await paymentMethodService.adjustBalanceInternal(
          transaction.paymentMethodId,
          balanceAdjustment.toNumber(),
          `Reversal of transaction ${transaction.transactionNumber} - ${reason || 'Payment voided'}`,
          client
        );

        totalRestoredAmount = totalRestoredAmount.add(balanceAdjustment.abs());
      }
    }

    return {
      voidedCount: transactions.length,
      restoredAmount: totalRestoredAmount.toNumber(),
    };
  }

  /**
   * Void all financial transactions associated with a loan disbursement
   * Used when cancelling/reversing a loan disbursement
   */
  async voidByLoanId(
    loanId: string,
    transactionType: 'DISBURSEMENT' | 'ALL',
    voidedBy: string,
    reason?: string
  ): Promise<{ voidedCount: number; restoredAmount: number }> {
    const where: Prisma.FinancialTransactionWhereInput = {
      relatedLoanId: loanId,
      status: 'COMPLETED',
    };

    // If only voiding disbursement, filter by EXPENSE type (disbursements are expenses)
    if (transactionType === 'DISBURSEMENT') {
      where.type = 'EXPENSE';
    }

    const transactions = await prisma.financialTransaction.findMany({
      where,
      include: {
        paymentMethod: true,
      },
    });

    if (transactions.length === 0) {
      return { voidedCount: 0, restoredAmount: 0 };
    }

    let totalRestoredAmount = 0;

    for (const transaction of transactions) {
      const amount = parseFloat(transaction.amount.toString());

      await prisma.financialTransaction.update({
        where: { id: transaction.id },
        data: {
          status: 'VOIDED',
          notes: `${transaction.notes || ''}\n\nVOIDED by ${voidedBy}: ${reason || 'Loan reversal'}`,
        },
      });

      if (transaction.paymentMethodId) {
        const balanceAdjustment =
          transaction.type === 'INCOME' ? -amount : amount;

        await paymentMethodService.adjustBalanceInternal(
          transaction.paymentMethodId,
          balanceAdjustment,
          `Reversal of transaction ${transaction.transactionNumber} - ${reason || 'Loan voided'}`
        );

        totalRestoredAmount += Math.abs(balanceAdjustment);
      }
    }

    return {
      voidedCount: transactions.length,
      restoredAmount: totalRestoredAmount,
    };
  }
}

export const financialTransactionService = new FinancialTransactionService();
