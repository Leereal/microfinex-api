/**
 * Collateral Service
 *
 * Handles collateral management including:
 * - Collateral type management (per organization)
 * - Client collateral CRUD
 * - Collateral valuation tracking
 * - Loan collateral pledging/releasing
 * - Collateral document management
 */

import { prisma } from '../config/database';
import { storageService } from './storage.service';
import {
  CollateralStatus,
  OwnershipStatus,
  Currency,
  Prisma,
} from '@prisma/client';
import { z } from 'zod';

// Use Prisma.Decimal instead of importing from runtime/library
type Decimal = Prisma.Decimal;

// ===== SCHEMAS =====

export const createCollateralTypeSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(50).toUpperCase(),
  description: z.string().max(500).optional(),
  sortOrder: z.number().int().default(0),
  requiredFields: z.array(z.string()).default([]),
});

export const updateCollateralTypeSchema = createCollateralTypeSchema
  .partial()
  .extend({
    isActive: z.boolean().optional(),
  });

export const createClientCollateralSchema = z.object({
  clientId: z.string().uuid(),
  collateralTypeId: z.string().uuid(),
  description: z.string().min(1).max(1000),
  estimatedValue: z.number().positive(),
  currency: z.enum(['ZWG', 'USD', 'ZAR', 'BWP']).default('USD'),
  valuationDate: z.string().datetime().optional(),
  valuator: z.string().max(200).optional(),
  registrationNumber: z.string().max(100).optional(),
  serialNumber: z.string().max(100).optional(),
  make: z.string().max(100).optional(),
  model: z.string().max(100).optional(),
  year: z
    .number()
    .int()
    .min(1900)
    .max(new Date().getFullYear() + 1)
    .optional(),
  location: z.string().max(500).optional(),
  ownershipStatus: z
    .enum(['FULLY_OWNED', 'FINANCED', 'LEASED', 'JOINT_OWNERSHIP'])
    .default('FULLY_OWNED'),
  ownershipDetails: z.string().max(500).optional(),
  insuranceProvider: z.string().max(200).optional(),
  insurancePolicyNo: z.string().max(100).optional(),
  insuranceExpiryDate: z.string().datetime().optional(),
  notes: z.string().max(2000).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const updateClientCollateralSchema = createClientCollateralSchema
  .omit({ clientId: true, collateralTypeId: true })
  .partial();

export const pledgeCollateralSchema = z.object({
  loanId: z.string().uuid(),
});

// ===== INTERFACES =====

export interface CollateralTypeFilters {
  isActive?: boolean;
  search?: string;
}

export interface ClientCollateralFilters {
  status?: CollateralStatus;
  collateralTypeId?: string;
  loanId?: string;
  minValue?: number;
  maxValue?: number;
  currency?: Currency;
}

export interface CollateralSummary {
  totalItems: number;
  totalValue: Record<Currency, number>;
  byStatus: Record<CollateralStatus, number>;
  byType: Record<string, number>;
  pledgedToLoans: number;
  available: number;
}

// ===== SERVICE =====

class CollateralService {
  // ==========================================
  // COLLATERAL TYPES
  // ==========================================

  /**
   * Create a new collateral type for an organization
   */
  async createCollateralType(
    organizationId: string,
    data: z.infer<typeof createCollateralTypeSchema>
  ) {
    return prisma.collateralType.create({
      data: {
        organizationId,
        ...data,
      },
    });
  }

  /**
   * Update a collateral type
   */
  async updateCollateralType(
    collateralTypeId: string,
    organizationId: string,
    data: z.infer<typeof updateCollateralTypeSchema>
  ) {
    return prisma.collateralType.update({
      where: {
        id: collateralTypeId,
        organizationId,
      },
      data,
    });
  }

  /**
   * Get all collateral types for an organization
   */
  async getCollateralTypes(
    organizationId: string,
    filters?: CollateralTypeFilters
  ) {
    const where: Prisma.CollateralTypeWhereInput = {
      organizationId,
    };

    if (filters?.isActive !== undefined) {
      where.isActive = filters.isActive;
    }

    if (filters?.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { code: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    return prisma.collateralType.findMany({
      where,
      orderBy: { sortOrder: 'asc' },
    });
  }

  /**
   * Delete a collateral type (soft delete)
   */
  async deleteCollateralType(collateralTypeId: string, organizationId: string) {
    return prisma.collateralType.update({
      where: {
        id: collateralTypeId,
        organizationId,
      },
      data: {
        isActive: false,
      },
    });
  }

  // ==========================================
  // CLIENT COLLATERALS
  // ==========================================

  /**
   * Create a new collateral item for a client
   */
  async createClientCollateral(
    organizationId: string,
    data: z.infer<typeof createClientCollateralSchema>
  ) {
    // Validate client belongs to organization
    const client = await prisma.client.findFirst({
      where: {
        id: data.clientId,
        organizationId,
      },
    });

    if (!client) {
      throw new Error('Client not found');
    }

    // Validate collateral type belongs to organization
    const collateralType = await prisma.collateralType.findFirst({
      where: {
        id: data.collateralTypeId,
        organizationId,
        isActive: true,
      },
    });

    if (!collateralType) {
      throw new Error('Invalid collateral type');
    }

    return prisma.clientCollateral.create({
      data: {
        clientId: data.clientId,
        collateralTypeId: data.collateralTypeId,
        description: data.description,
        estimatedValue: new Prisma.Decimal(data.estimatedValue),
        currency: data.currency || 'USD',
        valuationDate: data.valuationDate
          ? new Date(data.valuationDate)
          : undefined,
        insuranceExpiryDate: data.insuranceExpiryDate
          ? new Date(data.insuranceExpiryDate)
          : undefined,
        status: 'AVAILABLE',
        registrationNumber: data.registrationNumber,
        serialNumber: data.serialNumber,
        make: data.make,
        model: data.model,
        year: data.year,
        location: data.location,
        ownershipStatus: data.ownershipStatus || 'FULLY_OWNED',
        ownershipDetails: data.ownershipDetails,
        insuranceProvider: data.insuranceProvider,
        insurancePolicyNo: data.insurancePolicyNo,
        notes: data.notes,
        metadata: data.metadata ? JSON.stringify(data.metadata) : undefined,
      },
      include: {
        collateralType: true,
        client: {
          select: {
            id: true,
            clientNumber: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });
  }

  /**
   * Update a collateral item
   */
  async updateClientCollateral(
    collateralId: string,
    organizationId: string,
    data: z.infer<typeof updateClientCollateralSchema>
  ) {
    // Validate collateral belongs to organization's client
    const existing = await prisma.clientCollateral.findFirst({
      where: {
        id: collateralId,
        client: {
          organizationId,
        },
      },
    });

    if (!existing) {
      throw new Error('Collateral not found');
    }

    // Don't allow updates to pledged collateral (except for certain fields)
    if (existing.status === 'PLEDGED' || existing.status === 'REPOSSESSED') {
      throw new Error('Cannot modify pledged or repossessed collateral');
    }

    return prisma.clientCollateral.update({
      where: { id: collateralId },
      data: {
        description: data.description,
        estimatedValue: data.estimatedValue ? new Prisma.Decimal(data.estimatedValue) : undefined,
        currency: data.currency,
        valuationDate: data.valuationDate
          ? new Date(data.valuationDate)
          : undefined,
        insuranceExpiryDate: data.insuranceExpiryDate
          ? new Date(data.insuranceExpiryDate)
          : undefined,
        registrationNumber: data.registrationNumber,
        serialNumber: data.serialNumber,
        make: data.make,
        model: data.model,
        year: data.year,
        location: data.location,
        ownershipStatus: data.ownershipStatus,
        ownershipDetails: data.ownershipDetails,
        insuranceProvider: data.insuranceProvider,
        insurancePolicyNo: data.insurancePolicyNo,
        notes: data.notes,
        metadata: data.metadata ? JSON.stringify(data.metadata) : undefined,
      },
      include: {
        collateralType: true,
        client: {
          select: {
            id: true,
            clientNumber: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });
  }

  /**
   * Get all collaterals for a client
   */
  async getClientCollaterals(
    clientId: string,
    organizationId: string,
    filters?: ClientCollateralFilters
  ) {
    // Verify client belongs to organization
    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId },
    });

    if (!client) {
      throw new Error('Client not found');
    }

    const where: Prisma.ClientCollateralWhereInput = {
      clientId,
    };

    if (filters?.status) {
      where.status = filters.status;
    }

    if (filters?.collateralTypeId) {
      where.collateralTypeId = filters.collateralTypeId;
    }

    if (filters?.loanId) {
      where.loanId = filters.loanId;
    }

    if (filters?.currency) {
      where.currency = filters.currency;
    }

    if (filters?.minValue !== undefined || filters?.maxValue !== undefined) {
      where.estimatedValue = {};
      if (filters?.minValue !== undefined) {
        where.estimatedValue.gte = filters.minValue;
      }
      if (filters?.maxValue !== undefined) {
        where.estimatedValue.lte = filters.maxValue;
      }
    }

    return prisma.clientCollateral.findMany({
      where,
      include: {
        collateralType: true,
        loan: {
          select: {
            id: true,
            loanNumber: true,
            amount: true,
            status: true,
          },
        },
        documents: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get a single collateral item
   */
  async getCollateral(collateralId: string, organizationId: string) {
    return prisma.clientCollateral.findFirst({
      where: {
        id: collateralId,
        client: {
          organizationId,
        },
      },
      include: {
        collateralType: true,
        client: {
          select: {
            id: true,
            clientNumber: true,
            firstName: true,
            lastName: true,
            phone: true,
          },
        },
        loan: {
          select: {
            id: true,
            loanNumber: true,
            amount: true,
            status: true,
            outstandingBalance: true,
          },
        },
        documents: true,
      },
    });
  }

  /**
   * Pledge collateral to a loan
   */
  async pledgeCollateral(
    collateralId: string,
    organizationId: string,
    loanId: string
  ) {
    // Validate collateral exists and is available
    const collateral = await prisma.clientCollateral.findFirst({
      where: {
        id: collateralId,
        client: {
          organizationId,
        },
      },
      include: {
        client: true,
      },
    });

    if (!collateral) {
      throw new Error('Collateral not found');
    }

    if (collateral.status !== 'AVAILABLE') {
      throw new Error('Collateral is not available for pledging');
    }

    // Validate loan exists and belongs to the same client
    const loan = await prisma.loan.findFirst({
      where: {
        id: loanId,
        organizationId,
        clientId: collateral.clientId,
      },
    });

    if (!loan) {
      throw new Error('Loan not found or does not belong to the same client');
    }

    return prisma.clientCollateral.update({
      where: { id: collateralId },
      data: {
        loanId,
        status: 'PLEDGED',
        pledgedAt: new Date(),
      },
      include: {
        collateralType: true,
        loan: {
          select: {
            id: true,
            loanNumber: true,
            amount: true,
            status: true,
          },
        },
      },
    });
  }

  /**
   * Release collateral from a loan
   */
  async releaseCollateral(collateralId: string, organizationId: string) {
    // Validate collateral exists and is pledged
    const collateral = await prisma.clientCollateral.findFirst({
      where: {
        id: collateralId,
        client: {
          organizationId,
        },
      },
    });

    if (!collateral) {
      throw new Error('Collateral not found');
    }

    if (collateral.status !== 'PLEDGED') {
      throw new Error('Collateral is not currently pledged');
    }

    return prisma.clientCollateral.update({
      where: { id: collateralId },
      data: {
        loanId: null,
        status: 'RELEASED',
        releasedAt: new Date(),
      },
      include: {
        collateralType: true,
      },
    });
  }

  /**
   * Mark collateral as repossessed
   */
  async repossessCollateral(
    collateralId: string,
    organizationId: string,
    notes?: string
  ) {
    const collateral = await prisma.clientCollateral.findFirst({
      where: {
        id: collateralId,
        client: {
          organizationId,
        },
      },
    });

    if (!collateral) {
      throw new Error('Collateral not found');
    }

    if (collateral.status !== 'PLEDGED') {
      throw new Error('Only pledged collateral can be repossessed');
    }

    return prisma.clientCollateral.update({
      where: { id: collateralId },
      data: {
        status: 'REPOSSESSED',
        notes: notes || collateral.notes,
      },
      include: {
        collateralType: true,
        loan: {
          select: {
            id: true,
            loanNumber: true,
            amount: true,
          },
        },
      },
    });
  }

  /**
   * Delete a collateral item (only if not pledged)
   */
  async deleteCollateral(collateralId: string, organizationId: string) {
    const collateral = await prisma.clientCollateral.findFirst({
      where: {
        id: collateralId,
        client: {
          organizationId,
        },
      },
    });

    if (!collateral) {
      throw new Error('Collateral not found');
    }

    if (collateral.status === 'PLEDGED') {
      throw new Error('Cannot delete pledged collateral');
    }

    // Delete associated documents from storage
    const documents = await prisma.collateralDocument.findMany({
      where: { collateralId },
    });

    for (const doc of documents) {
      try {
        await storageService.delete(doc.storagePath);
      } catch (error) {
        console.error(
          `Failed to delete collateral document: ${doc.storagePath}`,
          error
        );
      }
    }

    // Delete collateral (cascades to documents)
    return prisma.clientCollateral.delete({
      where: { id: collateralId },
    });
  }

  // ==========================================
  // COLLATERAL DOCUMENTS
  // ==========================================

  /**
   * Upload a document for collateral
   */
  async uploadCollateralDocument(
    collateralId: string,
    organizationId: string,
    file: Buffer,
    fileName: string,
    mimeType: string,
    fileSize: number,
    documentType: string,
    notes?: string
  ) {
    // Validate collateral belongs to organization
    const collateral = await prisma.clientCollateral.findFirst({
      where: {
        id: collateralId,
        client: {
          organizationId,
        },
      },
    });

    if (!collateral) {
      throw new Error('Collateral not found');
    }

    // Upload file to MinIO
    const uploadResult = await storageService.upload(
      file,
      fileName,
      mimeType,
      fileSize,
      {
        organizationId,
        entityType: 'clients',
        entityId: collateral.clientId,
        fileType: 'PLEDGE_IMAGE',
        subEntityId: collateralId,
      }
    );

    // Create document record
    return prisma.collateralDocument.create({
      data: {
        collateralId,
        fileName,
        fileSize,
        mimeType,
        storagePath: uploadResult.path,
        documentType,
        notes,
      },
    });
  }

  /**
   * Delete a collateral document
   */
  async deleteCollateralDocument(documentId: string, organizationId: string) {
    const document = await prisma.collateralDocument.findFirst({
      where: {
        id: documentId,
        collateral: {
          client: {
            organizationId,
          },
        },
      },
    });

    if (!document) {
      throw new Error('Document not found');
    }

    // Delete from storage
    await storageService.delete(document.storagePath);

    // Delete record
    return prisma.collateralDocument.delete({
      where: { id: documentId },
    });
  }

  // ==========================================
  // REPORTS & ANALYTICS
  // ==========================================

  /**
   * Get collateral summary for a client
   */
  async getClientCollateralSummary(
    clientId: string,
    organizationId: string
  ): Promise<CollateralSummary> {
    const collaterals = await prisma.clientCollateral.findMany({
      where: {
        clientId,
        client: {
          organizationId,
        },
      },
      include: {
        collateralType: true,
      },
    });

    const totalValue: Record<Currency, number> = {
      ZWG: 0,
      USD: 0,
      ZAR: 0,
      BWP: 0,
    };

    const byStatus: Record<CollateralStatus, number> = {
      AVAILABLE: 0,
      PLEDGED: 0,
      RELEASED: 0,
      REPOSSESSED: 0,
      SOLD: 0,
    };

    const byType: Record<string, number> = {};

    for (const c of collaterals) {
      const value =
        typeof c.estimatedValue === 'object' && c.estimatedValue !== null && 'd' in c.estimatedValue
          ? Number(c.estimatedValue)
          : Number(c.estimatedValue);

      totalValue[c.currency] += value;
      byStatus[c.status]++;

      const typeName = c.collateralType.name;
      byType[typeName] = (byType[typeName] || 0) + 1;
    }

    return {
      totalItems: collaterals.length,
      totalValue,
      byStatus,
      byType,
      pledgedToLoans: byStatus.PLEDGED,
      available: byStatus.AVAILABLE,
    };
  }

  /**
   * Get all pledged collateral for a loan
   */
  async getLoanCollaterals(loanId: string, organizationId: string) {
    return prisma.clientCollateral.findMany({
      where: {
        loanId,
        client: {
          organizationId,
        },
      },
      include: {
        collateralType: true,
        documents: true,
      },
    });
  }

  /**
   * Get organization-wide collateral statistics
   */
  async getOrganizationCollateralStats(organizationId: string) {
    const [totalCount, statusCounts, typeCounts, totalValues] =
      await Promise.all([
        prisma.clientCollateral.count({
          where: { client: { organizationId } },
        }),
        prisma.clientCollateral.groupBy({
          by: ['status'],
          where: { client: { organizationId } },
          _count: true,
        }),
        prisma.clientCollateral.groupBy({
          by: ['collateralTypeId'],
          where: { client: { organizationId } },
          _count: true,
        }),
        prisma.clientCollateral.groupBy({
          by: ['currency'],
          where: { client: { organizationId } },
          _sum: { estimatedValue: true },
        }),
      ]);

    // Get type names
    const typeIds = typeCounts.map(t => t.collateralTypeId);
    const types = await prisma.collateralType.findMany({
      where: { id: { in: typeIds } },
      select: { id: true, name: true },
    });
    const typeNameMap = new Map(types.map(t => [t.id, t.name]));

    return {
      totalCount,
      byStatus: Object.fromEntries(statusCounts.map(s => [s.status, s._count])),
      byType: Object.fromEntries(
        typeCounts.map(t => [
          typeNameMap.get(t.collateralTypeId) || t.collateralTypeId,
          t._count,
        ])
      ),
      totalValueByCurrency: Object.fromEntries(
        totalValues.map(v => [
          v.currency,
          v._sum.estimatedValue?.toNumber() || 0,
        ])
      ),
    };
  }
}

export const collateralService = new CollateralService();
