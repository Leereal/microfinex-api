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
import { logCreate } from '../services/audit.service';

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

// ============================================
// SUPER ADMIN ROUTES - Global Client Management
// These must be defined BEFORE /:clientId routes
// ============================================

/**
 * @swagger
 * /api/v1/clients/admin/all:
 *   get:
 *     summary: Get all clients across all organizations (Super Admin only)
 *     tags: [Clients - Super Admin]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/admin/all',
  authenticate,
  authorize(UserRole.SUPER_ADMIN),
  async (req, res) => {
    try {
      const filters = {
        search: req.query.search as string | undefined,
        organizationId: req.query.organizationId as string | undefined,
        isActive:
          req.query.isActive === 'true'
            ? true
            : req.query.isActive === 'false'
              ? false
              : undefined,
        page: req.query.page ? parseInt(req.query.page as string) : 1,
        limit: req.query.limit
          ? Math.min(parseInt(req.query.limit as string), 100)
          : 50,
      };

      const result = await clientService.getAllClientsGlobal(filters);

      res.json({
        success: true,
        message: 'All clients retrieved successfully',
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Get all clients error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/clients/admin/bulk/permanent:
 *   delete:
 *     summary: Bulk permanently delete inactive clients (Super Admin only)
 *     tags: [Clients - Super Admin]
 *     security:
 *       - bearerAuth: []
 */
router.delete(
  '/admin/bulk/permanent',
  authenticate,
  authorize(UserRole.SUPER_ADMIN),
  async (req, res) => {
    try {
      const { clientIds } = req.body;

      if (!clientIds || !Array.isArray(clientIds) || clientIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Client IDs array is required',
          error: 'MISSING_CLIENT_IDS',
          timestamp: new Date().toISOString(),
        });
      }

      const result =
        await clientService.bulkPermanentlyDeleteClientsGlobal(clientIds);

      res.json({
        success: true,
        message: `Deleted ${result.deleted.length} of ${clientIds.length} clients`,
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Super admin bulk delete error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/clients/admin/{clientId}:
 *   delete:
 *     summary: Permanently delete a client (Super Admin only)
 *     tags: [Clients - Super Admin]
 *     security:
 *       - bearerAuth: []
 */
router.delete(
  '/admin/:clientId',
  authenticate,
  authorize(UserRole.SUPER_ADMIN),
  async (req, res) => {
    try {
      const { clientId } = req.params;

      await clientService.permanentlyDeleteClientGlobal(clientId);

      res.json({
        success: true,
        message: 'Client permanently deleted',
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Super admin delete client error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

// ============================================
// END SUPER ADMIN ROUTES
// ============================================

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
  authorize(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.STAFF
  ),
  validateRequest(createClientSchema),
  async (req, res) => {
    try {
      const organizationId = req.userContext?.organizationId;
      const createdBy = req.userContext?.id;
      const branchId = (req.userContext as any)?.branchId || req.body.branchId;

      console.log(
        '[Client Create] Request body:',
        JSON.stringify(req.body, null, 2)
      );
      console.log('[Client Create] User context:', {
        organizationId,
        createdBy,
        branchId,
      });

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

      // Explicit audit logging for client creation
      try {
        await logCreate('CLIENT', client.id, client, {
          userId: createdBy,
          organizationId,
          branchId: req.body.branchId || branchId,
          ipAddress: req.ip || (req.headers['x-forwarded-for'] as string),
          userAgent: req.headers['user-agent'] as string,
          requestId: req.auditContext?.requestId,
        });
        console.log('[Client Create] Audit log created for client:', client.id);
      } catch (auditError) {
        console.error('[Client Create] Audit logging failed:', auditError);
        // Don't fail the request if audit logging fails
      }

      res.status(201).json({
        success: true,
        message: 'Client created successfully',
        data: { client },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Create client error:', error);

      // Handle specific Prisma errors
      if (error.code === 'P2002') {
        // Unique constraint violation
        const field = error.meta?.target?.[0] || 'field';
        return res.status(409).json({
          success: false,
          message: `A client with this ${field} already exists`,
          error: 'DUPLICATE_ENTRY',
          field,
          timestamp: new Date().toISOString(),
        });
      }

      if (error.code === 'P2003') {
        // Foreign key constraint failure
        return res.status(400).json({
          success: false,
          message:
            'Invalid reference: branch or other related entity not found',
          error: 'INVALID_REFERENCE',
          timestamp: new Date().toISOString(),
        });
      }

      // Handle duplicate phone number error
      if (
        error.message &&
        error.message.includes('phone number already exists')
      ) {
        return res.status(409).json({
          success: false,
          message: error.message,
          error: 'DUPLICATE_PHONE',
          field: 'phone',
          timestamp: new Date().toISOString(),
        });
      }

      // Handle duplicate ID number error
      if (error.message && error.message.includes('ID number already exists')) {
        return res.status(409).json({
          success: false,
          message: error.message,
          error: 'DUPLICATE_ID_NUMBER',
          field: 'idNumber',
          timestamp: new Date().toISOString(),
        });
      }

      res.status(500).json({
        success: false,
        message: error.message || 'Internal server error',
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
  authorize(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER
  ),
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

/**
 * @swagger
 * /api/v1/clients/{clientId}:
 *   delete:
 *     summary: Delete (deactivate) a client
 *     tags: [Clients]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: clientId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Client deleted successfully
 *       400:
 *         description: Cannot delete client with active loans
 *       404:
 *         description: Client not found
 */
router.delete(
  '/:clientId',
  authenticate,
  authorize(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER
  ),
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

      const client = await clientService.deleteClient(clientId, organizationId);

      res.json({
        success: true,
        message: 'Client deleted successfully',
        data: { client },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Delete client error:', error);

      if (error.message === 'Cannot delete client with active loans') {
        return res.status(400).json({
          success: false,
          message: error.message,
          error: 'ACTIVE_LOANS_EXIST',
          timestamp: new Date().toISOString(),
        });
      }

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
 * /api/v1/clients/{clientId}/permanent:
 *   delete:
 *     summary: Permanently delete a client (SUPER_ADMIN only)
 *     description: Permanently removes a client and all related data. Client must be inactive and have no loan history.
 *     tags: [Clients]
 *     security:
 *       - bearerAuth: []
 */
router.delete(
  '/:clientId/permanent',
  authenticate,
  authorize(UserRole.SUPER_ADMIN),
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

      // Check if client is inactive first
      const client = await clientService.getClientById(
        clientId,
        organizationId
      );
      if (!client) {
        return res.status(404).json({
          success: false,
          message: 'Client not found',
          error: 'CLIENT_NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      if (client.isActive) {
        return res.status(400).json({
          success: false,
          message:
            'Cannot permanently delete an active client. Deactivate the client first.',
          error: 'CLIENT_STILL_ACTIVE',
          timestamp: new Date().toISOString(),
        });
      }

      await clientService.permanentlyDeleteClient(clientId, organizationId);

      res.json({
        success: true,
        message: 'Client permanently deleted',
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Permanent delete client error:', error);

      if (
        error.message === 'Cannot permanently delete client with loan history'
      ) {
        return res.status(400).json({
          success: false,
          message: error.message,
          error: 'HAS_LOAN_HISTORY',
          timestamp: new Date().toISOString(),
        });
      }

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
        message: error.message || 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/clients/bulk/permanent:
 *   delete:
 *     summary: Bulk permanently delete inactive clients (SUPER_ADMIN only)
 *     description: Permanently removes multiple inactive clients. Only clients without loan history will be deleted.
 *     tags: [Clients]
 *     security:
 *       - bearerAuth: []
 */
router.delete(
  '/bulk/permanent',
  authenticate,
  authorize(UserRole.SUPER_ADMIN),
  async (req, res) => {
    try {
      const organizationId = req.userContext?.organizationId;
      const { clientIds } = req.body;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization ID required',
          error: 'MISSING_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      if (!clientIds || !Array.isArray(clientIds) || clientIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Client IDs array is required',
          error: 'MISSING_CLIENT_IDS',
          timestamp: new Date().toISOString(),
        });
      }

      const results = {
        deleted: [] as string[],
        failed: [] as { id: string; reason: string }[],
      };

      for (const clientId of clientIds) {
        try {
          // Check if client exists and is inactive
          const client = await clientService.getClientById(
            clientId,
            organizationId
          );

          if (!client) {
            results.failed.push({ id: clientId, reason: 'Client not found' });
            continue;
          }

          if (client.isActive) {
            results.failed.push({
              id: clientId,
              reason: 'Client is still active',
            });
            continue;
          }

          await clientService.permanentlyDeleteClient(clientId, organizationId);
          results.deleted.push(clientId);
        } catch (error: any) {
          results.failed.push({
            id: clientId,
            reason: error.message || 'Unknown error',
          });
        }
      }

      res.json({
        success: true,
        message: `Deleted ${results.deleted.length} of ${clientIds.length} clients`,
        data: results,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Bulk permanent delete error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

export default router;
