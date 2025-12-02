import { prisma } from '../config/database';
import {
  Loan,
  LoanItem,
  LoanStatus,
  Prisma,
  Currency,
  RepaymentFrequency,
  LoanCalculationMethod,
  ApplicationSource,
} from '@prisma/client';

// ===== PRODUCT CREDIT SERVICE =====
// Handles product credit loans where shops submit orders for clients

interface ProductCreditItem {
  shopProductId: string;
  quantity: number;
}

interface CreateProductCreditInput {
  clientId: string;
  shopId: string;
  items: ProductCreditItem[];
  productId: string; // Loan product ID
  term: number; // in months
  repaymentFrequency?: RepaymentFrequency;
  notes?: string;
}

interface ProductCreditResult {
  loan: Loan;
  items: LoanItem[];
  totalAmount: Prisma.Decimal;
  shop: {
    id: string;
    name: string;
    bankAccount: string | null;
    mobileNumber: string | null;
  };
}

interface DisbursementNotification {
  clientId: string;
  clientName: string;
  clientPhone: string;
  shopName: string;
  shopAddress: string | null;
  items: Array<{
    name: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
  }>;
  totalAmount: number;
  loanNumber: string;
  collectionMessage: string;
}

export const productCreditService = {
  /**
   * Create a product credit loan
   * Shop submits order with items for a client
   * Creates loan with LoanItem records
   */
  async createProductCreditLoan(
    organizationId: string,
    branchId: string,
    loanOfficerId: string,
    input: CreateProductCreditInput
  ): Promise<ProductCreditResult> {
    const {
      clientId,
      shopId,
      items,
      productId,
      term,
      repaymentFrequency,
      notes,
    } = input;

    // Validate shop exists and belongs to organization
    const shop = await prisma.shop.findFirst({
      where: { id: shopId, organizationId, isActive: true },
    });
    if (!shop) {
      throw new Error('Shop not found or inactive');
    }

    // Validate client exists and belongs to organization
    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId, isActive: true },
    });
    if (!client) {
      throw new Error('Client not found or inactive');
    }

    // Validate loan product
    const loanProduct = await prisma.loanProduct.findFirst({
      where: { id: productId, organizationId, isActive: true },
    });
    if (!loanProduct) {
      throw new Error('Loan product not found or inactive');
    }

    // Validate and get all shop products
    if (!items || items.length === 0) {
      throw new Error('At least one item is required');
    }

    const productIds = items.map(item => item.shopProductId);
    const shopProducts = await prisma.shopProduct.findMany({
      where: {
        id: { in: productIds },
        shopId,
        isActive: true,
      },
    });

    if (shopProducts.length !== items.length) {
      throw new Error(
        'One or more products not found or not available in this shop'
      );
    }

    // Create a map for quick lookup
    const productMap = new Map(shopProducts.map(p => [p.id, p]));

    // Calculate total amount
    let totalAmount = new Prisma.Decimal(0);
    const itemsWithPrices = items.map(item => {
      const product = productMap.get(item.shopProductId)!;
      const itemTotal = product.price.mul(item.quantity);
      totalAmount = totalAmount.add(itemTotal);
      return {
        shopProductId: item.shopProductId,
        quantity: item.quantity,
        unitPrice: product.price,
        totalPrice: itemTotal,
        productName: product.name,
      };
    });

    // Validate amount against loan product limits
    if (totalAmount.lt(loanProduct.minAmount)) {
      throw new Error(
        `Total amount ${totalAmount} is below minimum loan amount ${loanProduct.minAmount}`
      );
    }
    if (totalAmount.gt(loanProduct.maxAmount)) {
      throw new Error(
        `Total amount ${totalAmount} exceeds maximum loan amount ${loanProduct.maxAmount}`
      );
    }

    // Validate term
    if (term < loanProduct.minTerm || term > loanProduct.maxTerm) {
      throw new Error(
        `Term ${term} months is outside allowed range (${loanProduct.minTerm}-${loanProduct.maxTerm})`
      );
    }

    // Calculate loan details
    const frequency = repaymentFrequency || loanProduct.repaymentFrequency;
    const interestRate = loanProduct.interestRate;

    // Simple interest calculation for now
    const totalInterest = totalAmount.mul(interestRate).mul(term).div(12);
    const totalLoanAmount = totalAmount.add(totalInterest);

    // Calculate number of installments based on frequency
    const installmentsPerMonth = getInstallmentsPerMonth(frequency);
    const totalInstallments = Math.ceil(term * installmentsPerMonth);
    const installmentAmount = totalLoanAmount.div(totalInstallments);

    // Generate loan number
    const loanNumber = await generateLoanNumber(organizationId);

    // Create loan and items in a transaction
    const result = await prisma.$transaction(async tx => {
      // Create the loan
      const loan = await tx.loan.create({
        data: {
          loanNumber,
          clientId,
          productId,
          organizationId,
          branchId,
          loanOfficerId,
          shopId,
          amount: totalAmount,
          currency: loanProduct.currency,
          interestRate,
          calculationMethod: loanProduct.calculationMethod,
          term,
          repaymentFrequency: frequency,
          installmentAmount,
          totalAmount: totalLoanAmount,
          totalInterest,
          status: LoanStatus.DRAFT,
          applicationSource: ApplicationSource.BRANCH,
          purpose: `Product credit from ${shop.name}`,
          notes,
          outstandingBalance: totalLoanAmount,
          principalBalance: totalAmount,
          interestBalance: totalInterest,
          penaltyBalance: new Prisma.Decimal(0),
        },
      });

      // Create loan items
      const loanItems = await Promise.all(
        itemsWithPrices.map(item =>
          tx.loanItem.create({
            data: {
              loanId: loan.id,
              shopProductId: item.shopProductId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              totalPrice: item.totalPrice,
            },
            include: {
              shopProduct: {
                select: { id: true, name: true, price: true },
              },
            },
          })
        )
      );

      // Create workflow history entry
      await tx.loanWorkflowHistory.create({
        data: {
          loanId: loan.id,
          fromStatus: LoanStatus.DRAFT,
          toStatus: LoanStatus.DRAFT,
          changedBy: loanOfficerId,
          notes: 'Product credit loan created',
        },
      });

      return { loan, loanItems };
    });

    return {
      loan: result.loan,
      items: result.loanItems,
      totalAmount,
      shop: {
        id: shop.id,
        name: shop.name,
        bankAccount: shop.bankAccount,
        mobileNumber: shop.mobileNumber,
      },
    };
  },

  /**
   * Disburse product credit loan to shop
   * Sends funds to shop's bank/mobile account
   */
  async disburseToShop(
    organizationId: string,
    loanId: string,
    disbursedBy: string,
    options: {
      disbursementMethod: 'BANK' | 'MOBILE';
      transactionRef?: string;
      notes?: string;
    }
  ): Promise<{ loan: Loan; notification: DisbursementNotification }> {
    const loan = await prisma.loan.findFirst({
      where: { id: loanId, organizationId },
      include: {
        client: true,
        shop: true,
        loanItems: {
          include: {
            shopProduct: true,
          },
        },
      },
    });

    if (!loan) {
      throw new Error('Loan not found');
    }

    if (!loan.shop) {
      throw new Error('This loan is not a product credit loan');
    }

    if (loan.status !== LoanStatus.APPROVED) {
      throw new Error(
        `Cannot disburse loan in ${loan.status} status. Must be APPROVED.`
      );
    }

    const { disbursementMethod, transactionRef, notes } = options;

    // Validate disbursement account
    if (disbursementMethod === 'BANK' && !loan.shop.bankAccount) {
      throw new Error('Shop does not have a bank account configured');
    }
    if (disbursementMethod === 'MOBILE' && !loan.shop.mobileNumber) {
      throw new Error('Shop does not have a mobile money account configured');
    }

    // Update loan status
    const updatedLoan = await prisma.$transaction(async tx => {
      const updated = await tx.loan.update({
        where: { id: loanId },
        data: {
          status: LoanStatus.ACTIVE,
          disbursedDate: new Date(),
          maturityDate: calculateMaturityDate(loan.term),
          notes: notes
            ? `${loan.notes || ''}\nDisbursement: ${notes}`
            : loan.notes,
        },
      });

      // Create workflow history
      await tx.loanWorkflowHistory.create({
        data: {
          loanId,
          fromStatus: LoanStatus.APPROVED,
          toStatus: LoanStatus.ACTIVE,
          changedBy: disbursedBy,
          notes: `Disbursed to shop via ${disbursementMethod}${transactionRef ? ` (Ref: ${transactionRef})` : ''}`,
        },
      });

      return updated;
    });

    // Prepare notification for client to collect products
    const notification: DisbursementNotification = {
      clientId: loan.client.id,
      clientName:
        `${loan.client.firstName || ''} ${loan.client.lastName || ''}`.trim() ||
        loan.client.businessName ||
        'Customer',
      clientPhone: loan.client.phone,
      shopName: loan.shop.name,
      shopAddress: loan.shop.address,
      items: loan.loanItems.map(item => ({
        name: item.shopProduct.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice.toNumber(),
        totalPrice: item.totalPrice.toNumber(),
      })),
      totalAmount: loan.amount.toNumber(),
      loanNumber: loan.loanNumber,
      collectionMessage: `Your order from ${loan.shop.name} is ready for collection. Loan #${loan.loanNumber}. Total: ${loan.currency} ${loan.amount.toNumber()}.`,
    };

    return { loan: updatedLoan, notification };
  },

  /**
   * Get product credit loans for a shop
   */
  async getShopProductCreditLoans(
    organizationId: string,
    shopId: string,
    filters: {
      status?: LoanStatus;
      clientId?: string;
      dateFrom?: Date;
      dateTo?: Date;
      page?: number;
      limit?: number;
    } = {}
  ) {
    const {
      status,
      clientId,
      dateFrom,
      dateTo,
      page = 1,
      limit = 20,
    } = filters;
    const skip = (page - 1) * limit;

    const where: Prisma.LoanWhereInput = {
      organizationId,
      shopId,
      ...(status && { status }),
      ...(clientId && { clientId }),
      ...(dateFrom && { createdAt: { gte: dateFrom } }),
      ...(dateTo && { createdAt: { lte: dateTo } }),
    };

    const [loans, total] = await Promise.all([
      prisma.loan.findMany({
        where,
        skip,
        take: limit,
        include: {
          client: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              businessName: true,
              phone: true,
            },
          },
          loanItems: {
            include: {
              shopProduct: {
                select: { id: true, name: true, price: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.loan.count({ where }),
    ]);

    return {
      data: loans,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  /**
   * Get product credit statistics for a shop
   */
  async getShopProductCreditStats(organizationId: string, shopId: string) {
    const shop = await prisma.shop.findFirst({
      where: { id: shopId, organizationId },
    });
    if (!shop) {
      throw new Error('Shop not found');
    }

    const [loanStats, itemStats, statusCounts] = await Promise.all([
      prisma.loan.aggregate({
        where: { shopId, organizationId },
        _sum: { amount: true, totalAmount: true },
        _count: true,
      }),
      prisma.loanItem.aggregate({
        where: {
          loan: { shopId, organizationId },
        },
        _sum: { totalPrice: true, quantity: true },
      }),
      prisma.loan.groupBy({
        by: ['status'],
        where: { shopId, organizationId },
        _count: true,
        _sum: { amount: true },
      }),
    ]);

    return {
      shop: {
        id: shop.id,
        name: shop.name,
      },
      summary: {
        totalLoans: loanStats._count,
        totalPrincipal: loanStats._sum?.amount || new Prisma.Decimal(0),
        totalLoanValue: loanStats._sum?.totalAmount || new Prisma.Decimal(0),
        totalProductsSold: itemStats._sum?.quantity || 0,
        totalProductValue: itemStats._sum?.totalPrice || new Prisma.Decimal(0),
      },
      byStatus: statusCounts.map(s => ({
        status: s.status,
        count: s._count,
        totalAmount: s._sum?.amount || new Prisma.Decimal(0),
      })),
    };
  },
};

// Helper functions
function getInstallmentsPerMonth(frequency: RepaymentFrequency): number {
  switch (frequency) {
    case 'DAILY':
      return 30;
    case 'WEEKLY':
      return 4;
    case 'BIWEEKLY':
      return 2;
    case 'MONTHLY':
      return 1;
    case 'QUARTERLY':
      return 1 / 3;
    case 'SEMI_ANNUAL':
      return 1 / 6;
    case 'ANNUAL':
      return 1 / 12;
    default:
      return 1;
  }
}

async function generateLoanNumber(organizationId: string): Promise<string> {
  const prefix = 'PC'; // Product Credit
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');

  // Count existing loans this month
  const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0);

  const count = await prisma.loan.count({
    where: {
      organizationId,
      loanNumber: { startsWith: `${prefix}${year}${month}` },
      createdAt: {
        gte: startOfMonth,
        lte: endOfMonth,
      },
    },
  });

  const sequence = (count + 1).toString().padStart(4, '0');
  return `${prefix}${year}${month}${sequence}`;
}

function calculateMaturityDate(termInMonths: number): Date {
  const date = new Date();
  date.setMonth(date.getMonth() + termInMonths);
  return date;
}

export default productCreditService;
