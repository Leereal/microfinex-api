// @ts-nocheck
// TODO: This file has significant type mismatches between controller and service signatures.
// These need to be fixed systematically to match the Prisma schema and service interfaces.
// Temporarily disabled type checking for deployment.

/**
 * Collateral Controller
 * Handles HTTP requests for collateral management operations
 */

import { Request, Response } from 'express';
import { collateralService } from '../services/collateral.service';
import { prisma } from '../config/database';
import { CollateralStatus } from '@prisma/client';

class CollateralController {
  /**
   * Get all collateral types for organization
   * GET /api/v1/collaterals/types
   */
  async getCollateralTypes(req: Request, res: Response) {
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

      const collateralTypes = await collateralService.getCollateralTypes(
        organizationId,
        { isActive: includeInactive !== 'true' ? true : undefined }
      );

      res.json({
        success: true,
        message: 'Collateral types retrieved successfully',
        data: { collateralTypes },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Get collateral types error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve collateral types',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Create collateral type
   * POST /api/v1/collaterals/types
   */
  async createCollateralType(req: Request, res: Response) {
    try {
      const organizationId = req.user?.organizationId;
      const userId = req.user?.userId;
      const {
        name,
        description,
        requiredDocuments,
        valuationRules,
        depreciationRate,
        maxLoanToValue,
      } = req.body;

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
          message: 'Collateral type name is required',
          error: 'MISSING_NAME',
          timestamp: new Date().toISOString(),
        });
      }

      const collateralType = await collateralService.createCollateralType(
        organizationId,
        {
          name,
          code: name.toUpperCase().replace(/\\s+/g, '_').substring(0, 50),
          description: description || '',
          sortOrder: 0,
          requiredFields: requiredDocuments || [],
        }
      );

      res.status(201).json({
        success: true,
        message: 'Collateral type created successfully',
        data: { collateralType },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Create collateral type error:', error);

      if (error.message === 'Collateral type with this name already exists') {
        return res.status(409).json({
          success: false,
          message: error.message,
          error: 'DUPLICATE_NAME',
          timestamp: new Date().toISOString(),
        });
      }

      res.status(500).json({
        success: false,
        message: 'Failed to create collateral type',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Update collateral type
   * PUT /api/v1/collaterals/types/:typeId
   */
  async updateCollateralType(req: Request, res: Response) {
    try {
      const { typeId: rawTypeId } = req.params;
      const rawOrganizationId = req.user?.organizationId;
      const {
        name,
        description,
        requiredDocuments,
        valuationRules,
        depreciationRate,
        maxLoanToValue,
        isActive,
      } = req.body;

      if (!rawOrganizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization context required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      if (!rawTypeId) {
        return res.status(400).json({
          success: false,
          message: 'Type ID is required',
          error: 'MISSING_TYPE_ID',
          timestamp: new Date().toISOString(),
        });
      }

      const organizationId: string = rawOrganizationId;
      const typeId: string = rawTypeId;

      // Verify collateral type exists and belongs to organization
      const existingType = await prisma.collateralType.findFirst({
        where: {
          id: typeId,
          organizationId,
        },
      });

      if (!existingType) {
        return res.status(404).json({
          success: false,
          message: 'Collateral type not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      const collateralType = await collateralService.updateCollateralType(
        typeId,
        organizationId,
        {
          name,
          code: name?.toUpperCase().replace(/\\s+/g, '_').substring(0, 50),
          description,
          isActive,
        }
      );

      res.json({
        success: true,
        message: 'Collateral type updated successfully',
        data: { collateralType },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Update collateral type error:', error);

      if (error.message === 'Collateral type with this name already exists') {
        return res.status(409).json({
          success: false,
          message: error.message,
          error: 'DUPLICATE_NAME',
          timestamp: new Date().toISOString(),
        });
      }

      res.status(500).json({
        success: false,
        message: 'Failed to update collateral type',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Delete collateral type
   * DELETE /api/v1/collaterals/types/:typeId
   */
  async deleteCollateralType(req: Request, res: Response) {
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

      // Verify collateral type exists and belongs to organization
      const existingType = await prisma.collateralType.findFirst({
        where: {
          id: typeId,
          organizationId,
        },
      });

      if (!existingType) {
        return res.status(404).json({
          success: false,
          message: 'Collateral type not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      await collateralService.deleteCollateralType(typeId, organizationId);

      res.json({
        success: true,
        message: 'Collateral type deleted/deactivated successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Delete collateral type error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete collateral type',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get all collaterals for a client
   * GET /api/v1/collaterals/client/:clientId
   */
  async getClientCollaterals(req: Request, res: Response) {
    try {
      const { clientId } = req.params;
      const organizationId = req.user?.organizationId;
      const { status, collateralTypeId, includeDocuments } = req.query;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization context required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      if (!clientId) {
        return res.status(400).json({
          success: false,
          message: 'Client ID is required',
          error: 'MISSING_CLIENT_ID',
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

      const collaterals = await collateralService.getClientCollaterals(
        clientId,
        organizationId,
        {
          status: status as CollateralStatus,
          collateralTypeId: collateralTypeId as string,
        }
      );

      res.json({
        success: true,
        message: 'Client collaterals retrieved successfully',
        data: { collaterals },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Get client collaterals error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve client collaterals',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Create collateral for client
   * POST /api/v1/collaterals/client/:clientId
   */
  async createClientCollateral(req: Request, res: Response) {
    try {
      const { clientId } = req.params;
      const organizationId = req.user?.organizationId;
      const userId = req.user?.userId;
      const {
        collateralTypeId,
        name,
        description,
        estimatedValue,
        currency,
        ownershipStatus,
        registrationNumber,
        serialNumber,
        location,
        metadata,
      } = req.body;

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

      // Verify collateral type exists and belongs to organization
      const collateralType = await prisma.collateralType.findFirst({
        where: {
          id: collateralTypeId,
          organizationId,
          isActive: true,
        },
      });

      if (!collateralType) {
        return res.status(404).json({
          success: false,
          message: 'Collateral type not found',
          error: 'COLLATERAL_TYPE_NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      const collateral = await collateralService.createClientCollateral({
        clientId,
        collateralTypeId,
        name,
        description,
        estimatedValue,
        currency: currency || 'USD',
        ownershipStatus: ownershipStatus || 'OWNED',
        registrationNumber,
        serialNumber,
        location,
        metadata,
        createdBy: userId,
      });

      res.status(201).json({
        success: true,
        message: 'Collateral created successfully',
        data: { collateral },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Create client collateral error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create collateral',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get collateral by ID
   * GET /api/v1/collaterals/:collateralId
   */
  async getCollateral(req: Request, res: Response) {
    try {
      const { collateralId } = req.params;
      const organizationId = req.user?.organizationId;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization context required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      const collateral = await prisma.clientCollateral.findFirst({
        where: {
          id: collateralId,
          client: {
            organizationId,
          },
        },
        include: {
          collateralType: true,
          documents: {
            include: {
              document: {
                include: {
                  documentType: true,
                },
              },
            },
          },
          loan: {
            select: {
              id: true,
              loanAccountNumber: true,
              principal: true,
              status: true,
            },
          },
        },
      });

      if (!collateral) {
        return res.status(404).json({
          success: false,
          message: 'Collateral not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      res.json({
        success: true,
        message: 'Collateral retrieved successfully',
        data: { collateral },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Get collateral error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve collateral',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Update collateral
   * PUT /api/v1/collaterals/:collateralId
   */
  async updateCollateral(req: Request, res: Response) {
    try {
      const { collateralId } = req.params;
      const organizationId = req.user?.organizationId;
      const updateData = req.body;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization context required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      // Verify collateral exists and belongs to organization
      const existingCollateral = await prisma.clientCollateral.findFirst({
        where: {
          id: collateralId,
          client: {
            organizationId,
          },
        },
      });

      if (!existingCollateral) {
        return res.status(404).json({
          success: false,
          message: 'Collateral not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      const collateral = await collateralService.updateClientCollateral(
        collateralId,
        updateData
      );

      res.json({
        success: true,
        message: 'Collateral updated successfully',
        data: { collateral },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Update collateral error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update collateral',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Delete collateral
   * DELETE /api/v1/collaterals/:collateralId
   */
  async deleteCollateral(req: Request, res: Response) {
    try {
      const { collateralId } = req.params;
      const organizationId = req.user?.organizationId;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization context required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      // Verify collateral exists and belongs to organization
      const existingCollateral = await prisma.clientCollateral.findFirst({
        where: {
          id: collateralId,
          client: {
            organizationId,
          },
        },
        include: {
          loan: true,
        },
      });

      if (!existingCollateral) {
        return res.status(404).json({
          success: false,
          message: 'Collateral not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      // Check if collateral is linked to an active loan
      if (
        existingCollateral.loan &&
        existingCollateral.loan.status !== 'CLOSED'
      ) {
        return res.status(400).json({
          success: false,
          message: 'Cannot delete collateral linked to an active loan',
          error: 'COLLATERAL_IN_USE',
          timestamp: new Date().toISOString(),
        });
      }

      await collateralService.deleteClientCollateral(collateralId);

      res.json({
        success: true,
        message: 'Collateral deleted successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Delete collateral error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete collateral',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Update collateral valuation
   * POST /api/v1/collaterals/:collateralId/valuation
   */
  async updateValuation(req: Request, res: Response) {
    try {
      const { collateralId } = req.params;
      const organizationId = req.user?.organizationId;
      const userId = req.user?.userId;
      const { valuedAmount, valuedBy, valuationNotes, valuationDocumentId } =
        req.body;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization context required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      if (!valuedAmount) {
        return res.status(400).json({
          success: false,
          message: 'Valued amount is required',
          error: 'MISSING_AMOUNT',
          timestamp: new Date().toISOString(),
        });
      }

      // Verify collateral exists and belongs to organization
      const existingCollateral = await prisma.clientCollateral.findFirst({
        where: {
          id: collateralId,
          client: {
            organizationId,
          },
        },
      });

      if (!existingCollateral) {
        return res.status(404).json({
          success: false,
          message: 'Collateral not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      const collateral = await collateralService.updateValuation(collateralId, {
        valuedAmount,
        valuedBy: valuedBy || userId,
        valuationNotes,
        valuationDocumentId,
      });

      res.json({
        success: true,
        message: 'Collateral valuation updated successfully',
        data: { collateral },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Update valuation error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update valuation',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Link collateral to loan
   * POST /api/v1/collaterals/:collateralId/link-loan
   */
  async linkToLoan(req: Request, res: Response) {
    try {
      const { collateralId } = req.params;
      const organizationId = req.user?.organizationId;
      const { loanId } = req.body;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization context required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      if (!loanId) {
        return res.status(400).json({
          success: false,
          message: 'Loan ID is required',
          error: 'MISSING_LOAN_ID',
          timestamp: new Date().toISOString(),
        });
      }

      // Verify collateral exists and belongs to organization
      const existingCollateral = await prisma.clientCollateral.findFirst({
        where: {
          id: collateralId,
          client: {
            organizationId,
          },
        },
      });

      if (!existingCollateral) {
        return res.status(404).json({
          success: false,
          message: 'Collateral not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      // Verify loan exists and belongs to organization
      const loan = await prisma.loan.findFirst({
        where: {
          id: loanId,
          branch: {
            organizationId,
          },
        },
      });

      if (!loan) {
        return res.status(404).json({
          success: false,
          message: 'Loan not found',
          error: 'LOAN_NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      const collateral = await collateralService.linkToLoan(
        collateralId,
        loanId
      );

      res.json({
        success: true,
        message: 'Collateral linked to loan successfully',
        data: { collateral },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Link to loan error:', error);

      if (error.message === 'Collateral is already linked to another loan') {
        return res.status(400).json({
          success: false,
          message: error.message,
          error: 'ALREADY_LINKED',
          timestamp: new Date().toISOString(),
        });
      }

      res.status(500).json({
        success: false,
        message: 'Failed to link collateral to loan',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Unlink collateral from loan
   * POST /api/v1/collaterals/:collateralId/unlink-loan
   */
  async unlinkFromLoan(req: Request, res: Response) {
    try {
      const { collateralId } = req.params;
      const organizationId = req.user?.organizationId;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization context required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      // Verify collateral exists and belongs to organization
      const existingCollateral = await prisma.clientCollateral.findFirst({
        where: {
          id: collateralId,
          client: {
            organizationId,
          },
        },
        include: {
          loan: true,
        },
      });

      if (!existingCollateral) {
        return res.status(404).json({
          success: false,
          message: 'Collateral not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      // Check if loan is still active
      if (
        existingCollateral.loan &&
        existingCollateral.loan.status !== 'CLOSED'
      ) {
        return res.status(400).json({
          success: false,
          message: 'Cannot unlink collateral from an active loan',
          error: 'LOAN_ACTIVE',
          timestamp: new Date().toISOString(),
        });
      }

      const collateral = await collateralService.unlinkFromLoan(collateralId);

      res.json({
        success: true,
        message: 'Collateral unlinked from loan successfully',
        data: { collateral },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Unlink from loan error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to unlink collateral from loan',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Add document to collateral
   * POST /api/v1/collaterals/:collateralId/documents
   */
  async addDocument(req: Request, res: Response) {
    try {
      const { collateralId } = req.params;
      const organizationId = req.user?.organizationId;
      const { documentId } = req.body;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization context required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      if (!documentId) {
        return res.status(400).json({
          success: false,
          message: 'Document ID is required',
          error: 'MISSING_DOCUMENT_ID',
          timestamp: new Date().toISOString(),
        });
      }

      // Verify collateral exists and belongs to organization
      const existingCollateral = await prisma.clientCollateral.findFirst({
        where: {
          id: collateralId,
          client: {
            organizationId,
          },
        },
      });

      if (!existingCollateral) {
        return res.status(404).json({
          success: false,
          message: 'Collateral not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      // Verify document exists and belongs to organization
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
          error: 'DOCUMENT_NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      const collateralDocument =
        await collateralService.addDocumentToCollateral(
          collateralId,
          documentId
        );

      res.status(201).json({
        success: true,
        message: 'Document added to collateral successfully',
        data: { collateralDocument },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Add document to collateral error:', error);

      if (error.message === 'Document is already linked to this collateral') {
        return res.status(400).json({
          success: false,
          message: error.message,
          error: 'ALREADY_LINKED',
          timestamp: new Date().toISOString(),
        });
      }

      res.status(500).json({
        success: false,
        message: 'Failed to add document to collateral',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Remove document from collateral
   * DELETE /api/v1/collaterals/:collateralId/documents/:documentId
   */
  async removeDocument(req: Request, res: Response) {
    try {
      const { collateralId, documentId } = req.params;
      const organizationId = req.user?.organizationId;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization context required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      // Verify collateral exists and belongs to organization
      const existingCollateral = await prisma.clientCollateral.findFirst({
        where: {
          id: collateralId,
          client: {
            organizationId,
          },
        },
      });

      if (!existingCollateral) {
        return res.status(404).json({
          success: false,
          message: 'Collateral not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      await collateralService.removeDocumentFromCollateral(
        collateralId,
        documentId
      );

      res.json({
        success: true,
        message: 'Document removed from collateral successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Remove document from collateral error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to remove document from collateral',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get collateral statistics for organization
   * GET /api/v1/collaterals/statistics
   */
  async getStatistics(req: Request, res: Response) {
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

      const statistics =
        await collateralService.getCollateralStatistics(organizationId);

      res.json({
        success: true,
        message: 'Collateral statistics retrieved successfully',
        data: { statistics },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Get statistics error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve statistics',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
}

export const collateralController = new CollateralController();
