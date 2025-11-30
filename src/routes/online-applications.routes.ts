import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth-supabase';
import { validateRequest } from '../middleware/validation';
import { UserRole } from '../types';
import { onlineApplicationService } from '../services/online-application.service';

const router = Router();

// ===== VALIDATION SCHEMAS =====

const createApplicationSchema = z.object({
  source: z.enum(['BRANCH', 'WEB', 'WHATSAPP', 'FACEBOOK']),
  applicationType: z.enum(['NEW', 'EXISTING']),
  clientPhone: z.string().min(1),
  clientName: z.string().optional(),
  idNumber: z.string().optional(),
  amount: z.number().positive(),
  productId: z.string().uuid(),
  disbursementPreference: z.enum(['CASH', 'TRANSFER']),
  bankAccount: z.string().optional(),
  mobileNumber: z.string().optional(),
  notes: z.string().optional(),
});

const updateApplicationSchema = z.object({
  clientName: z.string().optional(),
  idNumber: z.string().optional(),
  amount: z.number().positive().optional(),
  productId: z.string().uuid().optional(),
  disbursementPreference: z.enum(['CASH', 'TRANSFER']).optional(),
  bankAccount: z.string().optional(),
  mobileNumber: z.string().optional(),
  notes: z.string().optional(),
});

const verifyApplicationSchema = z.object({
  code: z.string().length(6),
});

const processApplicationSchema = z.object({
  action: z.enum(['approve', 'reject']),
  notes: z.string().optional(),
});

const convertToLoanSchema = z.object({
  clientId: z.string().uuid(),
  loanOfficerId: z.string().uuid(), // Required
  branchId: z.string().uuid(), // Required
  interestRate: z.number().positive(),
  term: z.number().int().positive(),
  repaymentFrequency: z.enum([
    'DAILY',
    'WEEKLY',
    'BIWEEKLY',
    'MONTHLY',
    'QUARTERLY',
    'SEMI_ANNUAL',
    'ANNUAL',
  ]),
  purpose: z.string().optional(),
});

const bulkStatusSchema = z.object({
  applicationIds: z.array(z.string().uuid()).min(1),
  status: z.enum(['PENDING', 'VERIFIED', 'PROCESSED', 'EXPIRED', 'REJECTED']),
  notes: z.string().optional(),
});

// ===== ROUTES =====

/**
 * @swagger
 * /api/v1/online-applications:
 *   post:
 *     summary: Create online application (public endpoint for web forms/webhooks)
 */
router.post('/', validateRequest(createApplicationSchema), async (req, res) => {
  try {
    const application = await onlineApplicationService.createApplication(
      req.body
    );

    res.status(201).json({
      success: true,
      message:
        'Application submitted successfully. Please verify with the code sent to your phone.',
      data: {
        application: {
          id: application.id,
          status: application.status,
          verificationExpiry: application.verificationExpiry,
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Create application error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
      error: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @swagger
 * /api/v1/online-applications:
 *   get:
 *     summary: Get all online applications
 */
router.get(
  '/',
  authenticate,
  authorize(UserRole.STAFF, UserRole.MANAGER, UserRole.ADMIN),
  async (req, res) => {
    try {
      const {
        search,
        source,
        applicationType,
        status,
        productId,
        startDate,
        endDate,
        page,
        limit,
      } = req.query;

      const filters = {
        search: search as string | undefined,
        source: source as
          | 'BRANCH'
          | 'WEB'
          | 'WHATSAPP'
          | 'FACEBOOK'
          | undefined,
        applicationType: applicationType as 'NEW' | 'EXISTING' | undefined,
        status: status as
          | 'PENDING'
          | 'VERIFIED'
          | 'PROCESSED'
          | 'EXPIRED'
          | 'REJECTED'
          | undefined,
        productId: productId as string | undefined,
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
        page: page ? parseInt(page as string) : undefined,
        limit: limit ? parseInt(limit as string) : undefined,
      };

      const result = await onlineApplicationService.getApplications(filters);

      res.json({
        success: true,
        message: 'Applications retrieved successfully',
        ...result,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Get applications error:', error);
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
 * /api/v1/online-applications/stats:
 *   get:
 *     summary: Get application statistics
 */
router.get(
  '/stats',
  authenticate,
  authorize(UserRole.MANAGER, UserRole.ADMIN),
  async (req, res) => {
    try {
      const { startDate, endDate } = req.query;

      const stats = await onlineApplicationService.getApplicationStats(
        startDate ? new Date(startDate as string) : undefined,
        endDate ? new Date(endDate as string) : undefined
      );

      res.json({
        success: true,
        message: 'Statistics retrieved successfully',
        data: { stats },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Get stats error:', error);
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
 * /api/v1/online-applications/expired:
 *   get:
 *     summary: Get expired applications
 */
router.get(
  '/expired',
  authenticate,
  authorize(UserRole.STAFF, UserRole.MANAGER, UserRole.ADMIN),
  async (req, res) => {
    try {
      const applications =
        await onlineApplicationService.getExpiredApplications();

      res.json({
        success: true,
        message: 'Expired applications retrieved successfully',
        data: { applications },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Get expired applications error:', error);
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
 * /api/v1/online-applications/expire-pending:
 *   post:
 *     summary: Expire all pending applications with expired verification codes
 */
router.post(
  '/expire-pending',
  authenticate,
  authorize(UserRole.MANAGER, UserRole.ADMIN),
  async (req, res) => {
    try {
      const result = await onlineApplicationService.expirePendingApplications();

      res.json({
        success: true,
        message: `${result.count} applications expired`,
        data: { count: result.count },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Expire pending error:', error);
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
 * /api/v1/online-applications/bulk-status:
 *   put:
 *     summary: Bulk update application status
 */
router.put(
  '/bulk-status',
  authenticate,
  authorize(UserRole.MANAGER, UserRole.ADMIN),
  validateRequest(bulkStatusSchema),
  async (req, res) => {
    try {
      const { applicationIds, status, notes } = req.body;

      const result = await onlineApplicationService.bulkUpdateStatus(
        applicationIds,
        status,
        notes
      );

      res.json({
        success: true,
        message: `${result.count} applications updated`,
        data: { count: result.count },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Bulk status update error:', error);
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
 * /api/v1/online-applications/check-phone/{phone}:
 *   get:
 *     summary: Check for existing applications by phone (public endpoint)
 */
router.get('/check-phone/:phone', async (req, res) => {
  try {
    const phone = req.params.phone;
    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required',
        error: 'BAD_REQUEST',
        timestamp: new Date().toISOString(),
      });
    }

    const application =
      await onlineApplicationService.getApplicationByPhone(phone);

    res.json({
      success: true,
      message: application
        ? 'Existing application found'
        : 'No existing application',
      data: {
        hasExisting: !!application,
        status: application?.status,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Check phone error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
      error: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @swagger
 * /api/v1/online-applications/{id}:
 *   get:
 *     summary: Get application by ID
 */
router.get('/:id', authenticate, async (req, res) => {
  try {
    const applicationId = req.params.id;
    if (!applicationId) {
      return res.status(400).json({
        success: false,
        message: 'Application ID is required',
        error: 'BAD_REQUEST',
        timestamp: new Date().toISOString(),
      });
    }

    const application =
      await onlineApplicationService.getApplicationById(applicationId);
    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found',
        error: 'NOT_FOUND',
        timestamp: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      message: 'Application retrieved successfully',
      data: { application },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Get application error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
      error: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @swagger
 * /api/v1/online-applications/{id}:
 *   put:
 *     summary: Update application
 */
router.put(
  '/:id',
  authenticate,
  authorize(UserRole.STAFF, UserRole.MANAGER, UserRole.ADMIN),
  validateRequest(updateApplicationSchema),
  async (req, res) => {
    try {
      const applicationId = req.params.id;
      if (!applicationId) {
        return res.status(400).json({
          success: false,
          message: 'Application ID is required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }

      const application = await onlineApplicationService.updateApplication(
        applicationId,
        req.body
      );
      if (!application) {
        return res.status(404).json({
          success: false,
          message: 'Application not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      res.json({
        success: true,
        message: 'Application updated successfully',
        data: { application },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Update application error:', error);
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
 * /api/v1/online-applications/{id}/verify:
 *   post:
 *     summary: Verify application with code (public endpoint)
 */
router.post(
  '/:id/verify',
  validateRequest(verifyApplicationSchema),
  async (req, res) => {
    try {
      const applicationId = req.params.id;
      if (!applicationId) {
        return res.status(400).json({
          success: false,
          message: 'Application ID is required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }

      const application = await onlineApplicationService.verifyApplication(
        applicationId,
        req.body.code
      );
      if (!application) {
        return res.status(404).json({
          success: false,
          message: 'Application not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      res.json({
        success: true,
        message: 'Application verified successfully',
        data: { application },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Verify application error:', error);
      if (
        error.message.includes('Invalid verification') ||
        error.message.includes('expired')
      ) {
        return res.status(400).json({
          success: false,
          message: error.message,
          error: 'VALIDATION_ERROR',
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
 * /api/v1/online-applications/{id}/resend-code:
 *   post:
 *     summary: Resend verification code (public endpoint)
 */
router.post('/:id/resend-code', async (req, res) => {
  try {
    const applicationId = req.params.id;
    if (!applicationId) {
      return res.status(400).json({
        success: false,
        message: 'Application ID is required',
        error: 'BAD_REQUEST',
        timestamp: new Date().toISOString(),
      });
    }

    const application =
      await onlineApplicationService.resendVerificationCode(applicationId);
    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found',
        error: 'NOT_FOUND',
        timestamp: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      message: 'Verification code resent successfully',
      data: {
        id: application.id,
        verificationExpiry: application.verificationExpiry,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Resend code error:', error);
    if (error.message.includes('not in pending')) {
      return res.status(400).json({
        success: false,
        message: error.message,
        error: 'VALIDATION_ERROR',
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
});

/**
 * @swagger
 * /api/v1/online-applications/{id}/process:
 *   post:
 *     summary: Process application (approve/reject)
 */
router.post(
  '/:id/process',
  authenticate,
  authorize(UserRole.MANAGER, UserRole.ADMIN),
  validateRequest(processApplicationSchema),
  async (req, res) => {
    try {
      const applicationId = req.params.id;
      if (!applicationId) {
        return res.status(400).json({
          success: false,
          message: 'Application ID is required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }

      const application = await onlineApplicationService.processApplication(
        applicationId,
        req.body.action,
        req.body.notes
      );
      if (!application) {
        return res.status(404).json({
          success: false,
          message: 'Application not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      res.json({
        success: true,
        message: `Application ${req.body.action === 'approve' ? 'approved' : 'rejected'} successfully`,
        data: { application },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Process application error:', error);
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
 * /api/v1/online-applications/{id}/convert-to-loan:
 *   post:
 *     summary: Convert application to loan
 */
router.post(
  '/:id/convert-to-loan',
  authenticate,
  authorize(UserRole.MANAGER, UserRole.ADMIN),
  validateRequest(convertToLoanSchema),
  async (req, res) => {
    try {
      const applicationId = req.params.id;
      const organizationId = req.user?.organizationId;

      if (!applicationId) {
        return res.status(400).json({
          success: false,
          message: 'Application ID is required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }

      if (!organizationId) {
        return res.status(403).json({
          success: false,
          message: 'Organization context required',
          error: 'FORBIDDEN',
          timestamp: new Date().toISOString(),
        });
      }

      const result = await onlineApplicationService.convertToLoan(
        applicationId,
        {
          ...req.body,
          organizationId,
        }
      );
      if (!result) {
        return res.status(404).json({
          success: false,
          message: 'Application not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      res.status(201).json({
        success: true,
        message: 'Loan created from application successfully',
        data: {
          application: result.application,
          loanId: result.loanId,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Convert to loan error:', error);
      if (error.message.includes('must be verified')) {
        return res.status(400).json({
          success: false,
          message: error.message,
          error: 'VALIDATION_ERROR',
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
 * /api/v1/online-applications/{id}:
 *   delete:
 *     summary: Delete application
 */
router.delete(
  '/:id',
  authenticate,
  authorize(UserRole.ADMIN),
  async (req, res) => {
    try {
      const applicationId = req.params.id;
      if (!applicationId) {
        return res.status(400).json({
          success: false,
          message: 'Application ID is required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }

      const deleted =
        await onlineApplicationService.deleteApplication(applicationId);
      if (!deleted) {
        return res.status(404).json({
          success: false,
          message: 'Application not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      res.status(204).send();
    } catch (error: any) {
      console.error('Delete application error:', error);
      if (error.message.includes('Cannot delete')) {
        return res.status(400).json({
          success: false,
          message: error.message,
          error: 'VALIDATION_ERROR',
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

export default router;
