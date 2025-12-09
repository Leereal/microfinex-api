import { prisma } from '../config/database';
import {
  ChargeType,
  ChargeCalculationType,
  ChargeAppliesAt,
  Currency,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { financialTransactionService } from './financial-transaction.service';

// ============================================
// TYPES
// ============================================

export interface CreateChargeInput {
  name: string;
  code: string;
  type: ChargeType;
  calculationType?: ChargeCalculationType;
  defaultAmount?: number;
  defaultPercentage?: number;
  // Aliases that may come from older payloads/frontends
  percentageValue?: number;
  amount?: number;
  fixedAmount?: number;
  appliesAt?: ChargeAppliesAt;
  isDeductedFromPrincipal?: boolean;
  isMandatory?: boolean;
  description?: string;
  isActive?: boolean;
  rates?: {
    currency: Currency;
    amount?: number;
    percentage?: number;
    minAmount?: number;
    maxAmount?: number;
  }[];
}

export interface UpdateChargeInput {
  name?: string;
  code?: string;
  type?: ChargeType;
  calculationType?: ChargeCalculationType;
  defaultAmount?: number;
  defaultPercentage?: number;
  // Aliases that may come from older payloads/frontends
  percentageValue?: number;
  amount?: number;
  fixedAmount?: number;
  appliesAt?: ChargeAppliesAt;
  isDeductedFromPrincipal?: boolean;
  isMandatory?: boolean;
  description?: string;
  isActive?: boolean;
  rates?: {
    currency: Currency;
    amount?: number;
    percentage?: number;
    minAmount?: number;
    maxAmount?: number;
    isActive?: boolean;
  }[];
}

export interface ApplyChargeInput {
  loanId: string;
  chargeId: string;
  amount?: number; // Optional override
  appliedBy: string;
  paymentMethodId?: string; // For recording financial transaction
  notes?: string;
}

export interface ApplyDisbursementChargesInput {
  loanId: string;
  chargeIds?: string[]; // Specific charges to apply, or all mandatory if empty
  appliedBy: string;
  paymentMethodId?: string;
}

export interface CalculatedCharge {
  chargeId: string;
  chargeName: string;
  chargeCode: string;
  chargeType: ChargeType;
  calculationType: ChargeCalculationType;
  isDeductedFromPrincipal: boolean;
  isMandatory: boolean;
  baseAmount: number;
  calculatedAmount: number;
  currency: Currency;
}

// ============================================
// CHARGE SERVICE
// ============================================

class ChargeService {
  /**
   * Normalize incoming charge data by mapping legacy/alias fields
   * to the canonical Prisma column names. This prevents Prisma from
   * receiving unknown arguments (e.g., percentageValue) while still
   * accepting payloads from older or mismatched frontends.
   */
  private normalizeChargeData(
    input: Partial<CreateChargeInput | UpdateChargeInput>
  ) {
    const normalized: Partial<CreateChargeInput> = {};

    if (input.name !== undefined) normalized.name = input.name;
    if (input.code !== undefined) normalized.code = input.code;
    if (input.type !== undefined) normalized.type = input.type;
    if (input.calculationType !== undefined)
      normalized.calculationType = input.calculationType;

    const defaultPercentage =
      input.defaultPercentage !== undefined
        ? input.defaultPercentage
        : input.percentageValue;

    if (defaultPercentage !== undefined) {
      normalized.defaultPercentage = defaultPercentage;
    }

    const defaultAmount =
      input.defaultAmount ?? input.amount ?? input.fixedAmount;

    if (defaultAmount !== undefined) {
      normalized.defaultAmount = defaultAmount;
    }

    if (input.appliesAt !== undefined) normalized.appliesAt = input.appliesAt;
    if (input.isDeductedFromPrincipal !== undefined)
      normalized.isDeductedFromPrincipal = input.isDeductedFromPrincipal;
    if (input.isMandatory !== undefined)
      normalized.isMandatory = input.isMandatory;
    if (input.description !== undefined)
      normalized.description = input.description;
    if (input.isActive !== undefined) normalized.isActive = input.isActive;

    return normalized;
  }

  /**
   * Create a new charge with optional currency-specific rates
   */
  async create(
    organizationId: string,
    input: CreateChargeInput,
    userId?: string
  ) {
    const { rates, ...chargeData } = input;
    const normalized = this.normalizeChargeData(chargeData);

    const codeValue = normalized.code || chargeData.code;
    const nameValue = normalized.name || chargeData.name;
    const typeValue = normalized.type || chargeData.type;

    if (!codeValue || !nameValue || !typeValue) {
      throw new Error('Name, code, and type are required to create a charge');
    }

    return prisma.$transaction(async tx => {
      // Create the charge
      const charge = await tx.charge.create({
        data: {
          organizationId,
          name: nameValue,
          code: codeValue.toUpperCase(),
          type: typeValue,
          calculationType: normalized.calculationType || 'FIXED',
          defaultAmount: normalized.defaultAmount,
          defaultPercentage: normalized.defaultPercentage,
          appliesAt: normalized.appliesAt || 'DISBURSEMENT',
          isDeductedFromPrincipal: normalized.isDeductedFromPrincipal ?? false,
          isMandatory: normalized.isMandatory ?? false,
          description: normalized.description,
          isActive: normalized.isActive ?? true,
          createdBy: userId,
        },
      });

      // Create currency-specific rates if provided
      if (rates && rates.length > 0) {
        await tx.chargeRate.createMany({
          data: rates.map(rate => ({
            chargeId: charge.id,
            currency: rate.currency,
            amount: rate.amount,
            percentage: rate.percentage,
            minAmount: rate.minAmount,
            maxAmount: rate.maxAmount,
          })),
        });
      }

      return this.getById(charge.id);
    });
  }

  /**
   * Update a charge and its rates
   */
  async update(chargeId: string, input: UpdateChargeInput, userId?: string) {
    const { rates, ...chargeData } = input;
    const normalized = this.normalizeChargeData(chargeData);

    const updateData: Prisma.ChargeUpdateInput = {
      ...(normalized.name !== undefined && { name: normalized.name }),
      ...(normalized.code !== undefined && {
        code: normalized.code.toUpperCase(),
      }),
      ...(normalized.type !== undefined && { type: normalized.type }),
      ...(normalized.calculationType !== undefined && {
        calculationType: normalized.calculationType,
      }),
      ...(normalized.defaultAmount !== undefined && {
        defaultAmount: normalized.defaultAmount,
      }),
      ...(normalized.defaultPercentage !== undefined && {
        defaultPercentage: normalized.defaultPercentage,
      }),
      ...(normalized.appliesAt !== undefined && {
        appliesAt: normalized.appliesAt,
      }),
      ...(normalized.isDeductedFromPrincipal !== undefined && {
        isDeductedFromPrincipal: normalized.isDeductedFromPrincipal,
      }),
      ...(normalized.isMandatory !== undefined && {
        isMandatory: normalized.isMandatory,
      }),
      ...(normalized.description !== undefined && {
        description: normalized.description,
      }),
      ...(normalized.isActive !== undefined && {
        isActive: normalized.isActive,
      }),
      updatedBy: userId,
    };

    return prisma.$transaction(async tx => {
      // Update the charge
      const charge = await tx.charge.update({
        where: { id: chargeId },
        data: updateData,
      });

      // Update rates if provided
      if (rates) {
        // Delete existing rates and recreate
        await tx.chargeRate.deleteMany({
          where: { chargeId },
        });

        if (rates.length > 0) {
          await tx.chargeRate.createMany({
            data: rates.map(rate => ({
              chargeId,
              currency: rate.currency,
              amount: rate.amount,
              percentage: rate.percentage,
              minAmount: rate.minAmount,
              maxAmount: rate.maxAmount,
              isActive: rate.isActive ?? true,
            })),
          });
        }
      }

      return this.getById(chargeId);
    });
  }

  /**
   * Get a charge by ID with rates
   */
  async getById(chargeId: string) {
    return prisma.charge.findUnique({
      where: { id: chargeId },
      include: {
        chargeRates: {
          orderBy: { currency: 'asc' },
        },
        productCharges: {
          include: {
            product: {
              select: { id: true, name: true },
            },
          },
        },
      },
    });
  }

  /**
   * Get all charges for an organization
   */
  async getAll(
    organizationId: string,
    options?: {
      type?: ChargeType;
      appliesAt?: ChargeAppliesAt;
      isActive?: boolean;
      search?: string;
    }
  ) {
    const where: Prisma.ChargeWhereInput = {
      organizationId,
      ...(options?.type && { type: options.type }),
      ...(options?.appliesAt && { appliesAt: options.appliesAt }),
      ...(options?.isActive !== undefined && { isActive: options.isActive }),
      ...(options?.search && {
        OR: [
          { name: { contains: options.search, mode: 'insensitive' } },
          { description: { contains: options.search, mode: 'insensitive' } },
        ],
      }),
    };

    return prisma.charge.findMany({
      where,
      include: {
        chargeRates: {
          orderBy: { currency: 'asc' },
        },
      },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
  }

  /**
   * Get charges applicable for disbursement
   */
  async getDisbursementCharges(organizationId: string, productId?: string) {
    // Get all active disbursement charges
    const charges = await prisma.charge.findMany({
      where: {
        organizationId,
        isActive: true,
        appliesAt: 'DISBURSEMENT',
      },
      include: {
        chargeRates: true,
        productCharges: productId
          ? {
              where: { productId, isActive: true },
            }
          : false,
      },
      orderBy: { name: 'asc' },
    });

    // If productId is provided, filter to only charges linked to that product
    // or mandatory charges
    if (productId) {
      return charges.filter(
        charge =>
          charge.isMandatory ||
          (charge.productCharges && charge.productCharges.length > 0)
      );
    }

    return charges;
  }

  /**
   * Calculate charge amount for a loan
   */
  calculateChargeAmount(
    charge: {
      calculationType: ChargeCalculationType;
      defaultAmount: Prisma.Decimal | null;
      defaultPercentage: Prisma.Decimal | null;
      chargeRates: {
        currency: Currency;
        amount: Prisma.Decimal | null;
        percentage: Prisma.Decimal | null;
        minAmount: Prisma.Decimal | null;
        maxAmount: Prisma.Decimal | null;
      }[];
    },
    loanAmount: number,
    currency: Currency
  ): number {
    // Find currency-specific rate
    const currencyRate = charge.chargeRates.find(r => r.currency === currency);

    let amount = 0;

    if (charge.calculationType === 'FIXED') {
      // Use currency-specific amount or default
      if (currencyRate?.amount) {
        amount = parseFloat(currencyRate.amount.toString());
      } else if (charge.defaultAmount) {
        amount = parseFloat(charge.defaultAmount.toString());
      }
    } else {
      // PERCENTAGE or PERCENTAGE_BALANCE
      const percentage = currencyRate?.percentage || charge.defaultPercentage;
      if (percentage) {
        amount = loanAmount * parseFloat(percentage.toString());
      }

      // Apply min/max constraints for percentage calculations
      if (currencyRate?.minAmount) {
        const min = parseFloat(currencyRate.minAmount.toString());
        amount = Math.max(amount, min);
      }
      if (currencyRate?.maxAmount) {
        const max = parseFloat(currencyRate.maxAmount.toString());
        amount = Math.min(amount, max);
      }
    }

    // Round to 2 decimal places
    return Math.round(amount * 100) / 100;
  }

  /**
   * Get calculated charges for a loan (preview before applying)
   */
  async getCalculatedChargesForLoan(
    loanId: string,
    chargeIds?: string[]
  ): Promise<CalculatedCharge[]> {
    const loan = await prisma.loan.findUnique({
      where: { id: loanId },
      select: {
        id: true,
        amount: true,
        organizationId: true,
        productId: true,
        product: { select: { currency: true } },
      },
    });

    if (!loan) {
      throw new Error('Loan not found');
    }

    const loanAmount = parseFloat(loan.amount.toString());
    const currency = loan.product?.currency || 'USD';

    // Get applicable charges
    let charges;
    if (chargeIds && chargeIds.length > 0) {
      charges = await prisma.charge.findMany({
        where: {
          id: { in: chargeIds },
          organizationId: loan.organizationId,
          isActive: true,
        },
        include: { chargeRates: true },
      });
    } else {
      charges = await this.getDisbursementCharges(
        loan.organizationId,
        loan.productId || undefined
      );
    }

    return charges.map(charge => ({
      chargeId: charge.id,
      chargeName: charge.name,
      chargeCode: charge.code,
      chargeType: charge.type,
      calculationType: charge.calculationType,
      isDeductedFromPrincipal: charge.isDeductedFromPrincipal,
      isMandatory: charge.isMandatory,
      baseAmount: loanAmount,
      calculatedAmount: this.calculateChargeAmount(
        charge,
        loanAmount,
        currency
      ),
      currency,
    }));
  }

  /**
   * Apply charges to a loan during disbursement
   */
  async applyDisbursementCharges(
    input: ApplyDisbursementChargesInput
  ): Promise<{
    loanCharges: any[];
    totalCharges: number;
    deductedFromPrincipal: number;
    addedToLoan: number;
    netDisbursement: number;
  }> {
    const loan = await prisma.loan.findUnique({
      where: { id: input.loanId },
      select: {
        id: true,
        loanNumber: true,
        amount: true,
        organizationId: true,
        branchId: true,
        productId: true,
        product: { select: { currency: true } },
      },
    });

    if (!loan) {
      throw new Error('Loan not found');
    }

    const loanAmount = parseFloat(loan.amount.toString());
    const currency = loan.product?.currency || 'USD';

    // Get charges to apply
    let charges;
    if (input.chargeIds && input.chargeIds.length > 0) {
      charges = await prisma.charge.findMany({
        where: {
          id: { in: input.chargeIds },
          organizationId: loan.organizationId,
          isActive: true,
        },
        include: { chargeRates: true },
      });
    } else {
      // Apply all mandatory disbursement charges
      charges = await prisma.charge.findMany({
        where: {
          organizationId: loan.organizationId,
          isActive: true,
          appliesAt: 'DISBURSEMENT',
          isMandatory: true,
        },
        include: { chargeRates: true },
      });
    }

    const loanCharges: any[] = [];
    let totalCharges = 0;
    let deductedFromPrincipal = 0;
    let addedToLoan = 0;

    await prisma.$transaction(async tx => {
      for (const charge of charges) {
        const calculatedAmount = this.calculateChargeAmount(
          charge,
          loanAmount,
          currency
        );

        if (calculatedAmount <= 0) continue;

        // Create loan charge record
        const loanCharge = await tx.loanCharge.create({
          data: {
            loanId: input.loanId,
            chargeId: charge.id,
            chargeName: charge.name,
            chargeType: charge.type,
            calculationType: charge.calculationType,
            currency,
            baseAmount: loanAmount,
            calculatedAmount,
            amount: calculatedAmount,
            isDeductedFromPrincipal: charge.isDeductedFromPrincipal,
            status: 'COMPLETED', // Charges are applied immediately at disbursement
            appliedBy: input.appliedBy,
            paidAmount: calculatedAmount, // Considered paid at disbursement
            paidAt: new Date(),
          },
        });

        // Create financial transaction for the charge (income for the org)
        if (input.paymentMethodId) {
          const transaction = await financialTransactionService.create({
            organizationId: loan.organizationId,
            branchId: loan.branchId,
            type: 'INCOME',
            amount: calculatedAmount,
            currency,
            paymentMethodId: input.paymentMethodId,
            relatedLoanId: input.loanId,
            description: `${charge.name} for loan ${loan.loanNumber}`,
            reference: `CHG-${loanCharge.id.slice(-8).toUpperCase()}`,
            processedBy: input.appliedBy,
          });

          // Update loan charge with transaction ID
          await tx.loanCharge.update({
            where: { id: loanCharge.id },
            data: { financialTransactionId: transaction.id },
          });
        }

        loanCharges.push(loanCharge);
        totalCharges += calculatedAmount;

        if (charge.isDeductedFromPrincipal) {
          deductedFromPrincipal += calculatedAmount;
        } else {
          addedToLoan += calculatedAmount;
        }
      }
    });

    const netDisbursement = loanAmount - deductedFromPrincipal;

    return {
      loanCharges,
      totalCharges,
      deductedFromPrincipal,
      addedToLoan,
      netDisbursement,
    };
  }

  /**
   * Apply a single charge to a loan (manual application)
   */
  async applyCharge(input: ApplyChargeInput) {
    const loan = await prisma.loan.findUnique({
      where: { id: input.loanId },
      select: {
        id: true,
        loanNumber: true,
        amount: true,
        organizationId: true,
        branchId: true,
        product: { select: { currency: true } },
      },
    });

    if (!loan) {
      throw new Error('Loan not found');
    }

    const charge = await prisma.charge.findUnique({
      where: { id: input.chargeId },
      include: { chargeRates: true },
    });

    if (!charge) {
      throw new Error('Charge not found');
    }

    const loanAmount = parseFloat(loan.amount.toString());
    const currency = loan.product?.currency || 'USD';
    const calculatedAmount =
      input.amount || this.calculateChargeAmount(charge, loanAmount, currency);

    return prisma.$transaction(async tx => {
      // Create loan charge
      const loanCharge = await tx.loanCharge.create({
        data: {
          loanId: input.loanId,
          chargeId: input.chargeId,
          chargeName: charge.name,
          chargeType: charge.type,
          calculationType: charge.calculationType,
          currency,
          baseAmount: loanAmount,
          calculatedAmount,
          amount: calculatedAmount,
          isDeductedFromPrincipal: charge.isDeductedFromPrincipal,
          status: 'PENDING',
          appliedBy: input.appliedBy,
        },
      });

      // Create financial transaction if payment method provided
      if (input.paymentMethodId) {
        const transaction = await financialTransactionService.create({
          organizationId: loan.organizationId,
          branchId: loan.branchId,
          type: 'INCOME',
          amount: calculatedAmount,
          currency,
          paymentMethodId: input.paymentMethodId,
          relatedLoanId: input.loanId,
          description: `${charge.name} for loan ${loan.loanNumber}`,
          reference: `CHG-${loanCharge.id.slice(-8).toUpperCase()}`,
          processedBy: input.appliedBy,
        });

        await tx.loanCharge.update({
          where: { id: loanCharge.id },
          data: {
            financialTransactionId: transaction.id,
            status: 'COMPLETED',
            paidAmount: calculatedAmount,
            paidAt: new Date(),
          },
        });
      }

      return loanCharge;
    });
  }

  /**
   * Waive a loan charge
   */
  async waiveCharge(loanChargeId: string, waivedBy: string, reason: string) {
    return prisma.loanCharge.update({
      where: { id: loanChargeId },
      data: {
        isWaived: true,
        waivedBy,
        waivedAt: new Date(),
        waiverReason: reason,
        status: 'CANCELLED',
      },
    });
  }

  /**
   * Get loan charges for a loan
   */
  async getLoanCharges(loanId: string) {
    return prisma.loanCharge.findMany({
      where: { loanId },
      include: {
        charge: {
          select: {
            id: true,
            name: true,
            code: true,
            type: true,
          },
        },
      },
      orderBy: { appliedAt: 'desc' },
    });
  }

  /**
   * Delete a charge (soft delete by setting isActive = false)
   */
  async delete(chargeId: string, userId?: string) {
    return prisma.charge.update({
      where: { id: chargeId },
      data: {
        isActive: false,
        updatedBy: userId,
      },
    });
  }

  /**
   * Assign charges to a product
   */
  async assignToProduct(
    productId: string,
    chargeIds: string[],
    options?: {
      isMandatory?: boolean;
      customAmount?: number;
      customPercentage?: number;
    }
  ) {
    return prisma.$transaction(async tx => {
      // Remove existing assignments for these charges
      await tx.productCharge.deleteMany({
        where: {
          productId,
          chargeId: { in: chargeIds },
        },
      });

      // Create new assignments
      return tx.productCharge.createMany({
        data: chargeIds.map(chargeId => ({
          productId,
          chargeId,
          isMandatory: options?.isMandatory ?? false,
          customAmount: options?.customAmount,
          customPercentage: options?.customPercentage,
        })),
      });
    });
  }

  /**
   * Remove charges from a product
   */
  async removeFromProduct(productId: string, chargeIds: string[]) {
    return prisma.productCharge.deleteMany({
      where: {
        productId,
        chargeId: { in: chargeIds },
      },
    });
  }

  /**
   * Seed default charges for an organization
   */
  async seedDefaultCharges(organizationId: string, userId?: string) {
    const defaultCharges: CreateChargeInput[] = [
      {
        name: 'Administration Fee',
        code: 'ADMIN_FEE',
        type: 'ADMIN_FEE',
        calculationType: 'PERCENTAGE',
        defaultPercentage: 0.02, // 2%
        appliesAt: 'DISBURSEMENT',
        isDeductedFromPrincipal: true,
        isMandatory: false,
        description: 'Administrative processing fee',
      },
      {
        name: 'Application Fee',
        code: 'APP_FEE',
        type: 'APPLICATION_FEE',
        calculationType: 'FIXED',
        defaultAmount: 10,
        appliesAt: 'DISBURSEMENT',
        isDeductedFromPrincipal: true,
        isMandatory: false,
        description: 'Loan application processing fee',
      },
      {
        name: 'Processing Fee',
        code: 'PROC_FEE',
        type: 'PROCESSING_FEE',
        calculationType: 'PERCENTAGE',
        defaultPercentage: 0.01, // 1%
        appliesAt: 'DISBURSEMENT',
        isDeductedFromPrincipal: true,
        isMandatory: false,
        description: 'Loan processing fee',
      },
      {
        name: 'Service Fee',
        code: 'SVC_FEE',
        type: 'SERVICE_FEE',
        calculationType: 'FIXED',
        defaultAmount: 5,
        appliesAt: 'DISBURSEMENT',
        isDeductedFromPrincipal: false,
        isMandatory: false,
        description: 'General service fee',
      },
      {
        name: 'Legal Fee',
        code: 'LEGAL_FEE',
        type: 'LEGAL_FEE',
        calculationType: 'FIXED',
        defaultAmount: 25,
        appliesAt: 'DISBURSEMENT',
        isDeductedFromPrincipal: true,
        isMandatory: false,
        description: 'Legal documentation fee',
      },
      {
        name: 'Insurance Fee',
        code: 'INS_FEE',
        type: 'INSURANCE_FEE',
        calculationType: 'PERCENTAGE',
        defaultPercentage: 0.005, // 0.5%
        appliesAt: 'DISBURSEMENT',
        isDeductedFromPrincipal: true,
        isMandatory: false,
        description: 'Loan insurance premium',
      },
      {
        name: 'Late Payment Fee',
        code: 'LATE_FEE',
        type: 'LATE_FEE',
        calculationType: 'FIXED',
        defaultAmount: 10,
        appliesAt: 'LATE_PAYMENT',
        isDeductedFromPrincipal: false,
        isMandatory: false,
        description: 'Fee for late payment',
      },
    ];

    const created = [];
    for (const chargeData of defaultCharges) {
      try {
        const charge = await this.create(organizationId, chargeData, userId);
        created.push(charge);
      } catch (error) {
        // Skip if charge with same code already exists
        console.log(`Charge ${chargeData.code} may already exist, skipping...`);
      }
    }

    return created;
  }
}

export const chargeService = new ChargeService();
