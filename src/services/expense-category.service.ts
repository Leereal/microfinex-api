import { prisma } from '../config/database';
import { Prisma } from '@prisma/client';

export interface CreateExpenseCategoryInput {
  organizationId: string;
  name: string;
  code: string;
  description?: string;
  isSystemCategory?: boolean;
  isActive?: boolean;
  createdBy?: string;
}

export interface UpdateExpenseCategoryInput {
  name?: string;
  code?: string;
  description?: string;
  isActive?: boolean;
}

export interface ExpenseCategoryFilters {
  organizationId: string;
  search?: string;
  isActive?: boolean;
  isSystemCategory?: boolean;
  page?: number;
  limit?: number;
}

class ExpenseCategoryService {
  /**
   * Get all expense categories with optional filters
   */
  async getAll(filters: ExpenseCategoryFilters) {
    const {
      organizationId,
      search,
      isActive,
      isSystemCategory,
      page = 1,
      limit = 50,
    } = filters;

    const where: Prisma.ExpenseCategoryWhereInput = {
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
      prisma.expenseCategory.findMany({
        where,
        orderBy: [{ isSystemCategory: 'desc' }, { name: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.expenseCategory.count({ where }),
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
   * Get a single expense category by ID
   */
  async getById(id: string, organizationId: string) {
    return prisma.expenseCategory.findFirst({
      where: { id, organizationId },
    });
  }

  /**
   * Get a single expense category by code within an organization
   */
  async getByCode(code: string, organizationId: string) {
    return prisma.expenseCategory.findFirst({
      where: {
        code: code.toUpperCase(),
        organizationId,
      },
    });
  }

  /**
   * Get all active expense categories (for dropdowns)
   */
  async getActive(organizationId: string) {
    return prisma.expenseCategory.findMany({
      where: { organizationId, isActive: true },
      orderBy: [{ isSystemCategory: 'desc' }, { name: 'asc' }],
    });
  }

  /**
   * Create a new expense category
   */
  async create(input: CreateExpenseCategoryInput) {
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
    const existing = await prisma.expenseCategory.findFirst({
      where: {
        code: normalizedCode,
        organizationId,
      },
    });

    if (existing) {
      throw new Error(
        `Expense category with code "${normalizedCode}" already exists`
      );
    }

    return prisma.expenseCategory.create({
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
   * Update an expense category
   */
  async update(
    id: string,
    organizationId: string,
    input: UpdateExpenseCategoryInput
  ) {
    const existingCategory = await this.getById(id, organizationId);
    if (!existingCategory) {
      throw new Error('Expense category not found');
    }

    // Prevent updating system categories' code
    if (existingCategory.isSystemCategory && input.code) {
      throw new Error('Cannot change code of system category');
    }

    const { code, ...rest } = input;

    // Check for duplicate code if changing
    if (code && code.toUpperCase() !== existingCategory.code) {
      const duplicate = await prisma.expenseCategory.findFirst({
        where: {
          code: code.toUpperCase(),
          organizationId,
          NOT: { id },
        },
      });

      if (duplicate) {
        throw new Error(
          `Expense category with code "${code.toUpperCase()}" already exists`
        );
      }
    }

    return prisma.expenseCategory.update({
      where: { id },
      data: {
        ...rest,
        code: code ? code.toUpperCase() : undefined,
      },
    });
  }

  /**
   * Delete an expense category
   */
  async delete(id: string, organizationId: string) {
    const existingCategory = await this.getById(id, organizationId);
    if (!existingCategory) {
      throw new Error('Expense category not found');
    }

    // Prevent deleting system categories
    if (existingCategory.isSystemCategory) {
      throw new Error('Cannot delete system category. Deactivate it instead.');
    }

    // Check if category has transactions
    const transactionCount = await prisma.financialTransaction.count({
      where: { expenseCategoryId: id },
    });

    if (transactionCount > 0) {
      throw new Error(
        `Cannot delete expense category. It has ${transactionCount} associated transactions. Deactivate it instead.`
      );
    }

    return prisma.expenseCategory.delete({
      where: { id },
    });
  }

  /**
   * Seed default expense categories for a new organization
   */
  async seedDefaults(organizationId: string, createdBy?: string) {
    const defaults = [
      {
        name: 'Loan Disbursement',
        code: 'LOAN_DISBURSEMENT',
        description: 'Money disbursed as loans',
        isSystemCategory: true,
      },
      {
        name: 'Rent',
        code: 'RENT',
        description: 'Office rent and related costs',
      },
      {
        name: 'Utilities',
        code: 'UTILITIES',
        description: 'Electricity, water, internet',
      },
      {
        name: 'Salaries',
        code: 'SALARIES',
        description: 'Staff salaries and wages',
      },
      {
        name: 'Stationery',
        code: 'STATIONERY',
        description: 'Office supplies and stationery',
      },
      {
        name: 'Transport',
        code: 'TRANSPORT',
        description: 'Transport and travel costs',
      },
      {
        name: 'Marketing',
        code: 'MARKETING',
        description: 'Marketing and advertising',
      },
      {
        name: 'Equipment',
        code: 'EQUIPMENT',
        description: 'Equipment purchase and maintenance',
      },
      {
        name: 'Bank Charges',
        code: 'BANK_CHARGES',
        description: 'Bank fees and charges',
      },
      {
        name: 'Insurance',
        code: 'INSURANCE',
        description: 'Insurance premiums',
      },
      {
        name: 'Legal Fees',
        code: 'LEGAL_FEES',
        description: 'Legal and professional fees',
      },
      { name: 'Bad Debt', code: 'BAD_DEBT', description: 'Written off loans' },
      {
        name: 'Other Expenses',
        code: 'OTHER_EXPENSES',
        description: 'Miscellaneous expenses',
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

export const expenseCategoryService = new ExpenseCategoryService();
