import { prisma } from '../config/database';
import {
  LoanCalculationMethod,
  RepaymentFrequency,
  LoanType,
  Currency,
} from '@prisma/client';

interface CreateLoanProductInput {
  name: string;
  description?: string;
  type?: LoanType;
  organizationId: string;
  categoryId?: string;
  minAmount: number;
  maxAmount: number;
  currency?: Currency;
  interestRate: number;
  calculationMethod?: LoanCalculationMethod;
  minTerm: number;
  maxTerm: number;
  repaymentFrequency?: RepaymentFrequency;
  gracePeriod?: number;
  penaltyRate?: number;
  requiresCollateral?: boolean;
  requiresGuarantor?: boolean;
  isOnlineEligible?: boolean;
}

interface UpdateLoanProductInput {
  name?: string;
  description?: string;
  type?: LoanType;
  categoryId?: string;
  minAmount?: number;
  maxAmount?: number;
  currency?: Currency;
  interestRate?: number;
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
  async create(input: CreateLoanProductInput) {
    // Verify category exists if provided
    if (input.categoryId) {
      const category = await prisma.loanCategory.findFirst({
        where: {
          id: input.categoryId,
          organizationId: input.organizationId,
        },
      });

      if (!category) {
        throw new Error('Loan category not found');
      }
    }

    return prisma.loanProduct.create({
      data: {
        name: input.name,
        description: input.description,
        type: input.type || 'PERSONAL',
        organizationId: input.organizationId,
        categoryId: input.categoryId,
        minAmount: input.minAmount,
        maxAmount: input.maxAmount,
        currency: input.currency || 'USD',
        interestRate: input.interestRate,
        calculationMethod: input.calculationMethod || 'REDUCING_BALANCE',
        minTerm: input.minTerm,
        maxTerm: input.maxTerm,
        repaymentFrequency: input.repaymentFrequency || 'MONTHLY',
        gracePeriod: input.gracePeriod || 0,
        penaltyRate: input.penaltyRate || 0,
        requiresCollateral: input.requiresCollateral || false,
        requiresGuarantor: input.requiresGuarantor || false,
        isOnlineEligible: input.isOnlineEligible || false,
      },
      include: {
        category: true,
      },
    });
  }

  async update(
    id: string,
    organizationId: string,
    input: UpdateLoanProductInput
  ) {
    const product = await prisma.loanProduct.findFirst({
      where: { id, organizationId },
    });

    if (!product) {
      throw new Error('Loan product not found');
    }

    // Verify category exists if being updated
    if (input.categoryId) {
      const category = await prisma.loanCategory.findFirst({
        where: {
          id: input.categoryId,
          organizationId,
        },
      });

      if (!category) {
        throw new Error('Loan category not found');
      }
    }

    return prisma.loanProduct.update({
      where: { id },
      data: input,
      include: {
        category: true,
      },
    });
  }

  async get(id: string, organizationId: string) {
    return prisma.loanProduct.findFirst({
      where: { id, organizationId },
      include: {
        category: true,
        _count: {
          select: { loans: true },
        },
      },
    });
  }

  async getAll(
    organizationId: string,
    options?: { categoryId?: string; isActive?: boolean }
  ) {
    return prisma.loanProduct.findMany({
      where: {
        organizationId,
        ...(options?.categoryId && { categoryId: options.categoryId }),
        ...(options?.isActive !== undefined && { isActive: options.isActive }),
      },
      include: {
        category: true,
        _count: {
          select: { loans: true },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async delete(id: string, organizationId: string) {
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

    return prisma.loanProduct.delete({
      where: { id },
    });
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
        category: {
          select: {
            id: true,
            name: true,
            code: true,
            isLongTerm: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async duplicateProduct(id: string, organizationId: string, newName: string) {
    const product = await this.get(id, organizationId);

    if (!product) {
      throw new Error('Loan product not found');
    }

    return this.create({
      name: newName,
      description: product.description || undefined,
      type: product.type,
      organizationId: product.organizationId,
      categoryId: product.categoryId || undefined,
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
    });
  }
}

export const loanProductService = new LoanProductService();
