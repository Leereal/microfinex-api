/**
 * Import Routes
 * API endpoints for bulk data import from Excel/CSV
 */

import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { authenticateToken, requirePermission } from '../middleware/auth.middleware';
import { validateRequest, handleAsync } from '../middleware/validation.middleware';
import { importService, ImportType } from '../services/import.service';

const router = Router();

// Configure multer for file upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
      'application/vnd.ms-excel', // xls
      'text/csv',
      'application/csv',
    ];
    if (allowedMimes.includes(file.mimetype) || file.originalname.match(/\.(xlsx|xls|csv)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only Excel and CSV files are allowed.'));
    }
  },
});

// All import routes require authentication
router.use(authenticateToken);

/**
 * Get available import types
 * GET /api/import/types
 */
router.get(
  '/types',
  requirePermission('imports:view'),
  handleAsync(async (req, res) => {
    const types = importService.getImportTypes();
    res.json({
      success: true,
      data: types,
    });
  })
);

/**
 * Download import template
 * GET /api/import/template/:type
 */
const templateSchema = z.object({
  params: z.object({
    type: z.enum(['CLIENTS', 'PAYMENTS', 'EMPLOYERS', 'BRANCHES']),
  }),
});

router.get(
  '/template/:type',
  requirePermission('imports:view'),
  validateRequest(templateSchema),
  handleAsync(async (req, res) => {
    const type = req.params.type as ImportType;
    
    const buffer = importService.generateTemplate(type);
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${type.toLowerCase()}_import_template.xlsx`);
    res.send(buffer);
  })
);

/**
 * Validate import file
 * POST /api/import/validate/:type
 */
const validateImportSchema = z.object({
  params: z.object({
    type: z.enum(['CLIENTS', 'PAYMENTS', 'EMPLOYERS', 'BRANCHES']),
  }),
});

router.post(
  '/validate/:type',
  requirePermission('imports:create'),
  upload.single('file'),
  validateRequest(validateImportSchema),
  handleAsync(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded',
      });
    }

    const type = req.params.type as ImportType;
    const organizationId = req.user!.organizationId!;

    // Parse file
    const data = importService.parseFile(req.file.buffer, req.file.originalname);

    if (data.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'File is empty or has no data rows',
      });
    }

    // Validate data
    const result = await importService.validateData(type, data, organizationId);

    res.json({
      success: true,
      data: {
        valid: result.valid,
        rowCount: result.rowCount,
        errorCount: result.errors.length,
        warningCount: result.warnings.length,
        errors: result.errors.slice(0, 50), // Limit errors in response
        warnings: result.warnings.slice(0, 20),
        preview: result.preview,
      },
    });
  })
);

/**
 * Import data from file
 * POST /api/import/:type
 */
const importDataSchema = z.object({
  params: z.object({
    type: z.enum(['CLIENTS', 'PAYMENTS', 'EMPLOYERS', 'BRANCHES']),
  }),
  query: z.object({
    skipDuplicates: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
    updateExisting: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  }).optional(),
});

router.post(
  '/:type',
  requirePermission('imports:create'),
  upload.single('file'),
  validateRequest(importDataSchema),
  handleAsync(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded',
      });
    }

    const type = req.params.type as ImportType;
    const organizationId = req.user!.organizationId!;
    const userId = req.user!.userId;
    const options = {
      skipDuplicates: req.query?.skipDuplicates === 'true',
      updateExisting: req.query?.updateExisting === 'true',
    };

    // Parse file
    const data = importService.parseFile(req.file.buffer, req.file.originalname);

    if (data.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'File is empty or has no data rows',
      });
    }

    // Import data
    const result = await importService.importData(
      type,
      data,
      organizationId,
      userId,
      options
    );

    res.json({
      success: result.success,
      data: {
        imported: result.imported,
        skipped: result.skipped,
        failed: result.failed,
        totalRows: data.length,
        duration: result.duration,
        errors: result.errors.slice(0, 50),
        warnings: result.warnings,
      },
    });
  })
);

/**
 * Import clients
 * POST /api/import/clients
 * Alias for /api/import/CLIENTS
 */
router.post(
  '/clients',
  requirePermission('imports:create'),
  upload.single('file'),
  handleAsync(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded',
      });
    }

    const organizationId = req.user!.organizationId!;
    const userId = req.user!.userId;
    const skipDuplicates = req.query.skipDuplicates === 'true';
    const updateExisting = req.query.updateExisting === 'true';

    const data = importService.parseFile(req.file.buffer, req.file.originalname);

    if (data.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'File is empty',
      });
    }

    const result = await importService.importData(
      'CLIENTS',
      data,
      organizationId,
      userId,
      { skipDuplicates, updateExisting }
    );

    res.json({
      success: result.success,
      data: {
        imported: result.imported,
        skipped: result.skipped,
        failed: result.failed,
        totalRows: data.length,
        duration: result.duration,
        errors: result.errors.slice(0, 50),
      },
    });
  })
);

/**
 * Import payments
 * POST /api/import/payments
 * Alias for /api/import/PAYMENTS
 */
router.post(
  '/payments',
  requirePermission('imports:create'),
  upload.single('file'),
  handleAsync(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded',
      });
    }

    const organizationId = req.user!.organizationId!;
    const userId = req.user!.userId;

    const data = importService.parseFile(req.file.buffer, req.file.originalname);

    if (data.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'File is empty',
      });
    }

    const result = await importService.importData(
      'PAYMENTS',
      data,
      organizationId,
      userId
    );

    res.json({
      success: result.success,
      data: {
        imported: result.imported,
        skipped: result.skipped,
        failed: result.failed,
        totalRows: data.length,
        duration: result.duration,
        errors: result.errors.slice(0, 50),
      },
    });
  })
);

export default router;
