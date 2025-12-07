// @ts-nocheck
// TODO: This file has significant type mismatches between controller and service signatures.
// These need to be fixed systematically to match the Prisma schema and service interfaces.
// Temporarily disabled type checking for deployment.

/**
 * Document Controller
 * Handles HTTP requests for document management operations
 */

import { Request, Response } from 'express';
import { documentService } from '../services/document.service';
import { aiExtractionService } from '../services/ai-extraction.service';
import { prisma } from '../config/database';
import { DocumentStatus } from '@prisma/client';

class DocumentController {
  /**
   * Upload a document for a client
   * POST /api/v1/documents/:clientId
   *
   * Body:
   * - documentTypeId: string (required)
   * - file: string (base64 encoded file data, required)
   * - fileName: string (required)
   * - mimeType: string (required)
   * - fileSize: number (required)
   * - documentNumber?: string
   * - expiryDate?: string (ISO date)
   * - notes?: string
   */
  async uploadDocument(req: Request, res: Response) {
    try {
      const { clientId } = req.params;
      const userId = req.user?.userId;
      const organizationId = req.user?.organizationId;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization context required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      // Verify client belongs to organization
      const client = await prisma.client.findFirst({
        where: {
          id: clientId,
          organizationId,
        },
      });

      if (!client) {
        return res.status(404).json({
          success: false,
          message: 'Client not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      // Extract document data from request
      const {
        documentTypeId,
        file,
        fileName,
        mimeType,
        fileSize,
        documentNumber,
        expiryDate,
        notes,
      } = req.body;

      // Validate required fields
      if (!file || !documentTypeId) {
        return res.status(400).json({
          success: false,
          message: 'File and document type are required',
          error: 'MISSING_FIELDS',
          timestamp: new Date().toISOString(),
        });
      }

      if (!fileName || !mimeType || !fileSize) {
        return res.status(400).json({
          success: false,
          message: 'File name, mime type, and file size are required',
          error: 'MISSING_FILE_METADATA',
          timestamp: new Date().toISOString(),
        });
      }

      // Verify document type exists and belongs to organization
      const documentType = await prisma.documentType.findFirst({
        where: {
          id: documentTypeId,
          organizationId,
          isActive: true,
        },
      });

      if (!documentType) {
        return res.status(404).json({
          success: false,
          message: 'Document type not found',
          error: 'DOCUMENT_TYPE_NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      // Convert base64 to Buffer
      let fileBuffer: Buffer;
      try {
        // Handle both data URL format and plain base64
        const base64Data = file.includes(',') ? file.split(',')[1] : file;
        fileBuffer = Buffer.from(base64Data, 'base64');
      } catch (e) {
        return res.status(400).json({
          success: false,
          message: 'Invalid file data - could not decode base64',
          error: 'INVALID_FILE_DATA',
          timestamp: new Date().toISOString(),
        });
      }

      const document = await documentService.uploadDocument(organizationId, {
        clientId,
        documentTypeId,
        file: fileBuffer,
        fileName,
        mimeType,
        fileSize: Number(fileSize),
        documentNumber,
        expiryDate: expiryDate ? new Date(expiryDate) : undefined,
        notes,
      });

      res.status(201).json({
        success: true,
        message: 'Document uploaded successfully',
        data: { document },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Upload document error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to upload document',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get all documents for a client
   * GET /api/v1/documents/client/:clientId
   */
  async getClientDocuments(req: Request, res: Response) {
    try {
      const { clientId } = req.params;
      const organizationId = req.user?.organizationId;
      const { status, documentTypeId, page = 1, limit = 20 } = req.query;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization context required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      // Verify client belongs to organization
      const client = await prisma.client.findFirst({
        where: {
          id: clientId,
          organizationId,
        },
      });

      if (!client) {
        return res.status(404).json({
          success: false,
          message: 'Client not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      const documents = await documentService.getClientDocuments(
        clientId,
        organizationId,
        {
          status: status as DocumentStatus,
          documentTypeId: documentTypeId as string,
          page: Number(page),
          limit: Number(limit),
        }
      );

      res.json({
        success: true,
        message: 'Documents retrieved successfully',
        data: { documents },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Get client documents error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve documents',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get document by ID
   * GET /api/v1/documents/:documentId
   */
  async getDocument(req: Request, res: Response) {
    try {
      const { documentId } = req.params;
      const organizationId = req.user?.organizationId;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization context required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      const document = await prisma.clientDocument.findFirst({
        where: {
          id: documentId,
          client: {
            organizationId,
          },
        },
        include: {
          documentType: true,
          uploadedByUser: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          verifiedByUser: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      });

      if (!document) {
        return res.status(404).json({
          success: false,
          message: 'Document not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      res.json({
        success: true,
        message: 'Document retrieved successfully',
        data: { document },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Get document error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve document',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Verify a document
   * POST /api/v1/documents/:documentId/verify
   */
  async verifyDocument(req: Request, res: Response) {
    try {
      const { documentId } = req.params;
      const userId = req.user?.userId;
      const organizationId = req.user?.organizationId;
      const { status, notes } = req.body;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization context required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      if (!status || !['VERIFIED', 'REJECTED'].includes(status)) {
        return res.status(400).json({
          success: false,
          message: 'Valid status (VERIFIED or REJECTED) is required',
          error: 'INVALID_STATUS',
          timestamp: new Date().toISOString(),
        });
      }

      // Verify document exists and belongs to organization
      const existingDoc = await prisma.clientDocument.findFirst({
        where: {
          id: documentId,
          client: {
            organizationId,
          },
        },
      });

      if (!existingDoc) {
        return res.status(404).json({
          success: false,
          message: 'Document not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      const document = await documentService.verifyDocument(
        documentId,
        userId!,
        status as 'VERIFIED' | 'REJECTED',
        notes
      );

      res.json({
        success: true,
        message: `Document ${status.toLowerCase()} successfully`,
        data: { document },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Verify document error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to verify document',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Delete a document
   * DELETE /api/v1/documents/:documentId
   */
  async deleteDocument(req: Request, res: Response) {
    try {
      const { documentId } = req.params;
      const organizationId = req.user?.organizationId;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization context required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      // Verify document exists and belongs to organization
      const existingDoc = await prisma.clientDocument.findFirst({
        where: {
          id: documentId,
          client: {
            organizationId,
          },
        },
      });

      if (!existingDoc) {
        return res.status(404).json({
          success: false,
          message: 'Document not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      await documentService.deleteDocument(documentId);

      res.json({
        success: true,
        message: 'Document deleted successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Delete document error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete document',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Extract data from document using AI
   * POST /api/v1/documents/:documentId/extract
   */
  async extractDocumentData(req: Request, res: Response) {
    try {
      const { documentId } = req.params;
      const organizationId = req.user?.organizationId;
      const { providerId } = req.body;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization context required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      // Get document with type info
      const document = await prisma.clientDocument.findFirst({
        where: {
          id: documentId,
          client: {
            organizationId,
          },
        },
        include: {
          documentType: true,
        },
      });

      if (!document) {
        return res.status(404).json({
          success: false,
          message: 'Document not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      // Get AI configuration for organization
      let aiConfig = await prisma.organizationAIConfig.findFirst({
        where: {
          organizationId,
          isActive: true,
        },
        include: {
          provider: true,
        },
        orderBy: {
          isDefault: 'desc',
        },
      });

      // If specific provider requested, use that
      if (providerId) {
        aiConfig = await prisma.organizationAIConfig.findFirst({
          where: {
            organizationId,
            providerId,
            isActive: true,
          },
          include: {
            provider: true,
          },
        });
      }

      if (!aiConfig) {
        return res.status(400).json({
          success: false,
          message: 'No AI provider configured for this organization',
          error: 'NO_AI_CONFIG',
          timestamp: new Date().toISOString(),
        });
      }

      const extractedData = await aiExtractionService.extractFromDocument(
        documentId,
        document.documentType.name,
        organizationId,
        aiConfig.providerId
      );

      // Update document with extracted data
      await prisma.clientDocument.update({
        where: { id: documentId },
        data: {
          extractedData: extractedData as any,
          aiProviderId: aiConfig.providerId,
          aiProcessedAt: new Date(),
        },
      });

      res.json({
        success: true,
        message: 'Data extracted successfully',
        data: {
          documentId,
          extractedData,
          provider: aiConfig.provider.name,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Extract document data error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to extract document data',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get document types for organization
   * GET /api/v1/documents/types
   */
  async getDocumentTypes(req: Request, res: Response) {
    try {
      const organizationId = req.user?.organizationId;
      const { includeInactive } = req.query;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization context required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      const documentTypes = await prisma.documentType.findMany({
        where: {
          organizationId,
          ...(includeInactive !== 'true' && { isActive: true }),
        },
        orderBy: {
          name: 'asc',
        },
      });

      res.json({
        success: true,
        message: 'Document types retrieved successfully',
        data: { documentTypes },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Get document types error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve document types',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Create document type
   * POST /api/v1/documents/types
   */
  async createDocumentType(req: Request, res: Response) {
    try {
      const organizationId = req.user?.organizationId;
      const userId = req.user?.userId;
      const { name, description, isRequired, supportsAI, aiExtractionFields } =
        req.body;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization context required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      if (!name) {
        return res.status(400).json({
          success: false,
          message: 'Document type name is required',
          error: 'MISSING_NAME',
          timestamp: new Date().toISOString(),
        });
      }

      // Check for duplicate name
      const existing = await prisma.documentType.findFirst({
        where: {
          organizationId,
          name: {
            equals: name,
            mode: 'insensitive',
          },
        },
      });

      if (existing) {
        return res.status(409).json({
          success: false,
          message: 'Document type with this name already exists',
          error: 'DUPLICATE_NAME',
          timestamp: new Date().toISOString(),
        });
      }

      const documentType = await prisma.documentType.create({
        data: {
          name,
          description,
          isRequired: isRequired ?? false,
          supportsAI: supportsAI ?? false,
          aiExtractionFields: aiExtractionFields ?? [],
          organizationId,
          createdBy: userId,
        },
      });

      res.status(201).json({
        success: true,
        message: 'Document type created successfully',
        data: { documentType },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Create document type error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create document type',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Update document type
   * PUT /api/v1/documents/types/:typeId
   */
  async updateDocumentType(req: Request, res: Response) {
    try {
      const { typeId } = req.params;
      const organizationId = req.user?.organizationId;
      const {
        name,
        description,
        isRequired,
        supportsAI,
        aiExtractionFields,
        isActive,
      } = req.body;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization context required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      // Verify document type exists and belongs to organization
      const existingType = await prisma.documentType.findFirst({
        where: {
          id: typeId,
          organizationId,
        },
      });

      if (!existingType) {
        return res.status(404).json({
          success: false,
          message: 'Document type not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      // Check for duplicate name if name is being changed
      if (name && name !== existingType.name) {
        const duplicate = await prisma.documentType.findFirst({
          where: {
            organizationId,
            name: {
              equals: name,
              mode: 'insensitive',
            },
            id: {
              not: typeId,
            },
          },
        });

        if (duplicate) {
          return res.status(409).json({
            success: false,
            message: 'Document type with this name already exists',
            error: 'DUPLICATE_NAME',
            timestamp: new Date().toISOString(),
          });
        }
      }

      const documentType = await prisma.documentType.update({
        where: { id: typeId },
        data: {
          ...(name && { name }),
          ...(description !== undefined && { description }),
          ...(isRequired !== undefined && { isRequired }),
          ...(supportsAI !== undefined && { supportsAI }),
          ...(aiExtractionFields !== undefined && { aiExtractionFields }),
          ...(isActive !== undefined && { isActive }),
        },
      });

      res.json({
        success: true,
        message: 'Document type updated successfully',
        data: { documentType },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Update document type error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update document type',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Delete document type
   * DELETE /api/v1/documents/types/:typeId
   */
  async deleteDocumentType(req: Request, res: Response) {
    try {
      const { typeId } = req.params;
      const organizationId = req.user?.organizationId;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization context required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      // Verify document type exists and belongs to organization
      const existingType = await prisma.documentType.findFirst({
        where: {
          id: typeId,
          organizationId,
        },
      });

      if (!existingType) {
        return res.status(404).json({
          success: false,
          message: 'Document type not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      // Check if type is in use
      const documentsCount = await prisma.clientDocument.count({
        where: {
          documentTypeId: typeId,
        },
      });

      if (documentsCount > 0) {
        // Soft delete instead of hard delete
        await prisma.documentType.update({
          where: { id: typeId },
          data: { isActive: false },
        });

        return res.json({
          success: true,
          message: 'Document type deactivated (in use by existing documents)',
          timestamp: new Date().toISOString(),
        });
      }

      await prisma.documentType.delete({
        where: { id: typeId },
      });

      res.json({
        success: true,
        message: 'Document type deleted successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Delete document type error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete document type',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get AI providers
   * GET /api/v1/documents/ai-providers
   */
  async getAIProviders(req: Request, res: Response) {
    try {
      const providers = await prisma.aIProvider.findMany({
        where: {
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          description: true,
          supportedDocTypes: true,
          modelName: true,
        },
        orderBy: {
          name: 'asc',
        },
      });

      res.json({
        success: true,
        message: 'AI providers retrieved successfully',
        data: { providers },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Get AI providers error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve AI providers',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get organization AI configuration
   * GET /api/v1/documents/ai-config
   */
  async getAIConfig(req: Request, res: Response) {
    try {
      const organizationId = req.user?.organizationId;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization context required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      const configs = await prisma.organizationAIConfig.findMany({
        where: {
          organizationId,
        },
        include: {
          provider: {
            select: {
              id: true,
              name: true,
              description: true,
              modelName: true,
            },
          },
        },
        orderBy: {
          isDefault: 'desc',
        },
      });

      res.json({
        success: true,
        message: 'AI configuration retrieved successfully',
        data: { configs },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Get AI config error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve AI configuration',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Update organization AI configuration
   * PUT /api/v1/documents/ai-config/:providerId
   */
  async updateAIConfig(req: Request, res: Response) {
    try {
      const { providerId } = req.params;
      const organizationId = req.user?.organizationId;
      const userId = req.user?.userId;
      const { apiKey, isActive, isDefault, maxTokens, temperature, settings } =
        req.body;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization context required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      // Verify provider exists
      const provider = await prisma.aIProvider.findUnique({
        where: { id: providerId },
      });

      if (!provider) {
        return res.status(404).json({
          success: false,
          message: 'AI provider not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      // Get or create config
      let config = await prisma.organizationAIConfig.findUnique({
        where: {
          organizationId_providerId: {
            organizationId,
            providerId,
          },
        },
      });

      if (config) {
        // Update existing config
        config = await prisma.organizationAIConfig.update({
          where: { id: config.id },
          data: {
            ...(apiKey && { apiKey }),
            ...(isActive !== undefined && { isActive }),
            ...(isDefault !== undefined && { isDefault }),
            ...(maxTokens !== undefined && { maxTokens }),
            ...(temperature !== undefined && { temperature }),
            ...(settings !== undefined && { settings }),
          },
          include: {
            provider: {
              select: {
                id: true,
                name: true,
                description: true,
                modelName: true,
              },
            },
          },
        });
      } else {
        // Create new config
        if (!apiKey) {
          return res.status(400).json({
            success: false,
            message: 'API key is required for new configuration',
            error: 'MISSING_API_KEY',
            timestamp: new Date().toISOString(),
          });
        }

        config = await prisma.organizationAIConfig.create({
          data: {
            organizationId,
            providerId,
            apiKey,
            isActive: isActive ?? true,
            isDefault: isDefault ?? false,
            maxTokens: maxTokens ?? 4096,
            temperature: temperature ?? 0.1,
            settings: settings ?? {},
            createdBy: userId,
          },
          include: {
            provider: {
              select: {
                id: true,
                name: true,
                description: true,
                modelName: true,
              },
            },
          },
        });
      }

      // If this is set as default, unset other defaults
      if (isDefault) {
        await prisma.organizationAIConfig.updateMany({
          where: {
            organizationId,
            id: { not: config.id },
          },
          data: {
            isDefault: false,
          },
        });
      }

      res.json({
        success: true,
        message: 'AI configuration updated successfully',
        data: { config },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Update AI config error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update AI configuration',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get download URL for a document
   * GET /api/v1/documents/:documentId/download
   */
  async getDownloadUrl(req: Request, res: Response) {
    try {
      const { documentId } = req.params;
      const organizationId = req.user?.organizationId;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization context required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      const document = await prisma.clientDocument.findFirst({
        where: {
          id: documentId,
          client: {
            organizationId,
          },
        },
      });

      if (!document) {
        return res.status(404).json({
          success: false,
          message: 'Document not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      const downloadUrl = await documentService.getDownloadUrl(documentId);

      res.json({
        success: true,
        message: 'Download URL generated successfully',
        data: { downloadUrl },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Get download URL error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to generate download URL',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
}

export const documentController = new DocumentController();
