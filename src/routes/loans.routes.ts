import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/database';
import { authenticate, authorize } from '../middleware/auth-supabase';
import { validateRequest, validateQuery } from '../middleware/validation';
import { UserRole } from '../types';
import { Prisma } from '@prisma/client';
const Decimal = Prisma.Decimal;
import {
  loanCalculationService,
  LoanCalculationMethod,
  RepaymentFrequency,
  PenaltyType,
  LoanCalculationInput,
} from '../services/loan-calculations';
import {
  loanApplicationService,
  createLoanApplicationSchema,
  approveLoanSchema,
  disburseLoanSchema,
  LoanApplicationFilters,
} from '../services/loan-application.service';

const router = Router();

// Validation schemas
const loanCalculationSchema = z.object({
  principalAmount: z.number().positive('Principal amount must be positive'),
  annualInterestRate: z.number().min(0, 'Interest rate cannot be negative'),
  termInMonths: z.number().int().positive('Term must be a positive integer'),
  repaymentFrequency: z.enum([
    'DAILY',
    'WEEKLY',
    'BIWEEKLY',
    'MONTHLY',
    'QUARTERLY',
    'SEMI_ANNUAL',
    'ANNUAL',
  ]),
  calculationMethod: z.enum([
    'FLAT_RATE',
    'REDUCING_BALANCE',
    'SIMPLE_INTEREST',
    'COMPOUND_INTEREST',
    'ANNUITY',
    'BALLOON_PAYMENT',
    'CUSTOM_FORMULA',
  ]),
  gracePeriodDays: z.number().int().min(0).optional(),
  processingFeeAmount: z.number().min(0).optional(),
  processingFeePercentage: z.number().min(0).optional(),
  insuranceFeeAmount: z.number().min(0).optional(),
  insuranceFeePercentage: z.number().min(0).optional(),
  disbursementDate: z.string().datetime().optional(),
});

const loanApplicationSchema = z.object({
  clientId: z.string().uuid('Invalid client ID'),
  productId: z.string().uuid('Invalid product ID'),
  amount: z.number().positive('Loan amount must be positive'),
  termInMonths: z.number().int().positive('Term must be a positive integer'),
  purpose: z.string().min(1, 'Loan purpose is required'),
  collateralValue: z.number().min(0).optional(),
  collateralDescription: z.string().optional(),
  guarantorInfo: z.any().optional(),
});

const penaltyCalculationSchema = z.object({
  loanId: z.string().uuid('Invalid loan ID'),
  overdueDays: z.number().int().min(1, 'Overdue days must be at least 1'),
  penaltyType: z
    .enum([
      'FIXED_AMOUNT',
      'PERCENTAGE_OF_OVERDUE',
      'PERCENTAGE_OF_INSTALLMENT',
      'COMPOUNDING_DAILY',
    ])
    .optional(),
});

/**
 * @swagger
 * /api/v1/loans/calculate:
 *   post:
 *     summary: Calculate loan with different methods
 *     tags: [Loans]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               principalAmount:
 *                 type: number
 *               annualInterestRate:
 *                 type: number
 *               termInMonths:
 *                 type: integer
 *               repaymentFrequency:
 *                 type: string
 *                 enum: [DAILY, WEEKLY, BIWEEKLY, MONTHLY, QUARTERLY, SEMI_ANNUAL, ANNUAL]
 *               calculationMethod:
 *                 type: string
 *                 enum: [FLAT_RATE, REDUCING_BALANCE, SIMPLE_INTEREST, COMPOUND_INTEREST, ANNUITY, BALLOON_PAYMENT, CUSTOM_FORMULA]
 */
router.post(
  '/calculate',
  authenticate,
  validateRequest(loanCalculationSchema),
  async (req, res) => {
    try {
      const {
        principalAmount,
        annualInterestRate,
        termInMonths,
        repaymentFrequency,
        calculationMethod,
        gracePeriodDays,
        processingFeeAmount,
        processingFeePercentage,
        insuranceFeeAmount,
        insuranceFeePercentage,
        disbursementDate,
      } = req.body;

      const input: LoanCalculationInput = {
        principalAmount: new Decimal(principalAmount),
        annualInterestRate: new Decimal(annualInterestRate),
        termInMonths,
        repaymentFrequency: repaymentFrequency as RepaymentFrequency,
        calculationMethod: calculationMethod as LoanCalculationMethod,
        gracePeriodDays,
        processingFeeAmount: processingFeeAmount
          ? new Decimal(processingFeeAmount)
          : undefined,
        processingFeePercentage: processingFeePercentage
          ? new Decimal(processingFeePercentage)
          : undefined,
        insuranceFeeAmount: insuranceFeeAmount
          ? new Decimal(insuranceFeeAmount)
          : undefined,
        insuranceFeePercentage: insuranceFeePercentage
          ? new Decimal(insuranceFeePercentage)
          : undefined,
        disbursementDate: disbursementDate
          ? new Date(disbursementDate)
          : undefined,
      };

      const result = loanCalculationService.calculateLoan(input);

      res.json({
        success: true,
        message: 'Loan calculation completed successfully',
        data: {
          calculation: {
            ...result,
            // Convert Decimal to number for JSON serialization
            principalAmount: result.principalAmount.toNumber(),
            totalInterest: result.totalInterest.toNumber(),
            totalFees: result.totalFees.toNumber(),
            totalAmount: result.totalAmount.toNumber(),
            monthlyInstallment: result.monthlyInstallment.toNumber(),
            effectiveInterestRate: result.effectiveInterestRate.toNumber(),
            apr: result.apr.toNumber(),
            repaymentSchedule: result.repaymentSchedule.map(installment => ({
              ...installment,
              principalAmount: installment.principalAmount.toNumber(),
              interestAmount: installment.interestAmount.toNumber(),
              feesAmount: installment.feesAmount.toNumber(),
              totalAmount: installment.totalAmount.toNumber(),
              remainingBalance: installment.remainingBalance.toNumber(),
              cumulativePrincipal: installment.cumulativePrincipal.toNumber(),
              cumulativeInterest: installment.cumulativeInterest.toNumber(),
            })),
            summary: {
              ...result.summary,
              totalInterestPaid: result.summary.totalInterestPaid.toNumber(),
              totalFeesPaid: result.summary.totalFeesPaid.toNumber(),
              averageMonthlyPayment:
                result.summary.averageMonthlyPayment.toNumber(),
            },
          },
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Loan calculation error:', error);
      res.status(400).json({
        success: false,
        message:
          error instanceof Error ? error.message : 'Loan calculation failed',
        error: 'CALCULATION_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/loans/compare-methods:
 *   post:
 *     summary: Compare different loan calculation methods
 *     tags: [Loans]
 *     security:
 *       - bearerAuth: []
 */
router.post('/compare-methods', authenticate, async (req, res) => {
  try {
    const {
      principalAmount,
      annualInterestRate,
      termInMonths,
      repaymentFrequency = 'MONTHLY',
      methods = ['REDUCING_BALANCE', 'FLAT_RATE', 'SIMPLE_INTEREST'],
    } = req.body;

    const baseInput = {
      principalAmount: new Decimal(principalAmount),
      annualInterestRate: new Decimal(annualInterestRate),
      termInMonths,
      repaymentFrequency: repaymentFrequency as RepaymentFrequency,
    };

    const comparisons = loanCalculationService.compareLoanMethods(
      baseInput,
      methods as LoanCalculationMethod[]
    );

    const results = Array.from(comparisons.entries()).map(
      ([method, calculation]) => ({
        method,
        principalAmount: calculation.principalAmount.toNumber(),
        totalInterest: calculation.totalInterest.toNumber(),
        totalAmount: calculation.totalAmount.toNumber(),
        monthlyInstallment: calculation.monthlyInstallment.toNumber(),
        effectiveInterestRate: calculation.effectiveInterestRate.toNumber(),
        apr: calculation.apr.toNumber(),
      })
    );

    res.json({
      success: true,
      message: 'Loan method comparison completed successfully',
      data: { comparisons: results },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Loan comparison error:', error);
    res.status(400).json({
      success: false,
      message:
        error instanceof Error ? error.message : 'Loan comparison failed',
      error: 'COMPARISON_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @swagger
 * /api/v1/loans/{id}/calculate-penalty:
 *   post:
 *     summary: Calculate penalty for overdue loan payments
 *     tags: [Loans]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/:id/calculate-penalty',
  authenticate,
  validateRequest(penaltyCalculationSchema),
  async (req, res) => {
    try {
      const { id: loanId } = req.params;
      const { overdueDays, penaltyType = 'PERCENTAGE_OF_OVERDUE' } = req.body;

      // Get loan details
      const loan = await prisma.loan.findUnique({
        where: { id: loanId },
        include: {
          product: true,
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

      // Calculate penalty
      const penaltyResult = loanCalculationService.calculatePenalty(
        'REDUCING_BALANCE' as LoanCalculationMethod, // Default method
        overdueDays,
        loan.outstandingBalance,
        loan.product.penaltyRate,
        penaltyType as PenaltyType
      );

      res.json({
        success: true,
        message: 'Penalty calculation completed successfully',
        data: {
          loan: {
            id: loan.id,
            loanNumber: loan.loanNumber,
            outstandingBalance: loan.outstandingBalance.toNumber(),
          },
          penalty: {
            ...penaltyResult,
            penaltyAmount: penaltyResult.penaltyAmount.toNumber(),
            penaltyRate: penaltyResult.penaltyRate.toNumber(),
          },
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Penalty calculation error:', error);
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
 * /api/v1/loans:
 *   get:
 *     summary: Get all loans with filtering and pagination
 *     tags: [Loans]
 *     security:
 *       - bearerAuth: []
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      clientId,
      productId,
      search,
    } = req.query;

    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    const where: any = {};

    // Add organization filter for non-super-admin users
    if (req.user?.role !== UserRole.SUPER_ADMIN) {
      where.organizationId = req.user?.organizationId;
    }

    // Add filters
    if (status) {
      where.status = status;
    }

    if (clientId) {
      where.clientId = clientId;
    }

    if (productId) {
      where.productId = productId;
    }

    if (search) {
      where.OR = [
        { loanNumber: { contains: search, mode: 'insensitive' } },
        { client: { firstName: { contains: search, mode: 'insensitive' } } },
        { client: { lastName: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [loans, total] = await Promise.all([
      prisma.loan.findMany({
        where,
        skip,
        take,
        include: {
          client: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phone: true,
              email: true,
            },
          },
          product: {
            select: {
              id: true,
              name: true,
              interestRate: true,
              calculationMethod: true,
            },
          },
          loanOfficer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.loan.count({ where }),
    ]);

    const totalPages = Math.ceil(total / take);

    res.json({
      success: true,
      message: 'Loans retrieved successfully',
      data: {
        loans: loans.map(loan => ({
          ...loan,
          amount: loan.amount.toNumber(),
          interestRate: loan.interestRate.toNumber(),
          installmentAmount: loan.installmentAmount.toNumber(),
          totalAmount: loan.totalAmount.toNumber(),
          totalInterest: loan.totalInterest.toNumber(),
          outstandingBalance: loan.outstandingBalance.toNumber(),
          principalBalance: loan.principalBalance.toNumber(),
          interestBalance: loan.interestBalance.toNumber(),
          penaltyBalance: loan.penaltyBalance.toNumber(),
        })),
        pagination: {
          page: Number(page),
          limit: take,
          total,
          totalPages,
          hasNext: Number(page) < totalPages,
          hasPrev: Number(page) > 1,
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Get loans error:', error);
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
 * /api/v1/loans/methods:
 *   get:
 *     summary: Get available loan calculation methods
 *     tags: [Loans]
 *     security:
 *       - bearerAuth: []
 */
router.get('/methods', authenticate, (req, res) => {
  const methods = loanCalculationService.getAvailableMethods();

  res.json({
    success: true,
    message: 'Available calculation methods retrieved successfully',
    data: {
      methods,
      descriptions: {
        FLAT_RATE: 'Interest calculated on original principal for entire term',
        REDUCING_BALANCE:
          'Interest calculated on outstanding balance (most common)',
        SIMPLE_INTEREST: 'Interest = Principal × Rate × Time',
        COMPOUND_INTEREST: 'Interest compounds over time',
        ANNUITY: 'Fixed payment over loan term',
        BALLOON_PAYMENT: 'Large final payment with smaller regular payments',
        CUSTOM_FORMULA: 'User-defined calculation formula',
      },
    },
    timestamp: new Date().toISOString(),
  });
});

// Loan application endpoints

/**
 * @swagger
 * /api/v1/loans/applications:
 *   post:
 *     summary: Create loan application
 *     tags: [Loan Applications]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/applications',
  authenticate,
  authorize(UserRole.MANAGER, UserRole.STAFF),
  validateRequest(createLoanApplicationSchema),
  async (req, res) => {
    try {
      const organizationId = req.userContext?.organizationId;
      const branchId = req.body.branchId;
      const loanOfficerId = req.userContext?.id;

      if (!organizationId || !branchId || !loanOfficerId) {
        return res.status(400).json({
          success: false,
          message: 'Organization ID, branch ID, and loan officer ID required',
          error: 'MISSING_CONTEXT',
          timestamp: new Date().toISOString(),
        });
      }

      const application = await loanApplicationService.createLoanApplication(
        req.body,
        organizationId,
        branchId,
        loanOfficerId
      );

      res.status(201).json({
        success: true,
        message: 'Loan application created successfully',
        data: { application },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Create loan application error:', error);
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        error: 'APPLICATION_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/loans/applications:
 *   get:
 *     summary: Get loan applications with filters
 *     tags: [Loan Applications]
 *     security:
 *       - bearerAuth: []
 */
router.get('/applications', authenticate, async (req, res) => {
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

    const filters: LoanApplicationFilters = {
      status: req.query.status as string,
      clientId: req.query.clientId as string,
      productId: req.query.productId as string,
      branchId: req.query.branchId as string,
      loanOfficerId: req.query.loanOfficerId as string,
      amountFrom: req.query.amountFrom
        ? parseFloat(req.query.amountFrom as string)
        : undefined,
      amountTo: req.query.amountTo
        ? parseFloat(req.query.amountTo as string)
        : undefined,
      dateFrom: req.query.dateFrom
        ? new Date(req.query.dateFrom as string)
        : undefined,
      dateTo: req.query.dateTo
        ? new Date(req.query.dateTo as string)
        : undefined,
      page: parseInt(req.query.page as string) || 1,
      limit: Math.min(parseInt(req.query.limit as string) || 10, 100),
    };

    const result = await loanApplicationService.getLoanApplications(
      filters,
      organizationId
    );

    res.json({
      success: true,
      message: 'Loan applications retrieved successfully',
      data: result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Get loan applications error:', error);
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
 * /api/v1/loans/applications/{loanId}:
 *   get:
 *     summary: Get loan application by ID
 *     tags: [Loan Applications]
 *     security:
 *       - bearerAuth: []
 */
router.get('/applications/:loanId', authenticate, async (req, res) => {
  try {
    const loanId = req.params.loanId!;
    const organizationId = req.userContext?.organizationId;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'Organization ID required',
        error: 'MISSING_ORGANIZATION',
        timestamp: new Date().toISOString(),
      });
    }

    const application = await loanApplicationService.getLoanApplicationById(
      loanId!,
      organizationId!
    );

    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Loan application not found',
        error: 'APPLICATION_NOT_FOUND',
        timestamp: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      message: 'Loan application retrieved successfully',
      data: { application },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Get loan application error:', error);
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
 * /api/v1/loans/applications/{loanId}/approve:
 *   post:
 *     summary: Approve loan application
 *     tags: [Loan Applications]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/applications/:loanId/approve',
  authenticate,
  authorize(UserRole.MANAGER, UserRole.ADMIN),
  validateRequest(approveLoanSchema),
  async (req, res) => {
    try {
      const loanId = req.params.loanId!;
      const organizationId = req.userContext?.organizationId;
      const approvedBy = req.userContext?.id;

      if (!organizationId || !approvedBy) {
        return res.status(400).json({
          success: false,
          message: 'Organization ID and user ID required',
          error: 'MISSING_CONTEXT',
          timestamp: new Date().toISOString(),
        });
      }

      const application = await loanApplicationService.approveLoanApplication(
        loanId!,
        req.body,
        organizationId!,
        approvedBy!
      );

      res.json({
        success: true,
        message: 'Loan application approved successfully',
        data: { application },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Approve loan application error:', error);
      if ((error as Error).message.includes('not found')) {
        return res.status(404).json({
          success: false,
          message: (error as Error).message,
          error: 'APPLICATION_NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        error: 'APPROVAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/loans/applications/{loanId}/reject:
 *   post:
 *     summary: Reject loan application
 *     tags: [Loan Applications]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/applications/:loanId/reject',
  authenticate,
  authorize(UserRole.MANAGER, UserRole.ADMIN),
  async (req, res) => {
    try {
      const loanId = req.params.loanId!;
      const { reason } = req.body;
      const organizationId = req.userContext?.organizationId;
      const rejectedBy = req.userContext?.id;

      if (!organizationId || !rejectedBy) {
        return res.status(400).json({
          success: false,
          message: 'Organization ID and user ID required',
          error: 'MISSING_CONTEXT',
          timestamp: new Date().toISOString(),
        });
      }

      if (!reason) {
        return res.status(400).json({
          success: false,
          message: 'Rejection reason is required',
          error: 'MISSING_REASON',
          timestamp: new Date().toISOString(),
        });
      }

      const application = await loanApplicationService.rejectLoanApplication(
        loanId!,
        reason,
        organizationId!,
        rejectedBy!
      );

      res.json({
        success: true,
        message: 'Loan application rejected successfully',
        data: { application },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Reject loan application error:', error);
      if ((error as Error).message.includes('not found')) {
        return res.status(404).json({
          success: false,
          message: (error as Error).message,
          error: 'APPLICATION_NOT_FOUND',
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
 * /api/v1/loans/applications/{loanId}/disburse:
 *   post:
 *     summary: Disburse approved loan
 *     tags: [Loan Applications]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/applications/:loanId/disburse',
  authenticate,
  authorize(UserRole.MANAGER, UserRole.ADMIN),
  validateRequest(disburseLoanSchema),
  async (req, res) => {
    try {
      const loanId = req.params.loanId!;
      const organizationId = req.userContext?.organizationId;
      const disbursedBy = req.userContext?.id;

      if (!organizationId || !disbursedBy) {
        return res.status(400).json({
          success: false,
          message: 'Organization ID and user ID required',
          error: 'MISSING_CONTEXT',
          timestamp: new Date().toISOString(),
        });
      }

      const application = await loanApplicationService.disburseLoan(
        loanId!,
        req.body,
        organizationId!,
        disbursedBy!
      );

      res.json({
        success: true,
        message: 'Loan disbursed successfully',
        data: { application },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Disburse loan error:', error);
      if ((error as Error).message.includes('not found')) {
        return res.status(404).json({
          success: false,
          message: (error as Error).message,
          error: 'APPLICATION_NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        error: 'DISBURSEMENT_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/loans/applications/statistics:
 *   get:
 *     summary: Get loan application statistics
 *     tags: [Loan Applications]
 *     security:
 *       - bearerAuth: []
 */
router.get('/applications/statistics', authenticate, async (req, res) => {
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

    const statistics =
      await loanApplicationService.getLoanApplicationStatistics(
        organizationId,
        branchId
      );

    res.json({
      success: true,
      message: 'Loan application statistics retrieved successfully',
      data: { statistics },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Get loan statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
