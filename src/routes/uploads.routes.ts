import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../middleware/auth-supabase';
import {
  uploadPhoto,
  uploadThumbprint,
  uploadSignature,
  uploadDocument,
  uploadDocuments,
  uploadVisitImages,
  uploadPledgeImages,
  handleUploadError,
  requireFile,
  requireFiles,
} from '../middleware/upload';
import {
  storageService,
  FileType,
  FILE_TYPES,
} from '../services/storage.service';
import { prisma } from '../config/database';
import { UserRole } from '../types';

const router = Router();

// ===== CLIENT UPLOAD ROUTES =====

/**
 * @swagger
 * /api/v1/uploads/clients/{id}/photo:
 *   post:
 *     summary: Upload client profile photo
 *     tags: [Uploads]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/clients/:id/photo',
  authenticate,
  authorize(UserRole.STAFF, UserRole.MANAGER, UserRole.ADMIN),
  uploadPhoto,
  handleUploadError,
  requireFile,
  async (req: Request, res: Response) => {
    try {
      const orgId = req.user?.organizationId;
      const clientIdParam = req.params.id;

      if (!orgId || !clientIdParam) {
        return res.status(403).json({
          success: false,
          message: 'Organization context and client ID required',
          error: 'FORBIDDEN',
          timestamp: new Date().toISOString(),
        });
      }
      const organizationId: string = orgId;
      const clientId: string = clientIdParam;

      // Verify client exists
      const client = await prisma.client.findFirst({
        where: { id: clientId, organizationId },
      });
      if (!client) {
        return res.status(404).json({
          success: false,
          message: 'Client not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      const file = req.file!;

      // Delete old photo if exists
      if (client.profileImage) {
        await storageService.delete(client.profileImage);
      }

      // Upload new photo
      const result = await storageService.upload(
        file.buffer,
        file.originalname,
        file.mimetype,
        file.size,
        {
          organizationId,
          entityType: 'clients',
          entityId: clientId,
          fileType: 'PHOTO',
        }
      );

      // Update client record
      await prisma.client.update({
        where: { id: clientId },
        data: { profileImage: result.path },
      });

      res.json({
        success: true,
        message: 'Photo uploaded successfully',
        data: {
          url: result.url,
          path: result.path,
          size: result.size,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Upload photo error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Upload failed',
        error: 'UPLOAD_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/uploads/clients/{id}/thumbprint:
 *   post:
 *     summary: Upload client thumbprint biometric
 *     tags: [Uploads]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/clients/:id/thumbprint',
  authenticate,
  authorize(UserRole.STAFF, UserRole.MANAGER, UserRole.ADMIN),
  uploadThumbprint,
  handleUploadError,
  requireFile,
  async (req: Request, res: Response) => {
    try {
      const orgId = req.user?.organizationId;
      const clientIdParam = req.params.id;

      if (!orgId || !clientIdParam) {
        return res.status(403).json({
          success: false,
          message: 'Organization context and client ID required',
          error: 'FORBIDDEN',
          timestamp: new Date().toISOString(),
        });
      }
      const organizationId: string = orgId;
      const clientId: string = clientIdParam;

      // Verify client exists
      const client = await prisma.client.findFirst({
        where: { id: clientId, organizationId },
      });
      if (!client) {
        return res.status(404).json({
          success: false,
          message: 'Client not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      const file = req.file!;

      // Delete old thumbprint if exists
      if (client.thumbprintImage) {
        await storageService.delete(client.thumbprintImage);
      }

      // Upload new thumbprint
      const result = await storageService.upload(
        file.buffer,
        file.originalname,
        file.mimetype,
        file.size,
        {
          organizationId,
          entityType: 'clients',
          entityId: clientId,
          fileType: 'THUMBPRINT',
        }
      );

      // Update client record
      await prisma.client.update({
        where: { id: clientId },
        data: { thumbprintImage: result.path },
      });

      res.json({
        success: true,
        message: 'Thumbprint uploaded successfully',
        data: {
          url: result.url,
          path: result.path,
          size: result.size,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Upload thumbprint error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Upload failed',
        error: 'UPLOAD_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/uploads/clients/{id}/signature:
 *   post:
 *     summary: Upload client signature
 *     tags: [Uploads]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/clients/:id/signature',
  authenticate,
  authorize(UserRole.STAFF, UserRole.MANAGER, UserRole.ADMIN),
  uploadSignature,
  handleUploadError,
  requireFile,
  async (req: Request, res: Response) => {
    try {
      const orgId = req.user?.organizationId;
      const clientIdParam = req.params.id;

      if (!orgId || !clientIdParam) {
        return res.status(403).json({
          success: false,
          message: 'Organization context and client ID required',
          error: 'FORBIDDEN',
          timestamp: new Date().toISOString(),
        });
      }
      const organizationId: string = orgId;
      const clientId: string = clientIdParam;

      // Verify client exists
      const client = await prisma.client.findFirst({
        where: { id: clientId, organizationId },
      });
      if (!client) {
        return res.status(404).json({
          success: false,
          message: 'Client not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      const file = req.file!;

      // Delete old signature if exists
      if (client.signatureImage) {
        await storageService.delete(client.signatureImage);
      }

      // Upload new signature
      const result = await storageService.upload(
        file.buffer,
        file.originalname,
        file.mimetype,
        file.size,
        {
          organizationId,
          entityType: 'clients',
          entityId: clientId,
          fileType: 'SIGNATURE',
        }
      );

      // Update client record
      await prisma.client.update({
        where: { id: clientId },
        data: { signatureImage: result.path },
      });

      res.json({
        success: true,
        message: 'Signature uploaded successfully',
        data: {
          url: result.url,
          path: result.path,
          size: result.size,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Upload signature error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Upload failed',
        error: 'UPLOAD_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

// ===== LOAN UPLOAD ROUTES =====

/**
 * @swagger
 * /api/v1/uploads/loans/{id}/documents:
 *   post:
 *     summary: Upload loan documents
 *     tags: [Uploads]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/loans/:id/documents',
  authenticate,
  authorize(UserRole.STAFF, UserRole.MANAGER, UserRole.ADMIN),
  uploadDocuments,
  handleUploadError,
  requireFiles,
  async (req: Request, res: Response) => {
    try {
      const orgId = req.user?.organizationId;
      const loanIdParam = req.params.id;

      if (!orgId || !loanIdParam) {
        return res.status(403).json({
          success: false,
          message: 'Organization context and loan ID required',
          error: 'FORBIDDEN',
          timestamp: new Date().toISOString(),
        });
      }
      const organizationId: string = orgId;
      const loanId: string = loanIdParam;

      // Verify loan exists
      const loan = await prisma.loan.findFirst({
        where: { id: loanId, organizationId },
      });
      if (!loan) {
        return res.status(404).json({
          success: false,
          message: 'Loan not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      const files = req.files as Express.Multer.File[];
      const uploadedFiles = [];

      for (const file of files) {
        const result = await storageService.upload(
          file.buffer,
          file.originalname,
          file.mimetype,
          file.size,
          {
            organizationId,
            entityType: 'loans',
            entityId: loanId,
            fileType: 'DOCUMENT',
          }
        );
        uploadedFiles.push({
          originalName: file.originalname,
          url: result.url,
          path: result.path,
          size: result.size,
          mimeType: file.mimetype,
        });
      }

      res.json({
        success: true,
        message: `${uploadedFiles.length} document(s) uploaded successfully`,
        data: { documents: uploadedFiles },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Upload documents error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Upload failed',
        error: 'UPLOAD_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/uploads/loans/{id}/visits/{visitId}/images:
 *   post:
 *     summary: Upload visit photos
 *     tags: [Uploads]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/loans/:id/visits/:visitId/images',
  authenticate,
  authorize(UserRole.STAFF, UserRole.MANAGER, UserRole.ADMIN),
  uploadVisitImages,
  handleUploadError,
  requireFiles,
  async (req: Request, res: Response) => {
    try {
      const orgId = req.user?.organizationId;
      const { id: loanIdParam, visitId: visitIdParam } = req.params;

      if (!orgId || !loanIdParam || !visitIdParam) {
        return res.status(403).json({
          success: false,
          message: 'Organization context and IDs required',
          error: 'FORBIDDEN',
          timestamp: new Date().toISOString(),
        });
      }
      const organizationId: string = orgId;
      const loanId: string = loanIdParam;
      const visitId: string = visitIdParam;

      // Verify visit exists
      const visit = await prisma.loanVisit.findFirst({
        where: {
          id: visitId,
          loanId,
          loan: { organizationId },
        },
      });
      if (!visit) {
        return res.status(404).json({
          success: false,
          message: 'Visit not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      const files = req.files as Express.Multer.File[];
      const uploadedPaths: string[] = [];

      for (const file of files) {
        const result = await storageService.upload(
          file.buffer,
          file.originalname,
          file.mimetype,
          file.size,
          {
            organizationId,
            entityType: 'loans',
            entityId: loanId,
            fileType: 'VISIT_IMAGE',
            subEntityId: visitId,
          }
        );
        uploadedPaths.push(result.path);
      }

      // Update visit with new images
      const existingImages = visit.images || [];
      await prisma.loanVisit.update({
        where: { id: visitId },
        data: {
          images: [...existingImages, ...uploadedPaths],
        },
      });

      // Get signed URLs for response
      const urls = await Promise.all(
        uploadedPaths.map(path => storageService.getSignedUrl(path))
      );

      res.json({
        success: true,
        message: `${uploadedPaths.length} image(s) uploaded successfully`,
        data: {
          images: uploadedPaths.map((path, index) => ({
            path,
            url: urls[index],
          })),
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Upload visit images error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Upload failed',
        error: 'UPLOAD_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/uploads/loans/{id}/pledges/{pledgeId}/images:
 *   post:
 *     summary: Upload pledge photos
 *     tags: [Uploads]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/loans/:id/pledges/:pledgeId/images',
  authenticate,
  authorize(UserRole.STAFF, UserRole.MANAGER, UserRole.ADMIN),
  uploadPledgeImages,
  handleUploadError,
  requireFiles,
  async (req: Request, res: Response) => {
    try {
      const orgId = req.user?.organizationId;
      const { id: loanIdParam, pledgeId: pledgeIdParam } = req.params;

      if (!orgId || !loanIdParam || !pledgeIdParam) {
        return res.status(403).json({
          success: false,
          message: 'Organization context and IDs required',
          error: 'FORBIDDEN',
          timestamp: new Date().toISOString(),
        });
      }
      const organizationId: string = orgId;
      const loanId: string = loanIdParam;
      const pledgeId: string = pledgeIdParam;

      // Verify pledge exists
      const pledge = await prisma.securityPledge.findFirst({
        where: {
          id: pledgeId,
          loanId,
          loan: { organizationId },
        },
      });
      if (!pledge) {
        return res.status(404).json({
          success: false,
          message: 'Pledge not found',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      const files = req.files as Express.Multer.File[];
      const uploadedPaths: string[] = [];

      for (const file of files) {
        const result = await storageService.upload(
          file.buffer,
          file.originalname,
          file.mimetype,
          file.size,
          {
            organizationId,
            entityType: 'loans',
            entityId: loanId,
            fileType: 'PLEDGE_IMAGE',
            subEntityId: pledgeId,
          }
        );
        uploadedPaths.push(result.path);
      }

      // Update pledge with new images
      const existingImages = pledge.images || [];
      await prisma.securityPledge.update({
        where: { id: pledgeId },
        data: {
          images: [...existingImages, ...uploadedPaths],
        },
      });

      // Get signed URLs for response
      const urls = await Promise.all(
        uploadedPaths.map(path => storageService.getSignedUrl(path))
      );

      res.json({
        success: true,
        message: `${uploadedPaths.length} image(s) uploaded successfully`,
        data: {
          images: uploadedPaths.map((path, index) => ({
            path,
            url: urls[index],
          })),
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Upload pledge images error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Upload failed',
        error: 'UPLOAD_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

// ===== FILE MANAGEMENT ROUTES =====

/**
 * @swagger
 * /api/v1/uploads/signed-url:
 *   get:
 *     summary: Get signed URL for a file
 *     tags: [Uploads]
 *     security:
 *       - bearerAuth: []
 */
router.get('/signed-url', authenticate, async (req: Request, res: Response) => {
  try {
    const { path: filePath } = req.query;

    if (!filePath || typeof filePath !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'File path is required',
        error: 'BAD_REQUEST',
        timestamp: new Date().toISOString(),
      });
    }

    const url = await storageService.getSignedUrl(filePath);

    res.json({
      success: true,
      message: 'Signed URL generated successfully',
      data: { url },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Get signed URL error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to generate URL',
      error: 'URL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @swagger
 * /api/v1/uploads/delete:
 *   delete:
 *     summary: Delete a file
 *     tags: [Uploads]
 *     security:
 *       - bearerAuth: []
 */
router.delete(
  '/delete',
  authenticate,
  authorize(UserRole.MANAGER, UserRole.ADMIN),
  async (req: Request, res: Response) => {
    try {
      const { path: filePath } = req.query;

      if (!filePath || typeof filePath !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'File path is required',
          error: 'BAD_REQUEST',
          timestamp: new Date().toISOString(),
        });
      }

      const deleted = await storageService.delete(filePath);

      if (!deleted) {
        return res.status(404).json({
          success: false,
          message: 'File not found or already deleted',
          error: 'NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }

      res.json({
        success: true,
        message: 'File deleted successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Delete file error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to delete file',
        error: 'DELETE_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/uploads/list:
 *   get:
 *     summary: List files in a directory
 *     tags: [Uploads]
 *     security:
 *       - bearerAuth: []
 */
router.get('/list', authenticate, async (req: Request, res: Response) => {
  try {
    const organizationId = req.user?.organizationId;
    const { entityType, entityId, fileType } = req.query;

    if (!organizationId) {
      return res.status(403).json({
        success: false,
        message: 'Organization context required',
        error: 'FORBIDDEN',
        timestamp: new Date().toISOString(),
      });
    }

    // Build prefix based on query params
    let prefix = organizationId;
    if (entityType) prefix += `/${entityType}`;
    if (entityId) prefix += `/${entityId}`;
    if (fileType && FILE_TYPES[fileType as FileType]) {
      prefix += `/${FILE_TYPES[fileType as FileType].folder}`;
    }

    const files = await storageService.listFiles(prefix);

    res.json({
      success: true,
      message: 'Files listed successfully',
      data: { files },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('List files error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to list files',
      error: 'LIST_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
