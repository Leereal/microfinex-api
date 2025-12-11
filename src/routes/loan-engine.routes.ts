/**
 * Loan Engine Routes
 *
 * API endpoints for loan engine operations:
 * - Running the loan calculation engine
 * - Getting engine statistics
 * - Viewing loans due for processing
 * - Manual loan status updates
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { loanEngineService } from '../services/loan-engine.service';
import { authenticate, requirePermission } from '../middleware/auth';
import { loadPermissions } from '../middleware/permissions';
import { PERMISSIONS } from '../constants/permissions';

const router = Router();

// ============================================
// VALIDATION SCHEMAS
// ============================================

const runEngineSchema = z.object({
  organizationId: z.string().uuid().optional(),
  dryRun: z.boolean().optional().default(false),
});

const disburseLoanSchema = z.object({
  paymentMethodId: z.string().uuid().optional(),
  disbursementDate: z.string().datetime().optional(),
  notes: z.string().optional(),
});

// ============================================
// ROUTES
// ============================================

/**
 * @swagger
 * /api/v1/loan-engine/run:
 *   post:
 *     summary: Run the loan calculation engine
 *     description: Process all eligible loans and update their statuses based on due dates and grace periods
 *     tags: [Loan Engine]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/run',
  authenticate,
  loadPermissions,
  requirePermission(PERMISSIONS.LOANS_DISBURSE),
  async (req: Request, res: Response) => {
    try {
      const { organizationId, dryRun } = runEngineSchema.parse(req.body);
      const orgId = organizationId || req.userContext?.organizationId;

      if (!orgId) {
        return res.status(400).json({
          success: false,
          message: 'Organization ID is required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }

      if (dryRun) {
        // Return loans that would be processed without actually processing them
        const loans = await loanEngineService.getLoansForProcessing(orgId);
        return res.json({
          success: true,
          message: 'Dry run completed - no changes made',
          data: {
            loansToProcess: loans.length,
            loans: loans.map((l) => ({
              id: l.id,
              loanNumber: l.loanNumber,
              status: l.status,
              nextDueDate: l.nextDueDate,
              expectedRepaymentDate: l.expectedRepaymentDate,
              outstandingBalance: l.outstandingBalance,
              client: `${l.client.firstName} ${l.client.lastName}`,
            })),
          },
          timestamp: new Date().toISOString(),
        });
      }

      const result = await loanEngineService.processShortTermLoans(orgId);

      res.json({
        success: true,
        message: `Engine run completed. Processed ${result.processedCount} loans`,
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Loan engine run error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Engine run failed',
        error: 'ENGINE_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/loan-engine/statistics:
 *   get:
 *     summary: Get loan engine statistics
 *     tags: [Loan Engine]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/statistics',
  authenticate,
  loadPermissions,
  async (req: Request, res: Response) => {
    try {
      const organizationId = req.userContext?.organizationId;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization ID is required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }

      const stats = await loanEngineService.getEngineStatistics(organizationId);

      res.json({
        success: true,
        message: 'Statistics retrieved successfully',
        data: stats,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Get statistics error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to get statistics',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/loan-engine/pending:
 *   get:
 *     summary: Get loans pending processing
 *     tags: [Loan Engine]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/pending',
  authenticate,
  loadPermissions,
  async (req: Request, res: Response) => {
    try {
      const organizationId = req.userContext?.organizationId;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization ID is required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }

      const loans = await loanEngineService.getLoansForProcessing(organizationId);

      res.json({
        success: true,
        message: `Found ${loans.length} loans pending processing`,
        data: {
          count: loans.length,
          loans: loans.map((l) => ({
            id: l.id,
            loanNumber: l.loanNumber,
            status: l.status,
            nextDueDate: l.nextDueDate,
            expectedRepaymentDate: l.expectedRepaymentDate,
            outstandingBalance: parseFloat(l.outstandingBalance.toString()),
            client: `${l.client.firstName} ${l.client.lastName}`,
            clientPhone: l.client.phone,
            product: l.product.name,
            branch: l.branch.name,
          })),
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Get pending loans error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to get pending loans',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/loan-engine/overdue:
 *   get:
 *     summary: Get overdue loans
 *     tags: [Loan Engine]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/overdue',
  authenticate,
  loadPermissions,
  async (req: Request, res: Response) => {
    try {
      const organizationId = req.userContext?.organizationId;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization ID is required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }

      const loans = await loanEngineService.getOverdueLoans(organizationId);

      res.json({
        success: true,
        message: `Found ${loans.length} overdue loans`,
        data: {
          count: loans.length,
          loans: loans.map((l) => ({
            id: l.id,
            loanNumber: l.loanNumber,
            status: l.status,
            nextDueDate: l.nextDueDate,
            expectedRepaymentDate: l.expectedRepaymentDate,
            outstandingBalance: parseFloat(l.outstandingBalance.toString()),
            daysOverdue: l.nextDueDate
              ? Math.floor((Date.now() - new Date(l.nextDueDate).getTime()) / (1000 * 60 * 60 * 24))
              : null,
            client: `${l.client.firstName} ${l.client.lastName}`,
            clientPhone: l.client.phone,
            product: l.product.name,
            branch: l.branch.name,
          })),
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Get overdue loans error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to get overdue loans',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/loan-engine/loans/{loanId}/disburse:
 *   post:
 *     summary: Disburse a loan using the engine
 *     description: Disburse a loan with interest calculation and automatic charge application
 *     tags: [Loan Engine]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/loans/:loanId/disburse',
  authenticate,
  loadPermissions,
  requirePermission(PERMISSIONS.LOANS_DISBURSE),
  async (req: Request, res: Response) => {
    try {
      const loanId = req.params.loanId;
      const userId = req.userContext?.id || req.user?.id;

      if (!loanId || !userId) {
        return res.status(400).json({
          success: false,
          message: 'Loan ID and user authentication required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }

      const body = disburseLoanSchema.parse(req.body);

      const result = await loanEngineService.disburseLoan({
        loanId,
        paymentMethodId: body.paymentMethodId,
        disbursementDate: body.disbursementDate ? new Date(body.disbursementDate) : undefined,
        disbursedBy: userId,
        notes: body.notes,
      });

      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: result.error,
          error: 'DISBURSEMENT_ERROR',
          timestamp: new Date().toISOString(),
        });
      }

      res.json({
        success: true,
        message: 'Loan disbursed successfully',
        data: {
          loan: result.loan,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Disburse loan error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Disbursement failed',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/loan-engine/settings:
 *   get:
 *     summary: Get engine settings for organization
 *     tags: [Loan Engine]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/settings',
  authenticate,
  loadPermissions,
  async (req: Request, res: Response) => {
    try {
      const organizationId = req.userContext?.organizationId;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization ID is required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }

      const settings = await loanEngineService.getEngineSettings(organizationId);

      res.json({
        success: true,
        message: 'Settings retrieved successfully',
        data: settings,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Get settings error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to get settings',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/loan-engine/loans/{loanId}/balance:
 *   get:
 *     summary: Get loan balance calculation
 *     tags: [Loan Engine]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/loans/:loanId/balance',
  authenticate,
  loadPermissions,
  async (req: Request, res: Response) => {
    try {
      const loanId = req.params.loanId;

      if (!loanId) {
        return res.status(400).json({
          success: false,
          message: 'Loan ID is required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }

      const balance = await loanEngineService.getLoanBalance(loanId);

      res.json({
        success: true,
        message: 'Balance calculated successfully',
        data: {
          loanId,
          balance: balance.toNumber(),
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Get balance error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to get balance',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

export default router;
