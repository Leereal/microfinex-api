import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth-supabase';
import { validateRequest, validateQuery } from '../middleware/validation';
import { UserRole } from '../types';
import { exchangeRateService } from '../services/exchange-rate.service';
import { Currency } from '@prisma/client';

const router = Router();

// Validation schemas
const createRateSchema = z.object({
  fromCurrency: z.nativeEnum(Currency),
  toCurrency: z.nativeEnum(Currency),
  rate: z.number().positive(),
  effectiveDate: z.string().datetime().optional(),
});

const convertQuerySchema = z.object({
  amount: z.string().transform(val => parseFloat(val)),
  from: z.nativeEnum(Currency),
  to: z.nativeEnum(Currency),
});

const historyQuerySchema = z.object({
  from: z.nativeEnum(Currency).optional(),
  to: z.nativeEnum(Currency).optional(),
  limit: z.string().transform(val => parseInt(val)).optional(),
});

/**
 * @swagger
 * /api/v1/exchange-rates:
 *   get:
 *     summary: Get current exchange rates
 *     tags: [Exchange Rates]
 *     security:
 *       - bearerAuth: []
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'User does not belong to an organization',
        error: 'NO_ORGANIZATION',
        timestamp: new Date().toISOString(),
      });
    }

    // Get latest rates for all pairs (simplified)
    // Ideally we'd group by pair and get latest, but for now just getting history
    const rates = await exchangeRateService.getHistory(organizationId, undefined, undefined, 50);

    res.json({
      success: true,
      message: 'Exchange rates retrieved successfully',
      data: { rates },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Get exchange rates error:', error);
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
 * /api/v1/exchange-rates:
 *   post:
 *     summary: Set new exchange rate
 *     tags: [Exchange Rates]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/',
  authenticate,
  authorize(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateRequest(createRateSchema),
  async (req, res) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'User does not belong to an organization',
          error: 'NO_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      const { fromCurrency, toCurrency, rate, effectiveDate } = req.body;

      const newRate = await exchangeRateService.setRate(organizationId, {
        fromCurrency,
        toCurrency,
        rate,
        effectiveDate: effectiveDate ? new Date(effectiveDate) : undefined,
        createdBy: req.user?.userId,
      });

      res.status(201).json({
        success: true,
        message: 'Exchange rate set successfully',
        data: { rate: newRate },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Set exchange rate error:', error);
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
 * /api/v1/exchange-rates/convert:
 *   get:
 *     summary: Convert amount between currencies
 *     tags: [Exchange Rates]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/convert',
  authenticate,
  validateQuery(convertQuerySchema),
  async (req, res) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'User does not belong to an organization',
          error: 'NO_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      const { amount, from, to } = req.query as any;

      const convertedAmount = await exchangeRateService.convert(
        organizationId,
        amount,
        from,
        to
      );

      res.json({
        success: true,
        message: 'Conversion successful',
        data: {
          from,
          to,
          originalAmount: amount,
          convertedAmount,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Conversion error:', error);
      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : 'Conversion failed',
        error: 'CONVERSION_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/exchange-rates/history:
 *   get:
 *     summary: Get exchange rate history
 *     tags: [Exchange Rates]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/history',
  authenticate,
  validateQuery(historyQuerySchema),
  async (req, res) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'User does not belong to an organization',
          error: 'NO_ORGANIZATION',
          timestamp: new Date().toISOString(),
        });
      }

      const { from, to, limit } = req.query as any;

      const history = await exchangeRateService.getHistory(
        organizationId,
        from,
        to,
        limit
      );

      res.json({
        success: true,
        message: 'History retrieved successfully',
        data: { history },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Get history error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

export default router;
