import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth-supabase';
import { validateRequest } from '../middleware/validation';
import { UserRole } from '../types';
import {
  loanAssessmentService,
  loanVisitService,
  securityPledgeService,
  loanWorkflowHistoryService,
  loanStatusTransitionService,
  categoryAwareWorkflowEngine,
} from '../services/loan-workflow.service';

const router = Router();

// ============================================
// LOAN ASSESSMENT ROUTES
// ============================================

const createAssessmentSchema = z.object({
  loanId: z.string().uuid(),
  documentChecklist: z.record(z.boolean()).optional(),
  notes: z.string().optional(),
});

const updateAssessmentSchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  documentChecklist: z.record(z.boolean()).optional(),
  notes: z.string().optional(),
});

/**
 * @swagger
 * /api/v1/loan-workflow/assessments:
 *   post:
 *     summary: Create loan assessment
 */
router.post(
  '/assessments',
  authenticate,
  authorize(UserRole.STAFF, UserRole.MANAGER, UserRole.ADMIN),
  validateRequest(createAssessmentSchema),
  async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'User not authenticated',
          error: 'UNAUTHORIZED',
          timestamp: new Date().toISOString(),
        });
      }

      const assessment = await loanAssessmentService.create({
        ...req.body,
        assessorId: userId,
      });

      res.status(201).json({
        success: true,
        message: 'Assessment created successfully',
        data: { assessment },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Create assessment error:', error);
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
 * /api/v1/loan-workflow/assessments/pending:
 *   get:
 *     summary: Get pending assessments
 */
router.get('/assessments/pending', authenticate, async (req, res) => {
  try {
    const userId = req.user?.userId;
    const { mine } = req.query;

    const assessments = await loanAssessmentService.getPendingAssessments(
      mine === 'true' ? userId : undefined
    );

    res.json({
      success: true,
      message: 'Pending assessments retrieved successfully',
      data: { assessments },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Get pending assessments error:', error);
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
 * /api/v1/loan-workflow/assessments/{id}:
 *   get:
 *     summary: Get single assessment
 */
router.get('/assessments/:id', authenticate, async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Assessment ID is required',
        error: 'BAD_REQUEST',
        timestamp: new Date().toISOString(),
      });
    }
    const assessment = await loanAssessmentService.get(id);

    if (!assessment) {
      return res.status(404).json({
        success: false,
        message: 'Assessment not found',
        error: 'NOT_FOUND',
        timestamp: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      message: 'Assessment retrieved successfully',
      data: { assessment },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Get assessment error:', error);
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
 * /api/v1/loan-workflow/assessments/{id}:
 *   put:
 *     summary: Update assessment
 */
router.put(
  '/assessments/:id',
  authenticate,
  authorize(UserRole.STAFF, UserRole.MANAGER, UserRole.ADMIN),
  validateRequest(updateAssessmentSchema),
  async (req, res) => {
    try {
      const id = req.params.id;
      if (!id) {
        return res.status(400).json({
          success: false,
          message: 'Assessment ID is required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }
      const assessment = await loanAssessmentService.update(id, req.body);

      res.json({
        success: true,
        message: 'Assessment updated successfully',
        data: { assessment },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Update assessment error:', error);
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
 * /api/v1/loan-workflow/loans/{loanId}/assessments:
 *   get:
 *     summary: Get assessments for a loan
 */
router.get('/loans/:loanId/assessments', authenticate, async (req, res) => {
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
    const assessments = await loanAssessmentService.getByLoan(loanId);

    res.json({
      success: true,
      message: 'Loan assessments retrieved successfully',
      data: { assessments },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Get loan assessments error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

// ============================================
// LOAN VISIT ROUTES
// ============================================

const createVisitSchema = z.object({
  loanId: z.string().uuid(),
  visitType: z.enum(['BUSINESS', 'HOME']),
  address: z.string().optional(),
  gpsLat: z.number().optional(),
  gpsLng: z.number().optional(),
  visitedAt: z.string().datetime().optional(),
  images: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

const updateVisitSchema = z.object({
  address: z.string().optional(),
  gpsLat: z.number().optional(),
  gpsLng: z.number().optional(),
  visitedAt: z.string().datetime().optional(),
  images: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

/**
 * @swagger
 * /api/v1/loan-workflow/visits:
 *   post:
 *     summary: Create loan visit
 */
router.post(
  '/visits',
  authenticate,
  authorize(UserRole.STAFF, UserRole.MANAGER, UserRole.ADMIN),
  validateRequest(createVisitSchema),
  async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'User not authenticated',
          error: 'UNAUTHORIZED',
          timestamp: new Date().toISOString(),
        });
      }

      const visit = await loanVisitService.create({
        ...req.body,
        visitedBy: userId,
        visitedAt: req.body.visitedAt
          ? new Date(req.body.visitedAt)
          : undefined,
      });

      res.status(201).json({
        success: true,
        message: 'Visit created successfully',
        data: { visit },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Create visit error:', error);
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
 * /api/v1/loan-workflow/visits/pending:
 *   get:
 *     summary: Get pending visits
 */
router.get('/visits/pending', authenticate, async (req, res) => {
  try {
    const userId = req.user?.userId;
    const { mine } = req.query;

    const visits = await loanVisitService.getPendingVisits(
      mine === 'true' ? userId : undefined
    );

    res.json({
      success: true,
      message: 'Pending visits retrieved successfully',
      data: { visits },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Get pending visits error:', error);
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
 * /api/v1/loan-workflow/visits/{id}:
 *   get:
 *     summary: Get single visit
 */
router.get('/visits/:id', authenticate, async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Visit ID is required',
        error: 'BAD_REQUEST',
        timestamp: new Date().toISOString(),
      });
    }
    const visit = await loanVisitService.get(id);

    if (!visit) {
      return res.status(404).json({
        success: false,
        message: 'Visit not found',
        error: 'NOT_FOUND',
        timestamp: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      message: 'Visit retrieved successfully',
      data: { visit },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Get visit error:', error);
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
 * /api/v1/loan-workflow/visits/{id}:
 *   put:
 *     summary: Update visit
 */
router.put(
  '/visits/:id',
  authenticate,
  authorize(UserRole.STAFF, UserRole.MANAGER, UserRole.ADMIN),
  validateRequest(updateVisitSchema),
  async (req, res) => {
    try {
      const id = req.params.id;
      if (!id) {
        return res.status(400).json({
          success: false,
          message: 'Visit ID is required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }
      const visit = await loanVisitService.update(id, {
        ...req.body,
        visitedAt: req.body.visitedAt
          ? new Date(req.body.visitedAt)
          : undefined,
      });

      res.json({
        success: true,
        message: 'Visit updated successfully',
        data: { visit },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Update visit error:', error);
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
 * /api/v1/loan-workflow/visits/{id}/sync:
 *   post:
 *     summary: Sync offline visit data
 */
router.post(
  '/visits/:id/sync',
  authenticate,
  validateRequest(updateVisitSchema),
  async (req, res) => {
    try {
      const id = req.params.id;
      if (!id) {
        return res.status(400).json({
          success: false,
          message: 'Visit ID is required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }
      const visit = await loanVisitService.syncVisit(id, {
        ...req.body,
        visitedAt: req.body.visitedAt
          ? new Date(req.body.visitedAt)
          : undefined,
      });

      res.json({
        success: true,
        message: 'Visit synced successfully',
        data: { visit },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Sync visit error:', error);
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
 * /api/v1/loan-workflow/loans/{loanId}/visits:
 *   get:
 *     summary: Get visits for a loan
 */
router.get('/loans/:loanId/visits', authenticate, async (req, res) => {
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
    const visits = await loanVisitService.getByLoan(loanId);

    res.json({
      success: true,
      message: 'Loan visits retrieved successfully',
      data: { visits },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Get loan visits error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

// ============================================
// SECURITY PLEDGE ROUTES
// ============================================

const createPledgeSchema = z.object({
  loanId: z.string().uuid(),
  itemDescription: z.string().min(1),
  serialNumber: z.string().optional(),
  estimatedValue: z.number().positive(),
  currency: z.enum(['ZWG', 'USD', 'ZAR']).optional(),
  images: z.array(z.string()).optional(),
});

const updatePledgeSchema = z.object({
  itemDescription: z.string().min(1).optional(),
  serialNumber: z.string().optional(),
  estimatedValue: z.number().positive().optional(),
  currency: z.enum(['ZWG', 'USD', 'ZAR']).optional(),
  images: z.array(z.string()).optional(),
  status: z.enum(['PENDING', 'VERIFIED', 'RELEASED', 'SEIZED']).optional(),
});

/**
 * @swagger
 * /api/v1/loan-workflow/pledges:
 *   post:
 *     summary: Create security pledge
 */
router.post(
  '/pledges',
  authenticate,
  authorize(UserRole.STAFF, UserRole.MANAGER, UserRole.ADMIN),
  validateRequest(createPledgeSchema),
  async (req, res) => {
    try {
      const pledge = await securityPledgeService.create(req.body);

      res.status(201).json({
        success: true,
        message: 'Security pledge created successfully',
        data: { pledge },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Create pledge error:', error);
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
 * /api/v1/loan-workflow/pledges/{id}:
 *   get:
 *     summary: Get single pledge
 */
router.get('/pledges/:id', authenticate, async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Pledge ID is required',
        error: 'BAD_REQUEST',
        timestamp: new Date().toISOString(),
      });
    }
    const pledge = await securityPledgeService.get(id);

    if (!pledge) {
      return res.status(404).json({
        success: false,
        message: 'Pledge not found',
        error: 'NOT_FOUND',
        timestamp: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      message: 'Pledge retrieved successfully',
      data: { pledge },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Get pledge error:', error);
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
 * /api/v1/loan-workflow/pledges/{id}:
 *   put:
 *     summary: Update pledge
 */
router.put(
  '/pledges/:id',
  authenticate,
  authorize(UserRole.STAFF, UserRole.MANAGER, UserRole.ADMIN),
  validateRequest(updatePledgeSchema),
  async (req, res) => {
    try {
      const id = req.params.id;
      if (!id) {
        return res.status(400).json({
          success: false,
          message: 'Pledge ID is required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }
      const pledge = await securityPledgeService.update(id, req.body);

      res.json({
        success: true,
        message: 'Pledge updated successfully',
        data: { pledge },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Update pledge error:', error);
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
 * /api/v1/loan-workflow/pledges/{id}/verify:
 *   post:
 *     summary: Verify a pledge
 */
router.post(
  '/pledges/:id/verify',
  authenticate,
  authorize(UserRole.MANAGER, UserRole.ADMIN),
  async (req, res) => {
    try {
      const id = req.params.id;
      if (!id) {
        return res.status(400).json({
          success: false,
          message: 'Pledge ID is required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }
      const pledge = await securityPledgeService.verifyPledge(id);

      res.json({
        success: true,
        message: 'Pledge verified successfully',
        data: { pledge },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Verify pledge error:', error);
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
 * /api/v1/loan-workflow/pledges/{id}/release:
 *   post:
 *     summary: Release a pledge
 */
router.post(
  '/pledges/:id/release',
  authenticate,
  authorize(UserRole.MANAGER, UserRole.ADMIN),
  async (req, res) => {
    try {
      const id = req.params.id;
      if (!id) {
        return res.status(400).json({
          success: false,
          message: 'Pledge ID is required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }
      const pledge = await securityPledgeService.releasePledge(id);

      res.json({
        success: true,
        message: 'Pledge released successfully',
        data: { pledge },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Release pledge error:', error);
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
 * /api/v1/loan-workflow/loans/{loanId}/pledges:
 *   get:
 *     summary: Get pledges for a loan
 */
router.get('/loans/:loanId/pledges', authenticate, async (req, res) => {
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
    const pledges = await securityPledgeService.getByLoan(loanId);
    const totalValue = await securityPledgeService.getTotalPledgeValue(loanId);

    res.json({
      success: true,
      message: 'Loan pledges retrieved successfully',
      data: { pledges, totalValue },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Get loan pledges error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

// ============================================
// LOAN STATUS TRANSITION ROUTES
// ============================================

const transitionStatusSchema = z.object({
  toStatus: z.enum([
    'DRAFT',
    'PENDING',
    'PENDING_ASSESSMENT',
    'PENDING_VISIT',
    'PENDING_APPROVAL',
    'APPROVED',
    'PENDING_DISBURSEMENT',
    'ACTIVE',
    'OVERDUE',
    'COMPLETED',
    'CANCELLED',
    'DEFAULTED',
    'WRITTEN_OFF',
  ]),
  notes: z.string().optional(),
});

/**
 * @swagger
 * /api/v1/loan-workflow/loans/{loanId}/transition:
 *   post:
 *     summary: Transition loan status
 */
router.post(
  '/loans/:loanId/transition',
  authenticate,
  authorize(UserRole.STAFF, UserRole.MANAGER, UserRole.ADMIN),
  validateRequest(transitionStatusSchema),
  async (req, res) => {
    try {
      const loanId = req.params.loanId;
      const userId = req.user?.userId;

      if (!loanId) {
        return res.status(400).json({
          success: false,
          message: 'Loan ID is required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'User not authenticated',
          error: 'UNAUTHORIZED',
          timestamp: new Date().toISOString(),
        });
      }

      const loan = await loanStatusTransitionService.transitionLoanStatus(
        loanId,
        req.body.toStatus,
        userId,
        req.body.notes
      );

      res.json({
        success: true,
        message: `Loan status changed to ${req.body.toStatus}`,
        data: { loan },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Transition status error:', error);
      if (error.message.includes('Invalid status transition')) {
        return res.status(400).json({
          success: false,
          message: error.message,
          error: 'INVALID_TRANSITION',
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
 * /api/v1/loan-workflow/loans/{loanId}/next-statuses:
 *   get:
 *     summary: Get valid next statuses for a loan
 */
router.get('/loans/:loanId/next-statuses', authenticate, async (req, res) => {
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

    const loan = await prisma.loan.findUnique({
      where: { id: loanId },
      select: { status: true },
    });

    if (!loan) {
      return res.status(404).json({
        success: false,
        message: 'Loan not found',
        error: 'NOT_FOUND',
        timestamp: new Date().toISOString(),
      });
    }

    const nextStatuses = loanStatusTransitionService.getNextStatuses(
      loan.status
    );

    res.json({
      success: true,
      message: 'Next statuses retrieved successfully',
      data: { currentStatus: loan.status, nextStatuses },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Get next statuses error:', error);
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
 * /api/v1/loan-workflow/loans/{loanId}/history:
 *   get:
 *     summary: Get workflow history for a loan
 */
router.get('/loans/:loanId/history', authenticate, async (req, res) => {
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
    const history = await loanWorkflowHistoryService.getByLoan(loanId);

    res.json({
      success: true,
      message: 'Workflow history retrieved successfully',
      data: { history },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Get workflow history error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

// Need prisma for next-statuses endpoint
import { prisma } from '../config/database';

// ============================================
// CATEGORY-AWARE WORKFLOW ROUTES
// ============================================

/**
 * @swagger
 * /api/v1/loan-workflow/loans/{loanId}/workflow-status:
 *   get:
 *     summary: Get complete workflow status including requirements and completion
 */
router.get('/loans/:loanId/workflow-status', authenticate, async (req, res) => {
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

    const status = await categoryAwareWorkflowEngine.getWorkflowStatus(loanId);

    res.json({
      success: true,
      message: 'Workflow status retrieved successfully',
      data: status,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Get workflow status error:', error);
    res.status(error.message.includes('not found') ? 404 : 500).json({
      success: false,
      message: error.message || 'Internal server error',
      error: error.message.includes('not found')
        ? 'NOT_FOUND'
        : 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

const submitForAssessmentSchema = z.object({
  assessorId: z.string().uuid(),
  notes: z.string().optional(),
});

/**
 * @swagger
 * /api/v1/loan-workflow/loans/{loanId}/submit-assessment:
 *   post:
 *     summary: Submit loan for assessment
 */
router.post(
  '/loans/:loanId/submit-assessment',
  authenticate,
  authorize(UserRole.STAFF, UserRole.MANAGER, UserRole.ADMIN),
  validateRequest(submitForAssessmentSchema),
  async (req, res) => {
    try {
      const loanId = req.params.loanId;
      const userId = req.user?.userId;

      if (!loanId || !userId) {
        return res.status(400).json({
          success: false,
          message: 'Loan ID and user authentication required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }

      const result = await categoryAwareWorkflowEngine.submitForAssessment(
        loanId,
        req.body.assessorId,
        userId,
        req.body.notes
      );

      res.status(201).json({
        success: true,
        message: 'Loan submitted for assessment successfully',
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Submit for assessment error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

const completeAssessmentSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  notes: z.string().optional(),
});

/**
 * @swagger
 * /api/v1/loan-workflow/assessments/{id}/complete:
 *   post:
 *     summary: Complete assessment and advance workflow
 */
router.post(
  '/assessments/:id/complete',
  authenticate,
  authorize(UserRole.STAFF, UserRole.MANAGER, UserRole.ADMIN),
  validateRequest(completeAssessmentSchema),
  async (req, res) => {
    try {
      const assessmentId = req.params.id;
      const userId = req.user?.userId;

      if (!assessmentId || !userId) {
        return res.status(400).json({
          success: false,
          message: 'Assessment ID and user authentication required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }

      const result = await categoryAwareWorkflowEngine.completeAssessment(
        assessmentId,
        req.body.status,
        userId,
        req.body.notes
      );

      res.json({
        success: true,
        message: `Assessment ${req.body.status.toLowerCase()} successfully`,
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Complete assessment error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

const completeVisitSchema = z.object({
  address: z.string().optional(),
  gpsLat: z.number().optional(),
  gpsLng: z.number().optional(),
  images: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

/**
 * @swagger
 * /api/v1/loan-workflow/visits/{id}/complete:
 *   post:
 *     summary: Complete visit and advance workflow
 */
router.post(
  '/visits/:id/complete',
  authenticate,
  authorize(UserRole.STAFF, UserRole.MANAGER, UserRole.ADMIN),
  validateRequest(completeVisitSchema),
  async (req, res) => {
    try {
      const visitId = req.params.id;
      const userId = req.user?.userId;

      if (!visitId || !userId) {
        return res.status(400).json({
          success: false,
          message: 'Visit ID and user authentication required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }

      const result = await categoryAwareWorkflowEngine.completeVisit(
        visitId,
        req.body,
        userId
      );

      res.json({
        success: true,
        message: 'Visit completed successfully',
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Complete visit error:', error);
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
 * /api/v1/loan-workflow/pledges/{id}/verify-and-check:
 *   post:
 *     summary: Verify pledge and check if loan can advance
 */
router.post(
  '/pledges/:id/verify-and-check',
  authenticate,
  authorize(UserRole.MANAGER, UserRole.ADMIN),
  async (req, res) => {
    try {
      const pledgeId = req.params.id;
      const userId = req.user?.userId;

      if (!pledgeId || !userId) {
        return res.status(400).json({
          success: false,
          message: 'Pledge ID and user authentication required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }

      const result = await categoryAwareWorkflowEngine.verifyPledge(
        pledgeId,
        userId,
        req.body?.notes
      );

      res.json({
        success: true,
        message: 'Pledge verified successfully',
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Verify pledge error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

const approveRejectSchema = z.object({
  notes: z.string().optional(),
});

const rejectSchema = z.object({
  reason: z.string().min(1, 'Rejection reason is required'),
});

/**
 * @swagger
 * /api/v1/loan-workflow/loans/{loanId}/approve:
 *   post:
 *     summary: Approve loan with category-aware validation
 */
router.post(
  '/loans/:loanId/approve',
  authenticate,
  authorize(UserRole.MANAGER, UserRole.ADMIN),
  validateRequest(approveRejectSchema),
  async (req, res) => {
    try {
      const loanId = req.params.loanId;
      const userId = req.user?.userId;

      if (!loanId || !userId) {
        return res.status(400).json({
          success: false,
          message: 'Loan ID and user authentication required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }

      const result = await categoryAwareWorkflowEngine.approveLoan(
        loanId,
        userId,
        req.body?.notes
      );

      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: result.error,
          error: 'VALIDATION_ERROR',
          timestamp: new Date().toISOString(),
        });
      }

      res.json({
        success: true,
        message: 'Loan approved successfully',
        data: { loan: result.loan },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Approve loan error:', error);
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
 * /api/v1/loan-workflow/loans/{loanId}/reject:
 *   post:
 *     summary: Reject loan
 */
router.post(
  '/loans/:loanId/reject',
  authenticate,
  authorize(UserRole.MANAGER, UserRole.ADMIN),
  validateRequest(rejectSchema),
  async (req, res) => {
    try {
      const loanId = req.params.loanId;
      const userId = req.user?.userId;

      if (!loanId || !userId) {
        return res.status(400).json({
          success: false,
          message: 'Loan ID and user authentication required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }

      const result = await categoryAwareWorkflowEngine.rejectLoan(
        loanId,
        userId,
        req.body.reason
      );

      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: result.error,
          error: 'VALIDATION_ERROR',
          timestamp: new Date().toISOString(),
        });
      }

      res.json({
        success: true,
        message: 'Loan rejected successfully',
        data: { loan: result.loan },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Reject loan error:', error);
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
 * /api/v1/loan-workflow/loans/{loanId}/mark-for-disbursement:
 *   post:
 *     summary: Mark approved loan for disbursement
 */
router.post(
  '/loans/:loanId/mark-for-disbursement',
  authenticate,
  authorize(UserRole.MANAGER, UserRole.ADMIN),
  validateRequest(approveRejectSchema),
  async (req, res) => {
    try {
      const loanId = req.params.loanId;
      const userId = req.user?.userId;

      if (!loanId || !userId) {
        return res.status(400).json({
          success: false,
          message: 'Loan ID and user authentication required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }

      const result = await categoryAwareWorkflowEngine.markForDisbursement(
        loanId,
        userId,
        req.body?.notes
      );

      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: result.error,
          error: 'VALIDATION_ERROR',
          timestamp: new Date().toISOString(),
        });
      }

      res.json({
        success: true,
        message: 'Loan marked for disbursement successfully',
        data: { loan: result.loan },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Mark for disbursement error:', error);
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
// DISBURSEMENT QUEUE ROUTES
// ============================================

/**
 * @swagger
 * /api/v1/loan-workflow/disbursements/pending:
 *   get:
 *     summary: Get pending disbursements
 */
router.get(
  '/disbursements/pending',
  authenticate,
  authorize(UserRole.STAFF, UserRole.MANAGER, UserRole.ADMIN),
  async (req, res) => {
    try {
      const organizationId = req.user?.organizationId;
      const branchId = req.query.branchId as string | undefined;

      if (!organizationId) {
        return res.status(403).json({
          success: false,
          message: 'Organization context required',
          error: 'FORBIDDEN',
          timestamp: new Date().toISOString(),
        });
      }

      const loans = await categoryAwareWorkflowEngine.getPendingDisbursements(
        organizationId,
        branchId
      );

      res.json({
        success: true,
        message: 'Pending disbursements retrieved successfully',
        data: {
          loans,
          count: loans.length,
          totalAmount: loans.reduce((sum, l) => sum + Number(l.amount), 0),
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Get pending disbursements error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

const disburseSchema = z.object({
  disbursementDate: z.string().datetime().optional(),
  disbursementMethod: z
    .enum(['CASH', 'BANK_TRANSFER', 'MOBILE_MONEY', 'CHECK'])
    .optional(),
  reference: z.string().optional(),
  notes: z.string().optional(),
});

/**
 * @swagger
 * /api/v1/loan-workflow/loans/{loanId}/disburse:
 *   post:
 *     summary: Disburse a loan
 */
router.post(
  '/loans/:loanId/disburse',
  authenticate,
  authorize(UserRole.MANAGER, UserRole.ADMIN),
  validateRequest(disburseSchema),
  async (req, res) => {
    try {
      const loanId = req.params.loanId;
      const userId = req.user?.userId;

      if (!loanId || !userId) {
        return res.status(400).json({
          success: false,
          message: 'Loan ID and user authentication required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }

      const result = await categoryAwareWorkflowEngine.disburseLoan(
        loanId,
        userId,
        {
          disbursementDate: req.body.disbursementDate
            ? new Date(req.body.disbursementDate)
            : undefined,
          disbursementMethod: req.body.disbursementMethod,
          reference: req.body.reference,
          notes: req.body.notes,
        }
      );

      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: result.error,
          error: 'VALIDATION_ERROR',
          timestamp: new Date().toISOString(),
        });
      }

      res.json({
        success: true,
        message: 'Loan disbursed successfully',
        data: { loan: result.loan },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Disburse loan error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

const batchDisburseSchema = z.object({
  loanIds: z.array(z.string().uuid()).min(1),
  disbursementDate: z.string().datetime().optional(),
  disbursementMethod: z
    .enum(['CASH', 'BANK_TRANSFER', 'MOBILE_MONEY', 'CHECK'])
    .optional(),
  notes: z.string().optional(),
});

/**
 * @swagger
 * /api/v1/loan-workflow/disbursements/batch:
 *   post:
 *     summary: Batch disburse multiple loans
 */
router.post(
  '/disbursements/batch',
  authenticate,
  authorize(UserRole.MANAGER, UserRole.ADMIN),
  validateRequest(batchDisburseSchema),
  async (req, res) => {
    try {
      const userId = req.user?.userId;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'User not authenticated',
          error: 'UNAUTHORIZED',
          timestamp: new Date().toISOString(),
        });
      }

      const result = await categoryAwareWorkflowEngine.batchDisburse(
        req.body.loanIds,
        userId,
        {
          disbursementDate: req.body.disbursementDate
            ? new Date(req.body.disbursementDate)
            : undefined,
          disbursementMethod: req.body.disbursementMethod,
          notes: req.body.notes,
        }
      );

      res.json({
        success: true,
        message: `Batch disbursement completed: ${result.success.length} succeeded, ${result.failed.length} failed`,
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Batch disburse error:', error);
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
