import { prisma } from '../config/database';
import { Prisma } from '@prisma/client';

export interface CreateIncomeCategoryInput {
  organizationId: string;
  name: string;
  code: string;
  description?: string;
  isSystemCategory?: boolean;
  isActive?: boolean;
  createdBy?: string;
}

export interface UpdateIncomeCategoryInput {
  name?: string;
  code?: string;
  description?: string;
  isActive?: boolean;
}

export interface IncomeCategoryFilters {
  organizationId: string;
  search?: string;
  isActive?: boolean;
  isSystemCategory?: boolean;
  page?: number;
  limit?: number;
}

class IncomeCategoryService {
  /**
   * Get all income categories with optional filters
   */
  async getAll(filters: IncomeCategoryFilters) {
    const {
      organizationId,
      search,
      isActive,
      isSystemCategory,
      page = 1,
      limit = 50,
    } = filters;

    const where: Prisma.IncomeCategoryWhereInput = {
      organizationId,
    };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    if (isSystemCategory !== undefined) {
      where.isSystemCategory = isSystemCategory;
    }

    const [categories, total] = await Promise.all([
      prisma.incomeCategory.findMany({
        where,
        orderBy: [{ isSystemCategory: 'desc' }, { name: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.incomeCategory.count({ where }),
    ]);

    return {
      categories,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get a single income category by ID
   */
  async getById(id: string, organizationId: string) {
    return prisma.incomeCategory.findFirst({
      where: { id, organizationId },
    });
  }

  /**
   * Get a single income category by code within an organization
   */
  async getByCode(code: string, organizationId: string) {
    return prisma.incomeCategory.findFirst({
      where: {
        code: code.toUpperCase(),
        organizationId,
      },
    });
  }

  /**
   * Get all active income categories (for dropdowns)
   */
  async getActive(organizationId: string) {
    return prisma.incomeCategory.findMany({
      where: { organizationId, isActive: true },
      orderBy: [{ isSystemCategory: 'desc' }, { name: 'asc' }],
    });
  }

  /**
   * Create a new income category
   */
  async create(input: CreateIncomeCategoryInput) {
    const {
      organizationId,
      name,
      code,
      description,
      isSystemCategory = false,
      isActive = true,
      createdBy,
    } = input;

    // Normalize code to uppercase
    const normalizedCode = code.toUpperCase();

    // Check for duplicate code within organization
    const existing = await prisma.incomeCategory.findFirst({
      where: {
        code: normalizedCode,
        organizationId,
      },
    });

    if (existing) {
      throw new Error(
        `Income category with code "${normalizedCode}" already exists`
      );
    }

    return prisma.incomeCategory.create({
      data: {
        organizationId,
        name,
        code: normalizedCode,
        description,
        isSystemCategory,
        isActive,
        createdBy,
      },
    });
  }

  /**
   * Update an income category
   */
  async update(
    id: string,
    organizationId: string,
    input: UpdateIncomeCategoryInput
  ) {
    const existingCategory = await this.getById(id, organizationId);
    if (!existingCategory) {
      throw new Error('Income category not found');
    }

    // Prevent updating system categories' code
    if (existingCategory.isSystemCategory && input.code) {
      throw new Error('Cannot change code of system category');
    }

    const { code, ...rest } = input;

    // Check for duplicate code if changing
    if (code && code.toUpperCase() !== existingCategory.code) {
      const duplicate = await prisma.incomeCategory.findFirst({
        where: {
          code: code.toUpperCase(),
          organizationId,
          NOT: { id },
        },
      });

      if (duplicate) {
        throw new Error(
          `Income category with code "${code.toUpperCase()}" already exists`
        );
      }
    }

    return prisma.incomeCategory.update({
      where: { id },
      data: {
        ...rest,
        code: code ? code.toUpperCase() : undefined,
      },
    });
  }

  /**
   * Delete an income category
   */
  async delete(id: string, organizationId: string) {
    const existingCategory = await this.getById(id, organizationId);
    if (!existingCategory) {
      throw new Error('Income category not found');
    }

    // Prevent deleting system categories
    if (existingCategory.isSystemCategory) {
      throw new Error('Cannot delete system category. Deactivate it instead.');
    }

    // Check if category has transactions
    const transactionCount = await prisma.financialTransaction.count({
      where: { incomeCategoryId: id },
    });

    if (transactionCount > 0) {
      throw new Error(
        `Cannot delete income category. It has ${transactionCount} associated transactions. Deactivate it instead.`
      );
    }

    return prisma.incomeCategory.delete({
      where: { id },
    });
  }

  /**
   * Seed default income categories for a new organization
   */
  async seedDefaults(organizationId: string, createdBy?: string) {
    const defaults = [
      {
        name: 'Loan Repayment',
        code: 'LOAN_REPAYMENT',
        description: 'Income from loan repayments',
        isSystemCategory: true,
      },
      {
        name: 'Interest Income',
        code: 'INTEREST_INCOME',
        description: 'Income from loan interest',
      },
      {
        name: 'Penalty Income',
        code: 'PENALTY_INCOME',
        description: 'Income from loan penalties',
      },
      {
        name: 'Processing Fee',
        code: 'PROCESSING_FEE',
        description: 'Income from loan processing fees',
      },
      {
        name: 'Shareholder Investment',
        code: 'SHAREHOLDER_INVESTMENT',
        description: 'Capital from shareholders',
      },
      {
        name: 'External Funding',
        code: 'EXTERNAL_FUNDING',
        description: 'Funding from external sources',
      },
      {
        name: 'Asset Sale',
        code: 'ASSET_SALE',
        description: 'Income from selling assets',
      },
      {
        name: 'Grant',
        code: 'GRANT',
        description: 'Grants and donations received',
      },
      {
        name: 'Other Income',
        code: 'OTHER_INCOME',
        description: 'Miscellaneous income',
      },
    ];

    const results = [];
    for (const category of defaults) {
      try {
        const created = await this.create({
          organizationId,
          ...category,
          createdBy,
        });
        results.push(created);
      } catch (error) {
        // Skip if already exists
        console.log(`Skipping ${category.name}: ${error}`);
      }
    }

    return results;
  }
}

export const incomeCategoryService = new IncomeCategoryService();
