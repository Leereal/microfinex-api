import { prisma } from '../config/database';
import {
  LoanCalculationMethod,
  RepaymentFrequency,
  LoanType,
  Currency,
} from '@prisma/client';
import { auditService } from './audit.service';

interface CreateLoanProductInput {
  name: string;
  description?: string;
  type?: LoanType;
  organizationId: string;
  minAmount: number;
  maxAmount: number;
  currency?: Currency;
  interestRate: number;
  interestRateFrequency?: RepaymentFrequency;
  calculationMethod?: LoanCalculationMethod;
  minTerm: number;
  maxTerm: number;
  repaymentFrequency?: RepaymentFrequency;
  gracePeriod?: number;
  penaltyRate?: number;
  requiresCollateral?: boolean;
  requiresGuarantor?: boolean;
  isOnlineEligible?: boolean;
  createdById?: string;
}

interface UpdateLoanProductInput {
  name?: string;
  description?: string;
  type?: LoanType;
  minAmount?: number;
  maxAmount?: number;
  currency?: Currency;
  interestRate?: number;
  interestRateFrequency?: RepaymentFrequency;
  calculationMethod?: LoanCalculationMethod;
  minTerm?: number;
  maxTerm?: number;
  repaymentFrequency?: RepaymentFrequency;
  gracePeriod?: number;
  penaltyRate?: number;
  requiresCollateral?: boolean;
  requiresGuarantor?: boolean;
  isOnlineEligible?: boolean;
  isActive?: boolean;
}

class LoanProductService {
  async create(input: CreateLoanProductInput, userId?: string) {
    const product = await prisma.loanProduct.create({
      data: {
        name: input.name,
        description: input.description,
        type: input.type || 'SHORT_TERM',
        organizationId: input.organizationId,
        minAmount: input.minAmount,
        maxAmount: input.maxAmount,
        currency: input.currency || 'USD',
        interestRate: input.interestRate,
        interestRateFrequency: input.interestRateFrequency || 'ANNUAL',
        calculationMethod: input.calculationMethod || 'REDUCING_BALANCE',
        minTerm: input.minTerm,
        maxTerm: input.maxTerm,
        repaymentFrequency: input.repaymentFrequency || 'MONTHLY',
        gracePeriod: input.gracePeriod || 0,
        penaltyRate: input.penaltyRate || 0,
        requiresCollateral: input.requiresCollateral || false,
        requiresGuarantor: input.requiresGuarantor || false,
        isOnlineEligible: input.isOnlineEligible || false,
        createdById: input.createdById || userId,
      },
      include: {
        createdBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    // Create audit log
    if (userId) {
      await auditService.createAuditLog({
        userId,
        organizationId: input.organizationId,
        action: 'CREATE',
        resource: 'LoanProduct',
        resourceId: product.id,
        newValue: {
          name: product.name,
          type: product.type,
          minAmount: product.minAmount.toString(),
          maxAmount: product.maxAmount.toString(),
          interestRate: product.interestRate.toString(),
        },
      });
    }

    return product;
  }

  async update(
    id: string,
    organizationId: string,
    input: UpdateLoanProductInput,
    userId?: string
  ) {
    const product = await prisma.loanProduct.findFirst({
      where: { id, organizationId },
    });

    if (!product) {
      throw new Error('Loan product not found');
    }

    const oldValues = {
      name: product.name,
      type: product.type,
      minAmount: product.minAmount.toString(),
      maxAmount: product.maxAmount.toString(),
      interestRate: product.interestRate.toString(),
      isActive: product.isActive,
    };

    const updatedProduct = await prisma.loanProduct.update({
      where: { id },
      data: input,
      include: {
        createdBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    // Create audit log
    if (userId) {
      await auditService.createAuditLog({
        userId,
        organizationId,
        action: 'UPDATE',
        resource: 'LoanProduct',
        resourceId: id,
        previousValue: oldValues,
        newValue: {
          name: updatedProduct.name,
          type: updatedProduct.type,
          minAmount: updatedProduct.minAmount.toString(),
          maxAmount: updatedProduct.maxAmount.toString(),
          interestRate: updatedProduct.interestRate.toString(),
          isActive: updatedProduct.isActive,
        },
      });
    }

    return updatedProduct;
  }

  async get(id: string, organizationId: string) {
    return prisma.loanProduct.findFirst({
      where: { id, organizationId },
      include: {
        createdBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        productCharges: {
          where: { isActive: true },
          include: {
            charge: {
              include: {
                chargeRates: true,
              },
            },
          },
        },
        _count: {
          select: { loans: true },
        },
      },
    });
  }

  async getAll(organizationId: string, options?: { isActive?: boolean }) {
    return prisma.loanProduct.findMany({
      where: {
        organizationId,
        ...(options?.isActive !== undefined && { isActive: options.isActive }),
      },
      include: {
        createdBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        productCharges: {
          where: { isActive: true },
          include: {
            charge: {
              include: {
                chargeRates: true,
              },
            },
          },
        },
        _count: {
          select: { loans: true },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async delete(id: string, organizationId: string, userId?: string) {
    const product = await prisma.loanProduct.findFirst({
      where: { id, organizationId },
      include: {
        _count: {
          select: { loans: true },
        },
      },
    });

    if (!product) {
      throw new Error('Loan product not found');
    }

    if (product._count.loans > 0) {
      throw new Error(
        `Cannot delete loan product. It is used by ${product._count.loans} loans.`
      );
    }

    const deleted = await prisma.loanProduct.delete({
      where: { id },
    });

    // Create audit log
    if (userId) {
      await auditService.createAuditLog({
        userId,
        organizationId,
        action: 'DELETE',
        resource: 'LoanProduct',
        resourceId: id,
        previousValue: {
          name: product.name,
          type: product.type,
        },
      });
    }

    return deleted;
  }

  async getProductsForLoanCalculation(organizationId: string) {
    return prisma.loanProduct.findMany({
      where: {
        organizationId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        type: true,
        minAmount: true,
        maxAmount: true,
        minTerm: true,
        maxTerm: true,
        interestRate: true,
        calculationMethod: true,
        repaymentFrequency: true,
        gracePeriod: true,
        requiresCollateral: true,
        requiresGuarantor: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  async duplicateProduct(
    id: string,
    organizationId: string,
    newName: string,
    userId?: string
  ) {
    const product = await this.get(id, organizationId);

    if (!product) {
      throw new Error('Loan product not found');
    }

    return this.create(
      {
        name: newName,
        description: product.description || undefined,
        type: product.type,
        organizationId: product.organizationId,
        minAmount: Number(product.minAmount),
        maxAmount: Number(product.maxAmount),
        currency: product.currency,
        interestRate: Number(product.interestRate),
        calculationMethod: product.calculationMethod,
        minTerm: product.minTerm,
        maxTerm: product.maxTerm,
        repaymentFrequency: product.repaymentFrequency,
        gracePeriod: product.gracePeriod,
        penaltyRate: Number(product.penaltyRate),
        requiresCollateral: product.requiresCollateral,
        requiresGuarantor: product.requiresGuarantor,
        isOnlineEligible: product.isOnlineEligible,
        createdById: userId,
      },
      userId
    );
  }
}

export const loanProductService = new LoanProductService();
