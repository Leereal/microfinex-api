import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth-supabase';
import { validateRequest } from '../middleware/validation';
import { UserRole } from '../types';
import { loanItemService } from '../services/shop.service';

const router = Router();

// ===== LOAN ITEM ROUTES =====

// Create loan item schema
const createLoanItemSchema = z.object({
  shopProductId: z.string().uuid(),
  quantity: z.number().int().positive(),
});

// Update loan item schema
const updateLoanItemSchema = z.object({
  quantity: z.number().int().positive().optional(),
});

/**
 * @swagger
 * /api/v1/loan-items/loans/{loanId}/items:
 *   post:
 *     summary: Add item to loan
 */
router.post(
  '/loans/:loanId/items',
  authenticate,
  authorize(UserRole.STAFF, UserRole.MANAGER, UserRole.ADMIN),
  validateRequest(createLoanItemSchema),
  async (req, res) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        return res.status(403).json({
          success: false,
          message: 'Organization context required',
          error: 'FORBIDDEN',
          timestamp: new Date().toISOString(),
        });
      }

      const loanId = req.params.loanId;
      if (!loanId) {
        return res.status(400).json({
          success: false,
          message: 'Loan ID is required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }

      const item = await loanItemService.createLoanItem(organizationId, {
        loanId,
        shopProductId: req.body.shopProductId,
        quantity: req.body.quantity,
      });
      if (!item) {
        return res.status(404).json({
          success: false,
          message: 'Loan or shop not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      res.status(201).json({
        success: true,
        message: 'Item added to loan successfully',
        data: { item },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Add loan item error:', error);
      if (error.message === 'Insufficient stock') {
        return res.status(400).json({
          success: false,
          message: 'Insufficient stock for this product',
          error: 'INSUFFICIENT_STOCK',
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
 * /api/v1/loan-items/loans/{loanId}/items:
 *   get:
 *     summary: Get loan items
 */
router.get('/loans/:loanId/items', authenticate, async (req, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({
        success: false,
        message: 'Organization context required',
        error: 'FORBIDDEN',
        timestamp: new Date().toISOString(),
      });
    }

    const loanId = req.params.loanId;
    if (!loanId) {
      return res.status(400).json({
        success: false,
        message: 'Loan ID is required',
        error: 'BAD_REQUEST',
        timestamp: new Date().toISOString(),
      });
    }

    const result = await loanItemService.getLoanItems(organizationId, loanId);
    if (result === null) {
      return res.status(404).json({
        success: false,
        message: 'Loan not found',
        error: 'NOT_FOUND',
        timestamp: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      message: 'Loan items retrieved successfully',
      data: { items: result.items, total: result.total },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Get loan items error:', error);
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
 * /api/v1/loan-items/{itemId}:
 *   put:
 *     summary: Update loan item
 */
router.put(
  '/:itemId',
  authenticate,
  authorize(UserRole.STAFF, UserRole.MANAGER, UserRole.ADMIN),
  validateRequest(updateLoanItemSchema),
  async (req, res) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        return res.status(403).json({
          success: false,
          message: 'Organization context required',
          error: 'FORBIDDEN',
          timestamp: new Date().toISOString(),
        });
      }

      const itemId = req.params.itemId;
      if (!itemId) {
        return res.status(400).json({
          success: false,
          message: 'Item ID is required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }

      const item = await loanItemService.updateLoanItem(
        organizationId,
        itemId,
        req.body
      );
      if (!item) {
        return res.status(404).json({
          success: false,
          message: 'Loan item not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      res.json({
        success: true,
        message: 'Loan item updated successfully',
        data: { item },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Update loan item error:', error);
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
 * /api/v1/loan-items/{itemId}:
 *   delete:
 *     summary: Remove loan item
 */
router.delete(
  '/:itemId',
  authenticate,
  authorize(UserRole.STAFF, UserRole.MANAGER, UserRole.ADMIN),
  async (req, res) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        return res.status(403).json({
          success: false,
          message: 'Organization context required',
          error: 'FORBIDDEN',
          timestamp: new Date().toISOString(),
        });
      }

      const itemId = req.params.itemId;
      if (!itemId) {
        return res.status(400).json({
          success: false,
          message: 'Item ID is required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }

      const deleted = await loanItemService.deleteLoanItem(
        organizationId,
        itemId
      );
      if (!deleted) {
        return res.status(404).json({
          success: false,
          message: 'Loan item not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      res.status(204).send();
    } catch (error: any) {
      console.error('Delete loan item error:', error);
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
