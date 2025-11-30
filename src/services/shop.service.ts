import { prisma } from '../config/database';
import { Shop, ShopProduct, LoanItem, Prisma, Currency } from '@prisma/client';

// ===== SHOP SERVICE =====
// Based on actual schema:
// model Shop { id, name, address, phone, contactPerson, bankAccount, mobileNumber, organizationId, isActive, createdAt, updatedAt }
// model ShopProduct { id, shopId, name, description, price, currency, sku, isActive, createdAt, updatedAt }
// model LoanItem { id, loanId, shopProductId, quantity, unitPrice, totalPrice, createdAt }

interface CreateShopData {
  name: string;
  address?: string;
  phone?: string;
  contactPerson?: string;
  bankAccount?: string;
  mobileNumber?: string;
}

interface UpdateShopData extends Partial<CreateShopData> {
  isActive?: boolean;
}

interface ShopFilters {
  search?: string;
  isActive?: boolean;
  page?: number;
  limit?: number;
}

export const shopService = {
  // Create shop
  async createShop(organizationId: string, data: CreateShopData): Promise<Shop> {
    return prisma.shop.create({
      data: {
        organizationId,
        name: data.name,
        address: data.address,
        phone: data.phone,
        contactPerson: data.contactPerson,
        bankAccount: data.bankAccount,
        mobileNumber: data.mobileNumber,
      },
    });
  },

  // Get shops with pagination
  async getShops(organizationId: string, filters: ShopFilters = {}) {
    const { search, isActive, page = 1, limit = 20 } = filters;
    const skip = (page - 1) * limit;

    const where: Prisma.ShopWhereInput = {
      organizationId,
      ...(isActive !== undefined && { isActive }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { contactPerson: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [shops, total] = await Promise.all([
      prisma.shop.findMany({
        where,
        skip,
        take: limit,
        include: {
          _count: {
            select: {
              products: true,
              loans: true,
            },
          },
        },
        orderBy: { name: 'asc' },
      }),
      prisma.shop.count({ where }),
    ]);

    return {
      data: shops,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  // Get shop by ID
  async getShopById(organizationId: string, id: string): Promise<Shop | null> {
    return prisma.shop.findFirst({
      where: { id, organizationId },
      include: {
        products: {
          where: { isActive: true },
          orderBy: { name: 'asc' },
        },
        _count: {
          select: {
            products: true,
            loans: true,
          },
        },
      },
    });
  },

  // Update shop
  async updateShop(organizationId: string, id: string, data: UpdateShopData): Promise<Shop | null> {
    const shop = await prisma.shop.findFirst({ where: { id, organizationId } });
    if (!shop) return null;

    return prisma.shop.update({
      where: { id },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.address !== undefined && { address: data.address }),
        ...(data.phone !== undefined && { phone: data.phone }),
        ...(data.contactPerson !== undefined && { contactPerson: data.contactPerson }),
        ...(data.bankAccount !== undefined && { bankAccount: data.bankAccount }),
        ...(data.mobileNumber !== undefined && { mobileNumber: data.mobileNumber }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });
  },

  // Delete shop (soft delete)
  async deleteShop(organizationId: string, id: string): Promise<boolean> {
    const shop = await prisma.shop.findFirst({ where: { id, organizationId } });
    if (!shop) return false;

    await prisma.shop.update({
      where: { id },
      data: { isActive: false },
    });
    return true;
  },

  // Get shop stats
  async getShopStats(organizationId: string, shopId: string) {
    const shop = await prisma.shop.findFirst({
      where: { id: shopId, organizationId },
    });
    if (!shop) return null;

    const [productCount, loanCount, loanItemStats] = await Promise.all([
      prisma.shopProduct.count({ where: { shopId, isActive: true } }),
      prisma.loan.count({ where: { shopId } }),
      prisma.loanItem.aggregate({
        where: {
          shopProduct: { shopId },
        },
        _sum: {
          totalPrice: true,
          quantity: true,
        },
      }),
    ]);

    return {
      shop,
      stats: {
        activeProducts: productCount,
        totalLoans: loanCount,
        totalSalesValue: loanItemStats._sum?.totalPrice || new Prisma.Decimal(0),
        totalItemsSold: loanItemStats._sum?.quantity || 0,
      },
    };
  },
};

// ===== SHOP PRODUCT SERVICE =====

interface CreateProductData {
  name: string;
  description?: string;
  price: number;
  currency?: Currency;
  sku?: string;
}

interface UpdateProductData extends Partial<CreateProductData> {
  isActive?: boolean;
}

interface ProductFilters {
  search?: string;
  isActive?: boolean;
  minPrice?: number;
  maxPrice?: number;
  page?: number;
  limit?: number;
}

export const shopProductService = {
  // Create product
  async createProduct(organizationId: string, shopId: string, data: CreateProductData): Promise<ShopProduct | null> {
    // Verify shop exists and belongs to organization
    const shop = await prisma.shop.findFirst({ where: { id: shopId, organizationId } });
    if (!shop) return null;

    return prisma.shopProduct.create({
      data: {
        shopId,
        name: data.name,
        description: data.description,
        price: new Prisma.Decimal(data.price),
        currency: data.currency || 'USD',
        sku: data.sku,
      },
    });
  },

  // Get products for shop
  async getProducts(organizationId: string, shopId: string, filters: ProductFilters = {}) {
    // Verify shop exists and belongs to organization
    const shop = await prisma.shop.findFirst({ where: { id: shopId, organizationId } });
    if (!shop) return null;

    const { search, isActive, minPrice, maxPrice, page = 1, limit = 20 } = filters;
    const skip = (page - 1) * limit;

    const where: Prisma.ShopProductWhereInput = {
      shopId,
      ...(isActive !== undefined && { isActive }),
      ...(minPrice !== undefined && { price: { gte: new Prisma.Decimal(minPrice) } }),
      ...(maxPrice !== undefined && { price: { lte: new Prisma.Decimal(maxPrice) } }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { description: { contains: search, mode: 'insensitive' as const } },
          { sku: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [products, total] = await Promise.all([
      prisma.shopProduct.findMany({
        where,
        skip,
        take: limit,
        include: {
          _count: {
            select: { loanItems: true },
          },
        },
        orderBy: { name: 'asc' },
      }),
      prisma.shopProduct.count({ where }),
    ]);

    return {
      data: products,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  // Get product by ID
  async getProductById(organizationId: string, shopId: string, productId: string): Promise<ShopProduct | null> {
    const shop = await prisma.shop.findFirst({ where: { id: shopId, organizationId } });
    if (!shop) return null;

    return prisma.shopProduct.findFirst({
      where: { id: productId, shopId },
      include: {
        shop: {
          select: { id: true, name: true },
        },
        _count: {
          select: { loanItems: true },
        },
      },
    });
  },

  // Update product
  async updateProduct(
    organizationId: string,
    shopId: string,
    productId: string,
    data: UpdateProductData
  ): Promise<ShopProduct | null> {
    const shop = await prisma.shop.findFirst({ where: { id: shopId, organizationId } });
    if (!shop) return null;

    const product = await prisma.shopProduct.findFirst({ where: { id: productId, shopId } });
    if (!product) return null;

    return prisma.shopProduct.update({
      where: { id: productId },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.price !== undefined && { price: new Prisma.Decimal(data.price) }),
        ...(data.currency && { currency: data.currency }),
        ...(data.sku !== undefined && { sku: data.sku }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });
  },

  // Delete product (soft delete)
  async deleteProduct(organizationId: string, shopId: string, productId: string): Promise<boolean> {
    const shop = await prisma.shop.findFirst({ where: { id: shopId, organizationId } });
    if (!shop) return false;

    const product = await prisma.shopProduct.findFirst({ where: { id: productId, shopId } });
    if (!product) return false;

    await prisma.shopProduct.update({
      where: { id: productId },
      data: { isActive: false },
    });
    return true;
  },

  // Get product categories (from distinct values)
  async getCategories(organizationId: string, shopId: string): Promise<string[]> {
    const shop = await prisma.shop.findFirst({ where: { id: shopId, organizationId } });
    if (!shop) return [];

    // Since there's no category field, return empty array
    // In a real scenario, you might add a category field to the schema
    return [];
  },

  // Get low stock products (not applicable without quantity field)
  async getLowStockProducts(organizationId: string, shopId: string): Promise<ShopProduct[]> {
    const shop = await prisma.shop.findFirst({ where: { id: shopId, organizationId } });
    if (!shop) return [];

    // Since there's no quantity field in ShopProduct, return empty array
    // In a real scenario, you might track inventory separately
    return [];
  },

  // Adjust stock - not applicable without quantity field
  async adjustStock(
    organizationId: string,
    shopId: string,
    productId: string,
    adjustment: number,
    type: 'add' | 'subtract' | 'set'
  ): Promise<ShopProduct | null> {
    // Since there's no quantity field, just return the product
    const product = await this.getProductById(organizationId, shopId, productId);
    return product;
  },
};

// ===== LOAN ITEM SERVICE =====

interface CreateLoanItemData {
  loanId: string;
  shopProductId: string;
  quantity: number;
}

interface UpdateLoanItemData {
  quantity?: number;
}

export const loanItemService = {
  // Create loan item
  async createLoanItem(organizationId: string, data: CreateLoanItemData): Promise<LoanItem | null> {
    // Verify loan and product exist
    const [loan, product] = await Promise.all([
      prisma.loan.findFirst({ where: { id: data.loanId, organizationId } }),
      prisma.shopProduct.findUnique({ where: { id: data.shopProductId } }),
    ]);

    if (!loan || !product) return null;

    const totalPrice = product.price.mul(data.quantity);

    return prisma.loanItem.create({
      data: {
        loanId: data.loanId,
        shopProductId: data.shopProductId,
        quantity: data.quantity,
        unitPrice: product.price,
        totalPrice,
      },
      include: {
        shopProduct: {
          select: { id: true, name: true, price: true },
        },
      },
    });
  },

  // Get loan items for a loan
  async getLoanItems(organizationId: string, loanId: string) {
    const loan = await prisma.loan.findFirst({ where: { id: loanId, organizationId } });
    if (!loan) return null;

    const items = await prisma.loanItem.findMany({
      where: { loanId },
      include: {
        shopProduct: {
          select: { id: true, name: true, price: true, currency: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const total = items.reduce((sum, item) => sum.add(item.totalPrice), new Prisma.Decimal(0));

    return {
      items,
      total,
    };
  },

  // Get loan item by ID
  async getLoanItemById(organizationId: string, loanItemId: string): Promise<LoanItem | null> {
    return prisma.loanItem.findFirst({
      where: {
        id: loanItemId,
        loan: { organizationId },
      },
      include: {
        shopProduct: {
          select: { id: true, name: true, price: true, currency: true },
        },
        loan: {
          select: { id: true, clientId: true, amount: true },
        },
      },
    });
  },

  // Update loan item
  async updateLoanItem(
    organizationId: string,
    loanItemId: string,
    data: UpdateLoanItemData
  ): Promise<LoanItem | null> {
    const item = await prisma.loanItem.findFirst({
      where: {
        id: loanItemId,
        loan: { organizationId },
      },
      include: { shopProduct: true },
    });

    if (!item) return null;

    const quantity = data.quantity ?? item.quantity;
    const totalPrice = item.unitPrice.mul(quantity);

    return prisma.loanItem.update({
      where: { id: loanItemId },
      data: {
        quantity,
        totalPrice,
      },
      include: {
        shopProduct: {
          select: { id: true, name: true, price: true },
        },
      },
    });
  },

  // Delete loan item
  async deleteLoanItem(organizationId: string, loanItemId: string): Promise<boolean> {
    const item = await prisma.loanItem.findFirst({
      where: {
        id: loanItemId,
        loan: { organizationId },
      },
    });

    if (!item) return false;

    await prisma.loanItem.delete({ where: { id: loanItemId } });
    return true;
  },

  // Get items by product (for reporting)
  async getItemsByProduct(organizationId: string, productId: string) {
    return prisma.loanItem.findMany({
      where: {
        shopProductId: productId,
        loan: { organizationId },
      },
      include: {
        loan: {
          select: { id: true, clientId: true, status: true, createdAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  // Get total value of items for a shop
  async getShopSalesStats(organizationId: string, shopId: string) {
    const stats = await prisma.loanItem.aggregate({
      where: {
        shopProduct: { shopId },
        loan: { organizationId },
      },
      _sum: {
        totalPrice: true,
        quantity: true,
      },
      _count: true,
    });

    return {
      totalSales: stats._sum?.totalPrice || new Prisma.Decimal(0),
      totalQuantity: stats._sum?.quantity || 0,
      totalItems: stats._count,
    };
  },
};
