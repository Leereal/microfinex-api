import { prisma } from '../config/database';
import { Prisma, PaymentMethodType } from '@prisma/client';

export interface CreatePaymentMethodInput {
  organizationId: string;
  name: string;
  code: string;
  type: PaymentMethodType;
  accountNumber?: string;
  description?: string;
  initialBalance?: number;
  currency?: string;
  isActive?: boolean;
  isDefault?: boolean;
  createdBy?: string;
}

export interface UpdatePaymentMethodInput {
  name?: string;
  code?: string;
  type?: PaymentMethodType;
  accountNumber?: string;
  description?: string;
  currency?: string;
  isActive?: boolean;
  isDefault?: boolean;
  updatedBy?: string;
}

export interface PaymentMethodFilters {
  organizationId: string;
  search?: string;
  type?: PaymentMethodType;
  isActive?: boolean;
  page?: number;
  limit?: number;
}

class PaymentMethodService {
  /**
   * Get all payment methods with optional filters
   */
  async getAll(filters: PaymentMethodFilters) {
    const {
      organizationId,
      search,
      type,
      isActive,
      page = 1,
      limit = 50,
    } = filters;

    const where: Prisma.PaymentMethodWhereInput = {
      organizationId,
    };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { accountNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (type) {
      where.type = type;
    }

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    const [paymentMethods, total] = await Promise.all([
      prisma.paymentMethod.findMany({
        where,
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.paymentMethod.count({ where }),
    ]);

    return {
      paymentMethods,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get a single payment method by ID
   */
  async getById(id: string, organizationId: string) {
    return prisma.paymentMethod.findFirst({
      where: { id, organizationId },
    });
  }

  /**
   * Get a single payment method by code within an organization
   */
  async getByCode(code: string, organizationId: string) {
    return prisma.paymentMethod.findFirst({
      where: {
        code: code.toUpperCase(),
        organizationId,
      },
    });
  }

  /**
   * Get the default payment method for an organization
   */
  async getDefault(organizationId: string) {
    return prisma.paymentMethod.findFirst({
      where: { organizationId, isDefault: true, isActive: true },
    });
  }

  /**
   * Get all active payment methods (for dropdowns)
   */
  async getActive(organizationId: string) {
    return prisma.paymentMethod.findMany({
      where: { organizationId, isActive: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  /**
   * Get payment method balances summary
   */
  async getBalancesSummary(organizationId: string) {
    const paymentMethods = await prisma.paymentMethod.findMany({
      where: { organizationId, isActive: true },
      select: {
        id: true,
        name: true,
        code: true,
        type: true,
        currentBalance: true,
        currency: true,
      },
      orderBy: { name: 'asc' },
    });

    const totalBalance = paymentMethods.reduce(
      (sum, pm) => sum + Number(pm.currentBalance),
      0
    );

    return {
      paymentMethods,
      totalBalance,
    };
  }

  /**
   * Create a new payment method
   */
  async create(input: CreatePaymentMethodInput) {
    const {
      organizationId,
      name,
      code,
      type,
      accountNumber,
      description,
      initialBalance = 0,
      currency = 'USD',
      isActive = true,
      isDefault = false,
      createdBy,
    } = input;

    // Normalize code to uppercase
    const normalizedCode = code.toUpperCase();

    // Check for duplicate code within organization
    const existing = await prisma.paymentMethod.findFirst({
      where: {
        code: normalizedCode,
        organizationId,
      },
    });

    if (existing) {
      throw new Error(
        `Payment method with code "${normalizedCode}" already exists`
      );
    }

    // If setting as default, unset any existing default for this organization
    if (isDefault) {
      await prisma.paymentMethod.updateMany({
        where: { organizationId, isDefault: true },
        data: { isDefault: false },
      });
    }

    return prisma.paymentMethod.create({
      data: {
        organizationId,
        name,
        code: normalizedCode,
        type,
        accountNumber,
        description,
        initialBalance,
        currentBalance: initialBalance,
        currency,
        isActive,
        isDefault,
        createdBy,
      },
    });
  }

  /**
   * Update a payment method
   */
  async update(
    id: string,
    organizationId: string,
    input: UpdatePaymentMethodInput
  ) {
    const existingMethod = await this.getById(id, organizationId);
    if (!existingMethod) {
      throw new Error('Payment method not found');
    }

    const { code, isDefault, ...rest } = input;

    // Check for duplicate code if changing
    if (code && code.toUpperCase() !== existingMethod.code) {
      const duplicate = await prisma.paymentMethod.findFirst({
        where: {
          code: code.toUpperCase(),
          organizationId,
          NOT: { id },
        },
      });

      if (duplicate) {
        throw new Error(
          `Payment method with code "${code.toUpperCase()}" already exists`
        );
      }
    }

    // If setting as default, unset any existing default
    if (isDefault === true) {
      await prisma.paymentMethod.updateMany({
        where: { organizationId, isDefault: true, NOT: { id } },
        data: { isDefault: false },
      });
    }

    return prisma.paymentMethod.update({
      where: { id },
      data: {
        ...rest,
        code: code ? code.toUpperCase() : undefined,
        isDefault,
      },
    });
  }

  /**
   * Delete a payment method
   */
  async delete(id: string, organizationId: string) {
    const existingMethod = await this.getById(id, organizationId);
    if (!existingMethod) {
      throw new Error('Payment method not found');
    }

    // Check if payment method has transactions
    const transactionCount = await prisma.financialTransaction.count({
      where: { paymentMethodId: id },
    });

    if (transactionCount > 0) {
      throw new Error(
        `Cannot delete payment method. It has ${transactionCount} associated transactions. Deactivate it instead.`
      );
    }

    return prisma.paymentMethod.delete({
      where: { id },
    });
  }

  /**
   * Update payment method balance
   * This is called internally when financial transactions are processed
   */
  async updateBalance(
    id: string,
    amount: number,
    isIncome: boolean,
    tx?: Prisma.TransactionClient
  ) {
    const client = tx || prisma;

    const paymentMethod = await client.paymentMethod.findUnique({
      where: { id },
    });

    if (!paymentMethod) {
      throw new Error('Payment method not found');
    }

    const currentBalance = Number(paymentMethod.currentBalance);
    const newBalance = isIncome
      ? currentBalance + amount
      : currentBalance - amount;

    return client.paymentMethod.update({
      where: { id },
      data: { currentBalance: newBalance },
    });
  }

  /**
   * Seed default payment methods for a new organization
   */
  async seedDefaults(organizationId: string, createdBy?: string) {
    const defaults = [
      {
        name: 'Cash',
        code: 'CASH',
        type: 'CASH' as PaymentMethodType,
        isDefault: true,
      },
      {
        name: 'Bank Transfer',
        code: 'BANK',
        type: 'BANK_TRANSFER' as PaymentMethodType,
      },
      {
        name: 'EcoCash',
        code: 'ECOCASH',
        type: 'MOBILE_MONEY' as PaymentMethodType,
      },
      {
        name: 'OneMoney',
        code: 'ONEMONEY',
        type: 'MOBILE_MONEY' as PaymentMethodType,
      },
      {
        name: 'InnBucks',
        code: 'INNBUCKS',
        type: 'MOBILE_MONEY' as PaymentMethodType,
      },
    ];

    const results = [];
    for (const method of defaults) {
      try {
        const created = await this.create({
          organizationId,
          ...method,
          createdBy,
        });
        results.push(created);
      } catch (error) {
        // Skip if already exists
        console.log(`Skipping ${method.name}: ${error}`);
      }
    }

    return results;
  }

  /**
   * Transfer funds between payment methods
   */
  async transferFunds(
    organizationId: string,
    fromPaymentMethodId: string,
    toPaymentMethodId: string,
    amount: number,
    description: string,
    processedBy?: string
  ) {
    // Validate both payment methods exist and belong to the organization
    const [fromMethod, toMethod] = await Promise.all([
      this.getById(fromPaymentMethodId, organizationId),
      this.getById(toPaymentMethodId, organizationId),
    ]);

    if (!fromMethod) {
      throw new Error('Source payment method not found');
    }

    if (!toMethod) {
      throw new Error('Destination payment method not found');
    }

    if (!fromMethod.isActive) {
      throw new Error('Source payment method is not active');
    }

    if (!toMethod.isActive) {
      throw new Error('Destination payment method is not active');
    }

    const fromBalance = Number(fromMethod.currentBalance);
    if (fromBalance < amount) {
      throw new Error(
        `Insufficient balance. Available: ${fromBalance}, Requested: ${amount}`
      );
    }

    // Perform the transfer in a transaction
    return prisma.$transaction(async tx => {
      // Deduct from source
      const updatedFrom = await tx.paymentMethod.update({
        where: { id: fromPaymentMethodId },
        data: { currentBalance: { decrement: amount } },
      });

      // Add to destination
      const updatedTo = await tx.paymentMethod.update({
        where: { id: toPaymentMethodId },
        data: { currentBalance: { increment: amount } },
      });

      // Create transfer record in financial transactions (as internal transfer)
      const transferRecord = await tx.financialTransaction.create({
        data: {
          organizationId,
          type: 'EXPENSE', // Debit from source
          paymentMethodId: fromPaymentMethodId,
          amount,
          currency: fromMethod.currency,
          description: `Transfer to ${toMethod.name}: ${description}`,
          status: 'COMPLETED',
          processedBy,
          transactionNumber: `TRF-${Date.now()}`,
          balanceBefore: fromBalance,
          balanceAfter: Number(updatedFrom.currentBalance),
        },
      });

      return {
        success: true,
        fromPaymentMethod: updatedFrom,
        toPaymentMethod: updatedTo,
        transferRecord,
        amount,
        description,
      };
    });
  }

  /**
   * Adjust the balance of a payment method manually
   * Used for corrections, initial funding, or adjustments
   */
  async adjustBalance(
    id: string,
    organizationId: string,
    amount: number,
    type: 'credit' | 'debit',
    reason: string,
    processedBy?: string
  ) {
    const paymentMethod = await this.getById(id, organizationId);

    if (!paymentMethod) {
      throw new Error('Payment method not found');
    }

    if (!paymentMethod.isActive) {
      throw new Error('Cannot adjust balance of inactive payment method');
    }

    const currentBalance = Number(paymentMethod.currentBalance);
    const adjustmentAmount = type === 'credit' ? amount : -amount;
    const newBalance = currentBalance + adjustmentAmount;

    if (newBalance < 0) {
      throw new Error(
        `Adjustment would result in negative balance. Current: ${currentBalance}, Adjustment: ${adjustmentAmount}`
      );
    }

    // Perform the adjustment in a transaction
    return prisma.$transaction(async tx => {
      // Update the payment method balance
      const updatedPaymentMethod = await tx.paymentMethod.update({
        where: { id },
        data: { currentBalance: newBalance },
      });

      // Create a financial transaction record for audit trail
      const transactionRecord = await tx.financialTransaction.create({
        data: {
          organizationId,
          type: type === 'credit' ? 'INCOME' : 'EXPENSE',
          paymentMethodId: id,
          amount,
          currency: paymentMethod.currency,
          description: `Balance adjustment (${type}): ${reason}`,
          status: 'COMPLETED',
          processedBy,
          transactionNumber: `ADJ-${Date.now()}`,
          balanceBefore: currentBalance,
          balanceAfter: newBalance,
        },
      });

      return {
        paymentMethod: updatedPaymentMethod,
        adjustment: {
          type,
          amount,
          reason,
          balanceBefore: currentBalance,
          balanceAfter: newBalance,
        },
        transactionRecord,
      };
    });
  }

  /**
   * Get statistics for all payment methods
   */
  async getStats(organizationId: string) {
    const paymentMethods = await prisma.paymentMethod.findMany({
      where: { organizationId },
      include: {
        _count: {
          select: { transactions: true },
        },
      },
    });

    const totalMethods = paymentMethods.length;
    const activeMethods = paymentMethods.filter(pm => pm.isActive).length;
    const inactiveMethods = totalMethods - activeMethods;

    const totalBalance = paymentMethods.reduce(
      (sum, pm) => sum + Number(pm.currentBalance),
      0
    );

    const balanceByType: Record<string, number> = {};
    const countByType: Record<string, number> = {};

    paymentMethods.forEach(pm => {
      balanceByType[pm.type] =
        (balanceByType[pm.type] || 0) + Number(pm.currentBalance);
      countByType[pm.type] = (countByType[pm.type] || 0) + 1;
    });

    const totalTransactions = paymentMethods.reduce(
      (sum, pm) => sum + pm._count.transactions,
      0
    );

    return {
      totalMethods,
      activeMethods,
      inactiveMethods,
      totalBalance,
      totalTransactions,
      balanceByType,
      countByType,
      methodDetails: paymentMethods.map(pm => ({
        id: pm.id,
        name: pm.name,
        code: pm.code,
        type: pm.type,
        currentBalance: Number(pm.currentBalance),
        currency: pm.currency,
        isActive: pm.isActive,
        isDefault: pm.isDefault,
        transactionCount: pm._count.transactions,
      })),
    };
  }
}

export const paymentMethodService = new PaymentMethodService();
