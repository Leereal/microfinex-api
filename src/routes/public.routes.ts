import { Router } from 'express';
import { z } from 'zod';
import { validateRequest } from '../middleware/validation';
import { prisma } from '../config/database';
import { onlineApplicationService } from '../services/online-application.service';

const router = Router();

// ============================================
// PUBLIC LOAN PRODUCTS
// ============================================

/**
 * @swagger
 * /api/v1/public/products:
 *   get:
 *     summary: Get available loan products for online applications
 *     tags: [Public]
 */
router.get('/products', async (req, res) => {
  try {
    const { organizationId } = req.query;

    const products = await prisma.loanProduct.findMany({
      where: {
        isActive: true,
        ...(organizationId && { organizationId: organizationId as string }),
      },
      select: {
        id: true,
        name: true,
        description: true,
        minAmount: true,
        maxAmount: true,
        minTerm: true,
        maxTerm: true,
        interestRate: true,
        calculationMethod: true,
        repaymentFrequency: true,
        gracePeriod: true,
        category: {
          select: {
            id: true,
            name: true,
            code: true,
            isLongTerm: true,
          },
        },
        organization: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    res.json({
      success: true,
      message: 'Products retrieved successfully',
      data: { products },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Get public products error:', error);
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
 * /api/v1/public/products/{id}:
 *   get:
 *     summary: Get single product details
 *     tags: [Public]
 */
router.get('/products/:id', async (req, res) => {
  try {
    const productId = req.params.id;

    const product = await prisma.loanProduct.findFirst({
      where: {
        id: productId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        description: true,
        minAmount: true,
        maxAmount: true,
        minTerm: true,
        maxTerm: true,
        interestRate: true,
        calculationMethod: true,
        repaymentFrequency: true,
        gracePeriod: true,
        category: {
          select: {
            id: true,
            name: true,
            code: true,
            isLongTerm: true,
            requiresBusinessVisit: true,
            requiresHomeVisit: true,
            requiresSecurityPledge: true,
            requiresCollateral: true,
          },
        },
        organization: {
          select: {
            id: true,
            name: true,
            phone: true,
            address: true,
          },
        },
      },
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
        error: 'NOT_FOUND',
        timestamp: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      message: 'Product retrieved successfully',
      data: { product },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Get product error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
      error: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

// ============================================
// PUBLIC ONLINE APPLICATIONS
// ============================================

const newApplicationSchema = z.object({
  source: z.enum(['WEB', 'WHATSAPP', 'FACEBOOK']).default('WEB'),
  clientPhone: z.string().min(8, 'Phone number is required'),
  clientName: z.string().min(2, 'Name is required'),
  idNumber: z.string().optional(),
  amount: z.number().positive('Amount must be positive'),
  productId: z.string().uuid('Invalid product ID'),
  disbursementPreference: z.enum(['CASH', 'TRANSFER']),
  bankAccount: z.string().optional(),
  mobileNumber: z.string().optional(),
  notes: z.string().optional(),
});

/**
 * @swagger
 * /api/v1/public/apply/new:
 *   post:
 *     summary: Submit new client application
 *     tags: [Public]
 */
router.post(
  '/apply/new',
  validateRequest(newApplicationSchema),
  async (req, res) => {
    try {
      // Check for duplicate pending applications
      const existing = await onlineApplicationService.getApplicationByPhone(
        req.body.clientPhone,
        'PENDING'
      );

      if (existing) {
        return res.status(400).json({
          success: false,
          message:
            'You already have a pending application. Please verify it or wait for processing.',
          error: 'DUPLICATE_APPLICATION',
          data: {
            applicationId: existing.id,
            status: existing.status,
          },
          timestamp: new Date().toISOString(),
        });
      }

      const application = await onlineApplicationService.createApplication({
        ...req.body,
        applicationType: 'NEW',
      });

      // TODO: Send OTP via SMS (integrate with SMS gateway)
      // await smsService.sendOTP(req.body.clientPhone, application.verificationCode);

      res.status(201).json({
        success: true,
        message:
          'Application submitted successfully. Please verify with the code sent to your phone.',
        data: {
          applicationId: application.id,
          status: application.status,
          verificationExpiry: application.verificationExpiry,
          // Don't expose the code in production - only for testing
          ...(process.env.NODE_ENV === 'development' && {
            verificationCode: application.verificationCode,
          }),
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('New application error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

const existingApplicationSchema = z.object({
  source: z.enum(['WEB', 'WHATSAPP', 'FACEBOOK']).default('WEB'),
  clientPhone: z.string().min(8, 'Phone number is required'),
  amount: z.number().positive('Amount must be positive'),
  productId: z.string().uuid('Invalid product ID'),
  disbursementPreference: z.enum(['CASH', 'TRANSFER']),
  bankAccount: z.string().optional(),
  mobileNumber: z.string().optional(),
  notes: z.string().optional(),
});

/**
 * @swagger
 * /api/v1/public/apply/existing:
 *   post:
 *     summary: Submit existing client application (requires phone verification)
 *     tags: [Public]
 */
router.post(
  '/apply/existing',
  validateRequest(existingApplicationSchema),
  async (req, res) => {
    try {
      // Check if this phone number belongs to an existing client
      const existingClient = await prisma.client.findFirst({
        where: {
          phone: req.body.clientPhone,
          isActive: true,
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
        },
      });

      if (!existingClient) {
        return res.status(400).json({
          success: false,
          message:
            'No client found with this phone number. Please apply as a new client.',
          error: 'CLIENT_NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      // Check for pending applications
      const pendingApplication =
        await onlineApplicationService.getApplicationByPhone(
          req.body.clientPhone,
          'PENDING'
        );

      if (pendingApplication) {
        return res.status(400).json({
          success: false,
          message:
            'You already have a pending application. Please verify it first.',
          error: 'DUPLICATE_APPLICATION',
          data: {
            applicationId: pendingApplication.id,
            status: pendingApplication.status,
          },
          timestamp: new Date().toISOString(),
        });
      }

      const application = await onlineApplicationService.createApplication({
        ...req.body,
        applicationType: 'EXISTING',
        clientName: `${existingClient.firstName} ${existingClient.lastName}`,
      });

      // TODO: Send OTP via SMS
      // await smsService.sendOTP(req.body.clientPhone, application.verificationCode);

      res.status(201).json({
        success: true,
        message:
          'Application submitted successfully. Please verify with the code sent to your phone.',
        data: {
          applicationId: application.id,
          clientName: application.clientName,
          status: application.status,
          verificationExpiry: application.verificationExpiry,
          ...(process.env.NODE_ENV === 'development' && {
            verificationCode: application.verificationCode,
          }),
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Existing application error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

const verifySchema = z.object({
  applicationId: z.string().uuid(),
  code: z.string().length(6, 'Verification code must be 6 digits'),
});

/**
 * @swagger
 * /api/v1/public/verify:
 *   post:
 *     summary: Verify application with OTP code
 *     tags: [Public]
 */
router.post('/verify', validateRequest(verifySchema), async (req, res) => {
  try {
    const application = await onlineApplicationService.verifyApplication(
      req.body.applicationId,
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
      message:
        'Application verified successfully. Our team will contact you shortly.',
      data: {
        applicationId: application.id,
        status: application.status,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Verify application error:', error);

    if (
      error.message.includes('Invalid') ||
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
});

/**
 * @swagger
 * /api/v1/public/application/{id}/status:
 *   get:
 *     summary: Check application status (public)
 *     tags: [Public]
 */
router.get('/application/:id/status', async (req, res) => {
  try {
    const applicationId = req.params.id;

    const application = await prisma.onlineApplication.findUnique({
      where: { id: applicationId },
      select: {
        id: true,
        status: true,
        clientName: true,
        amount: true,
        createdAt: true,
        loans: {
          select: {
            id: true,
            loanNumber: true,
            status: true,
          },
          take: 1,
        },
      },
    });

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
      message: 'Application status retrieved successfully',
      data: {
        applicationId: application.id,
        status: application.status,
        clientName: application.clientName,
        amount: application.amount,
        submittedAt: application.createdAt,
        loan: application.loans[0] || null,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Get application status error:', error);
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
 * /api/v1/public/application/{id}/resend-otp:
 *   post:
 *     summary: Resend OTP for application verification
 *     tags: [Public]
 */
router.post('/application/:id/resend-otp', async (req, res) => {
  try {
    const applicationId = req.params.id;

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

    // TODO: Send new OTP via SMS
    // await smsService.sendOTP(application.clientPhone, application.verificationCode);

    res.json({
      success: true,
      message: 'New verification code sent to your phone.',
      data: {
        applicationId: application.id,
        verificationExpiry: application.verificationExpiry,
        ...(process.env.NODE_ENV === 'development' && {
          verificationCode: application.verificationCode,
        }),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Resend OTP error:', error);

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

// ============================================
// LOAN CALCULATOR (PUBLIC)
// ============================================

const calculatorSchema = z.object({
  amount: z.number().positive(),
  term: z.number().int().positive(),
  productId: z.string().uuid().optional(),
  interestRate: z.number().optional(),
});

/**
 * @swagger
 * /api/v1/public/calculate:
 *   post:
 *     summary: Calculate loan repayments
 *     tags: [Public]
 */
router.post(
  '/calculate',
  validateRequest(calculatorSchema),
  async (req, res) => {
    try {
      const { amount, term, productId, interestRate: providedRate } = req.body;

      let interestRate = providedRate;
      let product = null;

      // If productId provided, get rate from product
      if (productId) {
        product = await prisma.loanProduct.findUnique({
          where: { id: productId },
          select: {
            id: true,
            name: true,
            interestRate: true,
            calculationMethod: true,
            repaymentFrequency: true,
          },
        });

        if (product) {
          interestRate = Number(product.interestRate);
        }
      }

      if (interestRate === undefined) {
        return res.status(400).json({
          success: false,
          message:
            'Interest rate is required (either via productId or directly)',
          error: 'VALIDATION_ERROR',
          timestamp: new Date().toISOString(),
        });
      }

      // Simple interest calculation
      const monthlyRate = interestRate / 100 / 12;
      const totalInterest = amount * monthlyRate * term;
      const totalAmount = amount + totalInterest;
      const monthlyPayment = totalAmount / term;

      res.json({
        success: true,
        message: 'Calculation completed successfully',
        data: {
          principal: amount,
          term,
          interestRate,
          monthlyPayment: Math.round(monthlyPayment * 100) / 100,
          totalInterest: Math.round(totalInterest * 100) / 100,
          totalAmount: Math.round(totalAmount * 100) / 100,
          product: product ? { id: product.id, name: product.name } : null,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Calculate loan error:', error);
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
