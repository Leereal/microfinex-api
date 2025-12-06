import { prisma } from '../config/database';
import { Prisma } from '@prisma/client';

export interface CreateCurrencyInput {
  code: string;
  name: string;
  symbol: string;
  position?: string;
  decimalPlaces?: number;
  isActive?: boolean;
  isDefault?: boolean;
  createdBy?: string;
}

export interface UpdateCurrencyInput {
  code?: string;
  name?: string;
  symbol?: string;
  position?: string;
  decimalPlaces?: number;
  isActive?: boolean;
  isDefault?: boolean;
  updatedBy?: string;
}

export interface CurrencyFilters {
  search?: string;
  isActive?: boolean;
  page?: number;
  limit?: number;
}

class CurrencyService {
  /**
   * Get all currencies with optional filters
   */
  async getAll(filters: CurrencyFilters = {}) {
    const { search, isActive, page = 1, limit = 50 } = filters;

    const where: Prisma.CurrencyRecordWhereInput = {};

    if (search) {
      where.OR = [
        { code: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { symbol: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    const [currencies, total] = await Promise.all([
      prisma.currencyRecord.findMany({
        where,
        orderBy: [{ isDefault: 'desc' }, { code: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.currencyRecord.count({ where }),
    ]);

    return {
      currencies,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get a single currency by ID
   */
  async getById(id: string) {
    return prisma.currencyRecord.findUnique({
      where: { id },
    });
  }

  /**
   * Get a single currency by code
   */
  async getByCode(code: string) {
    return prisma.currencyRecord.findUnique({
      where: { code: code.toUpperCase() },
    });
  }

  /**
   * Get the default currency
   */
  async getDefault() {
    return prisma.currencyRecord.findFirst({
      where: { isDefault: true, isActive: true },
    });
  }

  /**
   * Get all active currencies (for dropdowns)
   */
  async getActive() {
    return prisma.currencyRecord.findMany({
      where: { isActive: true },
      orderBy: [{ isDefault: 'desc' }, { code: 'asc' }],
    });
  }

  /**
   * Create a new currency
   */
  async create(input: CreateCurrencyInput) {
    const {
      code,
      name,
      symbol,
      position = 'before',
      decimalPlaces = 2,
      isActive = true,
      isDefault = false,
      createdBy,
    } = input;

    // Normalize code to uppercase
    const normalizedCode = code.toUpperCase();

    // Check for duplicate code
    const existing = await prisma.currencyRecord.findUnique({
      where: { code: normalizedCode },
    });

    if (existing) {
      throw new Error(`Currency with code "${normalizedCode}" already exists`);
    }

    // If setting as default, unset any existing default
    if (isDefault) {
      await prisma.currencyRecord.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    return prisma.currencyRecord.create({
      data: {
        code: normalizedCode,
        name,
        symbol,
        position,
        decimalPlaces,
        isActive,
        isDefault,
        createdBy,
      },
    });
  }

  /**
   * Update a currency
   */
  async update(id: string, input: UpdateCurrencyInput) {
    const { code, isDefault, updatedBy, ...rest } = input;

    // Check if currency exists
    const currency = await prisma.currencyRecord.findUnique({
      where: { id },
    });

    if (!currency) {
      throw new Error('Currency not found');
    }

    // If updating code, check for duplicates
    if (code && code.toUpperCase() !== currency.code) {
      const existing = await prisma.currencyRecord.findUnique({
        where: { code: code.toUpperCase() },
      });

      if (existing) {
        throw new Error(
          `Currency with code "${code.toUpperCase()}" already exists`
        );
      }
    }

    // If setting as default, unset any existing default
    if (isDefault === true) {
      await prisma.currencyRecord.updateMany({
        where: { isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }

    return prisma.currencyRecord.update({
      where: { id },
      data: {
        ...rest,
        ...(code && { code: code.toUpperCase() }),
        ...(isDefault !== undefined && { isDefault }),
        updatedBy,
      },
    });
  }

  /**
   * Delete a currency
   */
  async delete(id: string) {
    // Check if currency exists
    const currency = await prisma.currencyRecord.findUnique({
      where: { id },
    });

    if (!currency) {
      throw new Error('Currency not found');
    }

    // Don't allow deleting the default currency
    if (currency.isDefault) {
      throw new Error(
        'Cannot delete the default currency. Set another currency as default first.'
      );
    }

    return prisma.currencyRecord.delete({
      where: { id },
    });
  }

  /**
   * Set a currency as the default
   */
  async setDefault(id: string, updatedBy?: string) {
    // Check if currency exists and is active
    const currency = await prisma.currencyRecord.findUnique({
      where: { id },
    });

    if (!currency) {
      throw new Error('Currency not found');
    }

    if (!currency.isActive) {
      throw new Error('Cannot set an inactive currency as default');
    }

    // Unset any existing default
    await prisma.currencyRecord.updateMany({
      where: { isDefault: true },
      data: { isDefault: false },
    });

    // Set new default
    return prisma.currencyRecord.update({
      where: { id },
      data: { isDefault: true, updatedBy },
    });
  }

  /**
   * Toggle currency active status
   */
  async toggleActive(id: string, updatedBy?: string) {
    const currency = await prisma.currencyRecord.findUnique({
      where: { id },
    });

    if (!currency) {
      throw new Error('Currency not found');
    }

    // Don't allow deactivating the default currency
    if (currency.isDefault && currency.isActive) {
      throw new Error(
        'Cannot deactivate the default currency. Set another currency as default first.'
      );
    }

    return prisma.currencyRecord.update({
      where: { id },
      data: { isActive: !currency.isActive, updatedBy },
    });
  }

  /**
   * Seed default currencies
   */
  async seedDefaults() {
    const defaultCurrencies = [
      {
        code: 'USD',
        name: 'US Dollar',
        symbol: '$',
        position: 'before',
        isDefault: true,
      },
      { code: 'ZWG', name: 'Zimbabwe Gold', symbol: 'ZWG', position: 'before' },
      {
        code: 'ZAR',
        name: 'South African Rand',
        symbol: 'R',
        position: 'before',
      },
      { code: 'BWP', name: 'Botswana Pula', symbol: 'P', position: 'before' },
      { code: 'EUR', name: 'Euro', symbol: '€', position: 'before' },
      { code: 'GBP', name: 'British Pound', symbol: '£', position: 'before' },
    ];

    const results = [];

    for (const currency of defaultCurrencies) {
      const existing = await prisma.currencyRecord.findUnique({
        where: { code: currency.code },
      });

      if (!existing) {
        const created = await prisma.currencyRecord.create({
          data: {
            ...currency,
            decimalPlaces: 2,
            isActive: true,
          },
        });
        results.push({ ...created, status: 'created' });
      } else {
        results.push({ ...existing, status: 'exists' });
      }
    }

    return results;
  }
}

export const currencyService = new CurrencyService();
