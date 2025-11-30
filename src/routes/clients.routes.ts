import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth-supabase';
import { validateRequest, validateQuery } from '../middleware/validation';
import { UserRole } from '../types';
import {
  clientService,
  createClientSchema,
  updateClientSchema,
  kycDocumentSchema,
  ClientSearchFilters,
} from '../services/client.service';

const router = Router();

// Query validation schemas
const searchQuerySchema = z.object({
  search: z.string().optional(),
  type: z.enum(['INDIVIDUAL', 'GROUP', 'BUSINESS']).optional(),
  kycStatus: z.enum(['PENDING', 'VERIFIED', 'REJECTED']).optional(),
  isActive: z
    .string()
    .transform(val => val === 'true')
    .optional(),
  branchId: z.string().uuid().optional(),
  employmentStatus: z
    .enum(['EMPLOYED', 'SELF_EMPLOYED', 'UNEMPLOYED', 'RETIRED', 'STUDENT'])
    .optional(),
  page: z
    .string()
    .transform(val => parseInt(val) || 1)
    .optional(),
  limit: z
    .string()
    .transform(val => Math.min(parseInt(val) || 10, 100))
    .optional(),
});

const kycStatusSchema = z.object({
  status: z.enum(['PENDING', 'VERIFIED', 'REJECTED']),
  notes: z.string().optional(),
});

/**
 * @swagger
 * /api/v1/clients:
 *   get:
 *     summary: Search and list clients
 *     tags: [Clients]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/',
  authenticate,
  validateQuery(searchQuerySchema),
  async (req, res) => {
    try {
      const organizationId = req.userContext?.organizationId;
      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization ID required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      const filters: ClientSearchFilters = {
        search: req.query.search as string,
        type: req.query.type as any,
        kycStatus: req.query.kycStatus as any,
        isActive:
          typeof req.query.isActive === 'string'
            ? req.query.isActive === 'true'
            : undefined,
        branchId: req.query.branchId as string,
        employmentStatus: req.query.employmentStatus as any,
        page:
          typeof req.query.page === 'string'
            ? parseInt(req.query.page) || 1
            : 1,
        limit:
          typeof req.query.limit === 'string'
            ? Math.min(parseInt(req.query.limit) || 10, 100)
            : 10,
      };

      const result = await clientService.searchClients(filters, organizationId);

      res.json({
        success: true,
        message: 'Clients retrieved successfully',
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Search clients error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/clients:
 *   post:
 *     summary: Create new client
 *     tags: [Clients]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/',
  authenticate,
  authorize(UserRole.MANAGER, UserRole.STAFF),
  validateRequest(createClientSchema),
  async (req, res) => {
    try {
      const organizationId = req.userContext?.organizationId;
      const createdBy = req.userContext?.id;

      if (!organizationId || !createdBy) {
        return res.status(400).json({
          success: false,
          message: 'Organization ID and user ID required',
          error: 'MISSING_CONTEXT',
          timestamp: new Date().toISOString(),
        });
      }

      const client = await clientService.createClient(
        req.body,
        organizationId,
        createdBy
      );

      res.status(201).json({
        success: true,
        message: 'Client created successfully',
        data: { client },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Create client error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/clients/{clientId}:
 *   get:
 *     summary: Get client by ID
 *     tags: [Clients]
 *     security:
 *       - bearerAuth: []
 */
router.get('/:clientId', authenticate, async (req, res) => {
  try {
    const clientId = req.params.clientId!;
    const organizationId = req.userContext?.organizationId;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'Organization ID required',
        error: 'MISSING_ORGANIZATION',
        timestamp: new Date().toISOString(),
      });
    }

    const client = await clientService.getClientById(
      clientId!,
      organizationId!
    );

    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client not found',
        error: 'CLIENT_NOT_FOUND',
        timestamp: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      message: 'Client retrieved successfully',
      data: { client },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Get client error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @swagger
 * /api/v1/clients/{clientId}:
 *   put:
 *     summary: Update client
 *     tags: [Clients]
 *     security:
 *       - bearerAuth: []
 */
router.put(
  '/:clientId',
  authenticate,
  authorize(UserRole.MANAGER, UserRole.STAFF),
  validateRequest(updateClientSchema),
  async (req, res) => {
    try {
      const clientId = req.params.clientId!;
      const organizationId = req.userContext?.organizationId;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization ID required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      const client = await clientService.updateClient(
        clientId!,
        req.body,
        organizationId!
      );

      res.json({
        success: true,
        message: 'Client updated successfully',
        data: { client },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Update client error:', error);
      if ((error as any).code === 'P2025') {
        return res.status(404).json({
          success: false,
          message: 'Client not found',
          error: 'CLIENT_NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/clients/{clientId}/kyc-status:
 *   patch:
 *     summary: Update client KYC status
 *     tags: [Clients]
 *     security:
 *       - bearerAuth: []
 */
router.patch(
  '/:clientId/kyc-status',
  authenticate,
  authorize(UserRole.MANAGER, UserRole.ADMIN),
  validateRequest(kycStatusSchema),
  async (req, res) => {
    try {
      const clientId = req.params.clientId!;
      const { status, notes } = req.body;
      const organizationId = req.userContext?.organizationId;
      const verifiedBy = req.userContext?.id;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization ID required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      const client = await clientService.updateKYCStatus(
        clientId!,
        status,
        organizationId!,
        verifiedBy,
        notes
      );

      res.json({
        success: true,
        message: 'KYC status updated successfully',
        data: { client },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Update KYC status error:', error);
      if ((error as any).code === 'P2025') {
        return res.status(404).json({
          success: false,
          message: 'Client not found',
          error: 'CLIENT_NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/clients/{clientId}/kyc-documents:
 *   post:
 *     summary: Add KYC document to client
 *     tags: [Clients]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/:clientId/kyc-documents',
  authenticate,
  authorize(UserRole.MANAGER, UserRole.STAFF),
  validateRequest(kycDocumentSchema),
  async (req, res) => {
    try {
      const clientId = req.params.clientId!;
      const organizationId = req.userContext?.organizationId;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization ID required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      const client = await clientService.addKYCDocument(
        clientId!,
        req.body,
        organizationId!
      );

      res.status(201).json({
        success: true,
        message: 'KYC document added successfully',
        data: { client },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Add KYC document error:', error);
      if ((error as any).message === 'Client not found') {
        return res.status(404).json({
          success: false,
          message: 'Client not found',
          error: 'CLIENT_NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/clients/statistics:
 *   get:
 *     summary: Get client statistics
 *     tags: [Clients]
 *     security:
 *       - bearerAuth: []
 */
router.get('/statistics/summary', authenticate, async (req, res) => {
  try {
    const organizationId = req.userContext?.organizationId;
    const branchId = req.query.branchId as string;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'Organization ID required',
        error: 'MISSING_ORGANIZATION',
        timestamp: new Date().toISOString(),
      });
    }

    const statistics = await clientService.getClientStatistics(
      organizationId,
      branchId
    );

    res.json({
      success: true,
      message: 'Client statistics retrieved successfully',
      data: { statistics },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Get client statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
