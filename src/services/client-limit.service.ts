import { Prisma, Currency } from '@prisma/client';
import { prisma } from '../config/database';
const Decimal = Prisma.Decimal;

export interface ClientLimitRecord {
  id: string;
  clientId: string;
  maxAmount: number;
  availableBalance: number;
  currency: Currency;
  usedAmount: number;
  enforceLimit: boolean;
  isActive: boolean;
  validFrom: Date;
  validTo?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

class ClientLimitService {
  /**
   * Get active client limit for a specific currency
   */
  async getActiveLimit(
    clientId: string,
    currency: Currency
  ): Promise<ClientLimitRecord | null> {
    const limit = await prisma.clientLimit.findFirst({
      where: {
        clientId,
        currency,
        isActive: true,
        validFrom: { lte: new Date() },
        OR: [{ validTo: null }, { validTo: { gte: new Date() } }],
      },
    });

    return limit ? this.mapToRecord(limit) : null;
  }

  /**
   * Get all active limits for a client
   */
  async getClientLimits(clientId: string): Promise<ClientLimitRecord[]> {
    const limits = await prisma.clientLimit.findMany({
      where: {
        clientId,
        isActive: true,
        validFrom: { lte: new Date() },
        OR: [{ validTo: null }, { validTo: { gte: new Date() } }],
      },
    });

    return limits.map(limit => this.mapToRecord(limit));
  }

  /**
   * Create or update client limit
   * When creating, availableBalance defaults to maxAmount
   */
  async upsertLimit(
    clientId: string,
    data: {
      maxAmount: number;
      currency: Currency;
      enforceLimit?: boolean;
      isActive?: boolean;
      validFrom?: Date;
      validTo?: Date | null;
    }
  ): Promise<ClientLimitRecord> {
    // Check if a limit already exists for this client and currency
    const existingLimit = await prisma.clientLimit.findFirst({
      where: {
        clientId,
        currency: data.currency,
        isActive: true,
      },
    });

    if (existingLimit) {
      // Update existing limit
      const limit = await prisma.clientLimit.update({
        where: { id: existingLimit.id },
        data: {
          maxAmount: data.maxAmount,
          // Recalculate availableBalance based on new max and used amount
          availableBalance: Math.max(
            0,
            data.maxAmount - parseFloat(existingLimit.usedAmount.toString())
          ),
          enforceLimit: data.enforceLimit ?? existingLimit.enforceLimit,
          isActive: data.isActive ?? existingLimit.isActive,
          validFrom: data.validFrom ?? existingLimit.validFrom,
          validTo:
            data.validTo !== undefined ? data.validTo : existingLimit.validTo,
        },
      });
      return this.mapToRecord(limit);
    } else {
      // Create new limit - availableBalance equals maxAmount initially
      const limit = await prisma.clientLimit.create({
        data: {
          clientId,
          maxAmount: data.maxAmount,
          availableBalance: data.maxAmount, // Full amount available initially
          currency: data.currency,
          usedAmount: 0,
          enforceLimit: data.enforceLimit ?? false,
          isActive: data.isActive ?? true,
          validFrom: data.validFrom ?? new Date(),
          validTo: data.validTo,
        },
      });
      return this.mapToRecord(limit);
    }
  }

  /**
   * Reduce available balance when a loan is disbursed
   * Also increases usedAmount
   */
  async reduceAvailableBalance(
    clientId: string,
    currency: Currency,
    amount: number,
    loanId?: string
  ): Promise<{ success: boolean; newBalance?: number; error?: string }> {
    const limit = await this.getActiveLimit(clientId, currency);

    if (!limit) {
      // No limit exists, nothing to reduce
      return { success: true };
    }

    if (limit.enforceLimit && limit.availableBalance < amount) {
      return {
        success: false,
        error: `Insufficient credit limit. Available: ${limit.availableBalance}, Required: ${amount}`,
      };
    }

    const newAvailableBalance = Math.max(0, limit.availableBalance - amount);
    const newUsedAmount = limit.usedAmount + amount;

    await prisma.clientLimit.update({
      where: { id: limit.id },
      data: {
        availableBalance: newAvailableBalance,
        usedAmount: newUsedAmount,
      },
    });

    console.log(
      `[ClientLimit] Reduced available balance for client ${clientId}: ${limit.availableBalance} -> ${newAvailableBalance} (Loan: ${loanId || 'N/A'})`
    );

    return { success: true, newBalance: newAvailableBalance };
  }

  /**
   * Increase available balance when a loan is fully repaid or cancelled
   * Also decreases usedAmount
   */
  async increaseAvailableBalance(
    clientId: string,
    currency: Currency,
    amount: number,
    reason: 'REPAYMENT' | 'CANCELLATION',
    loanId?: string
  ): Promise<{ success: boolean; newBalance?: number; error?: string }> {
    const limit = await this.getActiveLimit(clientId, currency);

    if (!limit) {
      // No limit exists, nothing to increase
      return { success: true };
    }

    // Don't let available balance exceed max amount
    const newAvailableBalance = Math.min(
      limit.maxAmount,
      limit.availableBalance + amount
    );
    const newUsedAmount = Math.max(0, limit.usedAmount - amount);

    await prisma.clientLimit.update({
      where: { id: limit.id },
      data: {
        availableBalance: newAvailableBalance,
        usedAmount: newUsedAmount,
      },
    });

    console.log(
      `[ClientLimit] Increased available balance for client ${clientId}: ${limit.availableBalance} -> ${newAvailableBalance} (Reason: ${reason}, Loan: ${loanId || 'N/A'})`
    );

    return { success: true, newBalance: newAvailableBalance };
  }

  /**
   * Check if client has sufficient limit for a loan
   */
  async checkLimitForLoan(
    clientId: string,
    currency: Currency,
    loanAmount: number
  ): Promise<{
    hasLimit: boolean;
    isEnforced: boolean;
    availableBalance: number;
    isWithinLimit: boolean;
  }> {
    const limit = await this.getActiveLimit(clientId, currency);

    if (!limit) {
      return {
        hasLimit: false,
        isEnforced: false,
        availableBalance: 0,
        isWithinLimit: true, // No limit means no restriction
      };
    }

    return {
      hasLimit: true,
      isEnforced: limit.enforceLimit,
      availableBalance: limit.availableBalance,
      isWithinLimit: limit.availableBalance >= loanAmount,
    };
  }

  /**
   * Map database record to service record
   */
  private mapToRecord(limit: any): ClientLimitRecord {
    return {
      id: limit.id,
      clientId: limit.clientId,
      maxAmount: parseFloat(limit.maxAmount.toString()),
      availableBalance: parseFloat(limit.availableBalance.toString()),
      currency: limit.currency,
      usedAmount: parseFloat(limit.usedAmount.toString()),
      enforceLimit: limit.enforceLimit,
      isActive: limit.isActive,
      validFrom: limit.validFrom,
      validTo: limit.validTo,
      createdAt: limit.createdAt,
      updatedAt: limit.updatedAt,
    };
  }
}

export const clientLimitService = new ClientLimitService();
