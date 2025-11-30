import { prisma } from '../config/database';
import { LoanCategory } from '@prisma/client';

export class LoanCategoryService {
  async create(data: {
    name: string;
    code: string;
    description?: string;
    isLongTerm?: boolean;
    requiresBusinessVisit?: boolean;
    requiresHomeVisit?: boolean;
    requiresSecurityPledge?: boolean;
    requiresCollateral?: boolean;
    organizationId: string;
  }): Promise<LoanCategory> {
    return prisma.loanCategory.create({
      data,
    });
  }

  async update(
    id: string,
    organizationId: string,
    data: Partial<{
      name: string;
      description: string;
      isLongTerm: boolean;
      requiresBusinessVisit: boolean;
      requiresHomeVisit: boolean;
      requiresSecurityPledge: boolean;
      requiresCollateral: boolean;
      isActive: boolean;
    }>
  ): Promise<LoanCategory> {
    const category = await prisma.loanCategory.findUnique({
      where: { id },
    });

    if (!category || category.organizationId !== organizationId) {
      throw new Error('Loan category not found');
    }

    return prisma.loanCategory.update({
      where: { id },
      data,
    });
  }

  async get(id: string, organizationId: string): Promise<LoanCategory | null> {
    return prisma.loanCategory.findFirst({
      where: { id, organizationId },
    });
  }

  async getAll(organizationId: string): Promise<LoanCategory[]> {
    return prisma.loanCategory.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
    });
  }

  async delete(id: string, organizationId: string): Promise<void> {
    const category = await prisma.loanCategory.findUnique({
      where: { id },
    });

    if (!category || category.organizationId !== organizationId) {
      throw new Error('Loan category not found');
    }

    // Check if used by any products
    const productsCount = await prisma.loanProduct.count({
      where: { categoryId: id },
    });

    if (productsCount > 0) {
      throw new Error('Cannot delete category that is used by loan products');
    }

    await prisma.loanCategory.delete({
      where: { id },
    });
  }
}

export const loanCategoryService = new LoanCategoryService();
