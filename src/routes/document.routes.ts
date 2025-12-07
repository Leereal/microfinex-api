/**
 * Document Routes
 * API endpoints for document management operations
 */

import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import {
  authenticateToken,
  requirePermission,
} from '../middleware/auth.middleware';
import {
  validateRequest,
  handleAsync,
} from '../middleware/validation.middleware';
import { documentController } from '../controllers/document.controller';
import { storageService } from '../services/storage.service';

const router = Router();

// Configure multer for file upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          'Invalid file type. Only images, PDFs, and documents are allowed.'
        )
      );
    }
  },
});

// All document routes require authentication
router.use(authenticateToken);

// ===================
// Document Type Routes
// ===================

/**
 * Get all document types
 * GET /api/v1/documents/types
 */
router.get(
  '/types',
  requirePermission('documents:view'),
  handleAsync(documentController.getDocumentTypes.bind(documentController))
);

/**
 * Create document type
 * POST /api/v1/documents/types
 */
const createDocumentTypeSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required'),
    description: z.string().optional(),
    isRequired: z.boolean().optional(),
    supportsAI: z.boolean().optional(),
    aiExtractionFields: z.array(z.string()).optional(),
  }),
});

router.post(
  '/types',
  requirePermission('documents:manage'),
  validateRequest(createDocumentTypeSchema),
  handleAsync(documentController.createDocumentType.bind(documentController))
);

/**
 * Update document type
 * PUT /api/v1/documents/types/:typeId
 */
const updateDocumentTypeSchema = z.object({
  params: z.object({
    typeId: z.string().uuid(),
  }),
  body: z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    isRequired: z.boolean().optional(),
    supportsAI: z.boolean().optional(),
    aiExtractionFields: z.array(z.string()).optional(),
    isActive: z.boolean().optional(),
  }),
});

router.put(
  '/types/:typeId',
  requirePermission('documents:manage'),
  validateRequest(updateDocumentTypeSchema),
  handleAsync(documentController.updateDocumentType.bind(documentController))
);

/**
 * Delete document type
 * DELETE /api/v1/documents/types/:typeId
 */
router.delete(
  '/types/:typeId',
  requirePermission('documents:manage'),
  handleAsync(documentController.deleteDocumentType.bind(documentController))
);

// ===================
// AI Provider Routes
// ===================

/**
 * Get all AI providers
 * GET /api/v1/documents/ai-providers
 */
router.get(
  '/ai-providers',
  requirePermission('documents:view'),
  handleAsync(documentController.getAIProviders.bind(documentController))
);

/**
 * Get organization AI configuration
 * GET /api/v1/documents/ai-config
 */
router.get(
  '/ai-config',
  requirePermission('settings:view'),
  handleAsync(documentController.getAIConfig.bind(documentController))
);

/**
 * Update organization AI configuration
 * PUT /api/v1/documents/ai-config/:providerId
 */
const updateAIConfigSchema = z.object({
  params: z.object({
    providerId: z.string().uuid(),
  }),
  body: z.object({
    apiKey: z.string().optional(),
    isActive: z.boolean().optional(),
    isDefault: z.boolean().optional(),
    maxTokens: z.number().min(100).max(100000).optional(),
    temperature: z.number().min(0).max(2).optional(),
    settings: z.record(z.any()).optional(),
  }),
});

router.put(
  '/ai-config/:providerId',
  requirePermission('settings:manage'),
  validateRequest(updateAIConfigSchema),
  handleAsync(documentController.updateAIConfig.bind(documentController))
);

// ===================
// Document Routes
// ===================

/**
 * Get documents for a client
 * GET /api/v1/documents/client/:clientId
 */
router.get(
  '/client/:clientId',
  requirePermission('documents:view'),
  handleAsync(documentController.getClientDocuments.bind(documentController))
);

/**
 * Upload document for a client
 * POST /api/v1/documents/:clientId
 */
const uploadDocumentSchema = z.object({
  params: z.object({
    clientId: z.string().uuid(),
  }),
  body: z.object({
    documentTypeId: z.string().uuid(),
    expiryDate: z.string().datetime().optional(),
    notes: z.string().optional(),
  }),
});

router.post(
  '/:clientId',
  requirePermission('documents:create'),
  upload.single('file'),
  handleAsync(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded',
        error: 'MISSING_FILE',
        timestamp: new Date().toISOString(),
      });
    }

    const rawOrganizationId = req.user?.organizationId;
    if (!rawOrganizationId) {
      return res.status(400).json({
        success: false,
        message: 'Organization context required',
        error: 'MISSING_ORGANIZATION',
        timestamp: new Date().toISOString(),
      });
    }

    const organizationId: string = rawOrganizationId;

    // Upload file to storage
    const fileName = `${Date.now()}_${req.file.originalname}`;
    const uploadResult = await storageService.upload(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      req.file.size,
      {
        organizationId,
        entityType: 'clients',
        entityId: req.params.clientId || '',
        fileType: 'DOCUMENT',
      }
    );

    // Add file info to request body for controller
    (req.body as any).file = {
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      storagePath: uploadResult.path,
      storageUrl: uploadResult.url,
    };

    return documentController.uploadDocument(req, res);
  })
);

/**
 * Get document by ID
 * GET /api/v1/documents/:documentId
 */
router.get(
  '/:documentId',
  requirePermission('documents:view'),
  handleAsync(documentController.getDocument.bind(documentController))
);

/**
 * Verify a document
 * POST /api/v1/documents/:documentId/verify
 */
const verifyDocumentSchema = z.object({
  params: z.object({
    documentId: z.string().uuid(),
  }),
  body: z.object({
    status: z.enum(['VERIFIED', 'REJECTED']),
    notes: z.string().optional(),
  }),
});

router.post(
  '/:documentId/verify',
  requirePermission('documents:verify'),
  validateRequest(verifyDocumentSchema),
  handleAsync(documentController.verifyDocument.bind(documentController))
);

/**
 * Extract data from document using AI
 * POST /api/v1/documents/:documentId/extract
 */
const extractDocumentDataSchema = z.object({
  params: z.object({
    documentId: z.string().uuid(),
  }),
  body: z
    .object({
      providerId: z.string().uuid().optional(),
    })
    .optional(),
});

router.post(
  '/:documentId/extract',
  requirePermission('documents:extract'),
  validateRequest(extractDocumentDataSchema),
  handleAsync(documentController.extractDocumentData.bind(documentController))
);

/**
 * Get download URL for a document
 * GET /api/v1/documents/:documentId/download
 */
router.get(
  '/:documentId/download',
  requirePermission('documents:view'),
  handleAsync(documentController.getDownloadUrl.bind(documentController))
);

/**
 * Delete a document
 * DELETE /api/v1/documents/:documentId
 */
router.delete(
  '/:documentId',
  requirePermission('documents:delete'),
  handleAsync(documentController.deleteDocument.bind(documentController))
);

export default router;
