/**
 * Document Service
 *
 * Handles client document management including:
 * - Document uploads to MinIO via storage service
 * - Document type management
 * - Document verification workflow
 * - AI extraction integration
 */

import { prisma } from '../config/database';
import { storageService, FILE_TYPES } from './storage.service';
import { DocumentStatus, Prisma } from '@prisma/client';
import { z } from 'zod';

// ===== SCHEMAS =====

export const createDocumentTypeSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(50).toUpperCase(),
  description: z.string().max(500).optional(),
  isRequired: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
  validityDays: z.number().int().positive().optional(),
});

export const uploadClientDocumentSchema = z.object({
  documentTypeId: z.string().uuid(),
  documentNumber: z.string().optional(),
  issueDate: z.string().datetime().optional(),
  expiryDate: z.string().datetime().optional(),
  issuingAuthority: z.string().max(200).optional(),
  notes: z.string().max(1000).optional(),
});

export const verifyDocumentSchema = z.object({
  status: z.enum(['VERIFIED', 'REJECTED']),
  rejectionReason: z.string().max(500).optional(),
  notes: z.string().max(1000).optional(),
});

// ===== INTERFACES =====

export interface DocumentUploadInput {
  clientId: string;
  documentTypeId: string;
  file: Buffer;
  fileName: string;
  mimeType: string;
  fileSize: number;
  documentNumber?: string;
  issueDate?: Date;
  expiryDate?: Date;
  issuingAuthority?: string;
  notes?: string;
}

export interface DocumentTypeFilters {
  isRequired?: boolean;
  isActive?: boolean;
  search?: string;
}

export interface ClientDocumentFilters {
  status?: DocumentStatus;
  documentTypeId?: string;
  isExpired?: boolean;
}

// ===== SERVICE =====

class DocumentService {
  // ==========================================
  // DOCUMENT TYPES
  // ==========================================

  /**
   * Create a new document type for an organization
   */
  async createDocumentType(
    organizationId: string,
    data: z.infer<typeof createDocumentTypeSchema>
  ) {
    return prisma.documentType.create({
      data: {
        organizationId,
        ...data,
      },
    });
  }

  /**
   * Update a document type
   */
  async updateDocumentType(
    documentTypeId: string,
    organizationId: string,
    data: Partial<z.infer<typeof createDocumentTypeSchema>>
  ) {
    return prisma.documentType.update({
      where: {
        id: documentTypeId,
        organizationId,
      },
      data,
    });
  }

  /**
   * Get all document types for an organization
   */
  async getDocumentTypes(
    organizationId: string,
    filters?: DocumentTypeFilters
  ) {
    const where: Prisma.DocumentTypeWhereInput = {
      organizationId,
    };

    if (filters?.isRequired !== undefined) {
      where.isRequired = filters.isRequired;
    }

    if (filters?.isActive !== undefined) {
      where.isActive = filters.isActive;
    }

    if (filters?.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { code: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    return prisma.documentType.findMany({
      where,
      orderBy: { sortOrder: 'asc' },
    });
  }

  /**
   * Get required document types for an organization
   */
  async getRequiredDocumentTypes(organizationId: string) {
    return prisma.documentType.findMany({
      where: {
        organizationId,
        isRequired: true,
        isActive: true,
      },
      orderBy: { sortOrder: 'asc' },
    });
  }

  /**
   * Delete a document type (soft delete by setting isActive = false)
   */
  async deleteDocumentType(documentTypeId: string, organizationId: string) {
    return prisma.documentType.update({
      where: {
        id: documentTypeId,
        organizationId,
      },
      data: {
        isActive: false,
      },
    });
  }

  // ==========================================
  // CLIENT DOCUMENTS
  // ==========================================

  /**
   * Upload a document for a client
   */
  async uploadDocument(organizationId: string, input: DocumentUploadInput) {
    // Validate document type belongs to organization
    const documentType = await prisma.documentType.findFirst({
      where: {
        id: input.documentTypeId,
        organizationId,
        isActive: true,
      },
    });

    if (!documentType) {
      throw new Error('Invalid document type');
    }

    // Validate client belongs to organization
    const client = await prisma.client.findFirst({
      where: {
        id: input.clientId,
        organizationId,
      },
    });

    if (!client) {
      throw new Error('Client not found');
    }

    // Upload file to MinIO
    const uploadResult = await storageService.upload(
      input.file,
      input.fileName,
      input.mimeType,
      input.fileSize,
      {
        organizationId,
        entityType: 'clients',
        entityId: input.clientId,
        fileType: 'DOCUMENT',
      }
    );

    // Create document record
    const document = await prisma.clientDocument.create({
      data: {
        clientId: input.clientId,
        documentTypeId: input.documentTypeId,
        fileName: input.fileName,
        fileSize: input.fileSize,
        mimeType: input.mimeType,
        storagePath: uploadResult.path,
        storageUrl: uploadResult.url,
        documentNumber: input.documentNumber,
        issueDate: input.issueDate,
        expiryDate: input.expiryDate,
        issuingAuthority: input.issuingAuthority,
        notes: input.notes,
        status: 'UPLOADED',
      },
      include: {
        documentType: true,
      },
    });

    return document;
  }

  /**
   * Get all documents for a client
   */
  async getClientDocuments(
    clientId: string,
    organizationId: string,
    filters?: ClientDocumentFilters
  ) {
    // Verify client belongs to organization
    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId },
    });

    if (!client) {
      throw new Error('Client not found');
    }

    const where: Prisma.ClientDocumentWhereInput = {
      clientId,
    };

    if (filters?.status) {
      where.status = filters.status;
    }

    if (filters?.documentTypeId) {
      where.documentTypeId = filters.documentTypeId;
    }

    if (filters?.isExpired) {
      where.expiryDate = {
        lt: new Date(),
      };
    }

    const documents = await prisma.clientDocument.findMany({
      where,
      include: {
        documentType: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Refresh URLs for documents
    return Promise.all(
      documents.map(async doc => ({
        ...doc,
        storageUrl: await storageService.getSignedUrl(doc.storagePath),
      }))
    );
  }

  /**
   * Get a single document with fresh URL
   */
  async getDocument(documentId: string, organizationId: string) {
    const document = await prisma.clientDocument.findFirst({
      where: {
        id: documentId,
        client: {
          organizationId,
        },
      },
      include: {
        documentType: true,
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

    if (!document) {
      return null;
    }

    // Generate fresh presigned URL
    const storageUrl = await storageService.getSignedUrl(document.storagePath);

    return {
      ...document,
      storageUrl,
    };
  }

  /**
   * Verify or reject a document
   */
  async verifyDocument(
    documentId: string,
    organizationId: string,
    verifiedBy: string,
    data: z.infer<typeof verifyDocumentSchema>
  ) {
    // Validate document belongs to organization
    const existing = await prisma.clientDocument.findFirst({
      where: {
        id: documentId,
        client: {
          organizationId,
        },
      },
    });

    if (!existing) {
      throw new Error('Document not found');
    }

    return prisma.clientDocument.update({
      where: { id: documentId },
      data: {
        status: data.status,
        rejectionReason:
          data.status === 'REJECTED' ? data.rejectionReason : null,
        verifiedBy,
        verifiedAt: new Date(),
        notes: data.notes,
      },
      include: {
        documentType: true,
      },
    });
  }

  /**
   * Delete a document
   */
  async deleteDocument(documentId: string, organizationId: string) {
    // Find and validate document
    const document = await prisma.clientDocument.findFirst({
      where: {
        id: documentId,
        client: {
          organizationId,
        },
      },
    });

    if (!document) {
      throw new Error('Document not found');
    }

    // Delete from MinIO
    await storageService.delete(document.storagePath);

    // Delete record
    return prisma.clientDocument.delete({
      where: { id: documentId },
    });
  }

  /**
   * Store AI extraction data for a document
   */
  async storeAIExtractionData(
    documentId: string,
    organizationId: string,
    extractionData: Record<string, unknown>,
    confidence: number
  ) {
    // Validate document belongs to organization
    const existing = await prisma.clientDocument.findFirst({
      where: {
        id: documentId,
        client: {
          organizationId,
        },
      },
    });

    if (!existing) {
      throw new Error('Document not found');
    }

    return prisma.clientDocument.update({
      where: { id: documentId },
      data: {
        aiExtractionData: extractionData,
        aiConfidence: confidence,
        extractedAt: new Date(),
      },
    });
  }

  /**
   * Check if a client has all required documents
   */
  async checkRequiredDocuments(clientId: string, organizationId: string) {
    const [requiredTypes, clientDocs] = await Promise.all([
      this.getRequiredDocumentTypes(organizationId),
      prisma.clientDocument.findMany({
        where: {
          clientId,
          status: { in: ['UPLOADED', 'VERIFIED'] },
        },
        select: {
          documentTypeId: true,
          status: true,
        },
      }),
    ]);

    const uploadedTypeIds = new Set(clientDocs.map(d => d.documentTypeId));
    const verifiedTypeIds = new Set(
      clientDocs.filter(d => d.status === 'VERIFIED').map(d => d.documentTypeId)
    );

    const missing: string[] = [];
    const unverified: string[] = [];

    for (const required of requiredTypes) {
      if (!uploadedTypeIds.has(required.id)) {
        missing.push(required.name);
      } else if (!verifiedTypeIds.has(required.id)) {
        unverified.push(required.name);
      }
    }

    return {
      complete: missing.length === 0,
      allVerified: missing.length === 0 && unverified.length === 0,
      missing,
      unverified,
      totalRequired: requiredTypes.length,
      uploaded: uploadedTypeIds.size,
      verified: verifiedTypeIds.size,
    };
  }

  /**
   * Get expiring documents
   */
  async getExpiringDocuments(organizationId: string, daysAhead: number = 30) {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + daysAhead);

    return prisma.clientDocument.findMany({
      where: {
        client: {
          organizationId,
        },
        expiryDate: {
          lte: futureDate,
          gte: new Date(),
        },
        status: { in: ['UPLOADED', 'VERIFIED'] },
      },
      include: {
        documentType: true,
        client: {
          select: {
            id: true,
            clientNumber: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
          },
        },
      },
      orderBy: { expiryDate: 'asc' },
    });
  }
}

export const documentService = new DocumentService();
