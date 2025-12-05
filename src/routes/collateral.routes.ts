/**
 * Collateral Routes
 * API endpoints for collateral management operations
 */

import { Router } from 'express';
import { z } from 'zod';
import {
  authenticateToken,
  requirePermission,
} from '../middleware/auth.middleware';
import {
  validateRequest,
  handleAsync,
} from '../middleware/validation.middleware';
import { collateralController } from '../controllers/collateral.controller';

const router = Router();

// All collateral routes require authentication
router.use(authenticateToken);

// ===================
// Collateral Type Routes
// ===================

/**
 * Get all collateral types
 * GET /api/v1/collaterals/types
 */
router.get(
  '/types',
  requirePermission('collaterals:view'),
  handleAsync(
    collateralController.getCollateralTypes.bind(collateralController)
  )
);

/**
 * Create collateral type
 * POST /api/v1/collaterals/types
 */
const createCollateralTypeSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required'),
    description: z.string().optional(),
    requiredDocuments: z.array(z.string()).optional(),
    valuationRules: z.record(z.any()).optional(),
    depreciationRate: z.number().min(0).max(100).optional(),
    maxLoanToValue: z.number().min(0).max(100).optional(),
  }),
});

router.post(
  '/types',
  requirePermission('collaterals:manage'),
  validateRequest(createCollateralTypeSchema),
  handleAsync(
    collateralController.createCollateralType.bind(collateralController)
  )
);

/**
 * Update collateral type
 * PUT /api/v1/collaterals/types/:typeId
 */
const updateCollateralTypeSchema = z.object({
  params: z.object({
    typeId: z.string().uuid(),
  }),
  body: z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    requiredDocuments: z.array(z.string()).optional(),
    valuationRules: z.record(z.any()).optional(),
    depreciationRate: z.number().min(0).max(100).optional(),
    maxLoanToValue: z.number().min(0).max(100).optional(),
    isActive: z.boolean().optional(),
  }),
});

router.put(
  '/types/:typeId',
  requirePermission('collaterals:manage'),
  validateRequest(updateCollateralTypeSchema),
  handleAsync(
    collateralController.updateCollateralType.bind(collateralController)
  )
);

/**
 * Delete collateral type
 * DELETE /api/v1/collaterals/types/:typeId
 */
router.delete(
  '/types/:typeId',
  requirePermission('collaterals:manage'),
  handleAsync(
    collateralController.deleteCollateralType.bind(collateralController)
  )
);

// ===================
// Collateral Statistics
// ===================

/**
 * Get collateral statistics
 * GET /api/v1/collaterals/statistics
 */
router.get(
  '/statistics',
  requirePermission('collaterals:view'),
  handleAsync(collateralController.getStatistics.bind(collateralController))
);

// ===================
// Client Collateral Routes
// ===================

/**
 * Get collaterals for a client
 * GET /api/v1/collaterals/client/:clientId
 */
router.get(
  '/client/:clientId',
  requirePermission('collaterals:view'),
  handleAsync(
    collateralController.getClientCollaterals.bind(collateralController)
  )
);

/**
 * Create collateral for a client
 * POST /api/v1/collaterals/client/:clientId
 */
const createCollateralSchema = z.object({
  params: z.object({
    clientId: z.string().uuid(),
  }),
  body: z.object({
    collateralTypeId: z.string().uuid(),
    name: z.string().min(1, 'Name is required'),
    description: z.string().optional(),
    estimatedValue: z.number().positive('Value must be positive'),
    currency: z.enum(['USD', 'ZWG', 'ZAR', 'BWP']).optional(),
    ownershipStatus: z
      .enum(['OWNED', 'FINANCED', 'LEASED', 'SHARED'])
      .optional(),
    registrationNumber: z.string().optional(),
    serialNumber: z.string().optional(),
    location: z.string().optional(),
    metadata: z.record(z.any()).optional(),
  }),
});

router.post(
  '/client/:clientId',
  requirePermission('collaterals:create'),
  validateRequest(createCollateralSchema),
  handleAsync(
    collateralController.createClientCollateral.bind(collateralController)
  )
);

/**
 * Get collateral by ID
 * GET /api/v1/collaterals/:collateralId
 */
router.get(
  '/:collateralId',
  requirePermission('collaterals:view'),
  handleAsync(collateralController.getCollateral.bind(collateralController))
);

/**
 * Update collateral
 * PUT /api/v1/collaterals/:collateralId
 */
const updateCollateralSchema = z.object({
  params: z.object({
    collateralId: z.string().uuid(),
  }),
  body: z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    estimatedValue: z.number().positive().optional(),
    currency: z.enum(['USD', 'ZWG', 'ZAR', 'BWP']).optional(),
    ownershipStatus: z
      .enum(['OWNED', 'FINANCED', 'LEASED', 'SHARED'])
      .optional(),
    status: z
      .enum(['PENDING', 'VERIFIED', 'RELEASED', 'SEIZED', 'SOLD'])
      .optional(),
    registrationNumber: z.string().optional(),
    serialNumber: z.string().optional(),
    location: z.string().optional(),
    metadata: z.record(z.any()).optional(),
  }),
});

router.put(
  '/:collateralId',
  requirePermission('collaterals:update'),
  validateRequest(updateCollateralSchema),
  handleAsync(collateralController.updateCollateral.bind(collateralController))
);

/**
 * Delete collateral
 * DELETE /api/v1/collaterals/:collateralId
 */
router.delete(
  '/:collateralId',
  requirePermission('collaterals:delete'),
  handleAsync(collateralController.deleteCollateral.bind(collateralController))
);

/**
 * Update collateral valuation
 * POST /api/v1/collaterals/:collateralId/valuation
 */
const valuationSchema = z.object({
  params: z.object({
    collateralId: z.string().uuid(),
  }),
  body: z.object({
    valuedAmount: z.number().positive('Amount must be positive'),
    valuedBy: z.string().optional(),
    valuationNotes: z.string().optional(),
    valuationDocumentId: z.string().uuid().optional(),
  }),
});

router.post(
  '/:collateralId/valuation',
  requirePermission('collaterals:update'),
  validateRequest(valuationSchema),
  handleAsync(collateralController.updateValuation.bind(collateralController))
);

/**
 * Link collateral to loan
 * POST /api/v1/collaterals/:collateralId/link-loan
 */
const linkLoanSchema = z.object({
  params: z.object({
    collateralId: z.string().uuid(),
  }),
  body: z.object({
    loanId: z.string().uuid(),
  }),
});

router.post(
  '/:collateralId/link-loan',
  requirePermission('collaterals:update'),
  validateRequest(linkLoanSchema),
  handleAsync(collateralController.linkToLoan.bind(collateralController))
);

/**
 * Unlink collateral from loan
 * POST /api/v1/collaterals/:collateralId/unlink-loan
 */
router.post(
  '/:collateralId/unlink-loan',
  requirePermission('collaterals:update'),
  handleAsync(collateralController.unlinkFromLoan.bind(collateralController))
);

/**
 * Add document to collateral
 * POST /api/v1/collaterals/:collateralId/documents
 */
const addDocumentSchema = z.object({
  params: z.object({
    collateralId: z.string().uuid(),
  }),
  body: z.object({
    documentId: z.string().uuid(),
  }),
});

router.post(
  '/:collateralId/documents',
  requirePermission('collaterals:update'),
  validateRequest(addDocumentSchema),
  handleAsync(collateralController.addDocument.bind(collateralController))
);

/**
 * Remove document from collateral
 * DELETE /api/v1/collaterals/:collateralId/documents/:documentId
 */
router.delete(
  '/:collateralId/documents/:documentId',
  requirePermission('collaterals:update'),
  handleAsync(collateralController.removeDocument.bind(collateralController))
);

export default router;
