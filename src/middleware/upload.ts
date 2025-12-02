import multer, { FileFilterCallback } from 'multer';
import { Request } from 'express';
import path from 'path';
import { FILE_TYPES, FileType } from '../services/storage.service';

// ===== UPLOAD MIDDLEWARE =====
// Multer configuration with size limits and MIME validation

/**
 * Memory storage - files are stored in memory as Buffer
 * Good for small files that will be immediately uploaded to MinIO
 */
const memoryStorage = multer.memoryStorage();

/**
 * Create file filter based on allowed MIME types
 */
const createFileFilter = (allowedTypes: readonly string[]) => {
  return (
    req: Request,
    file: Express.Multer.File,
    callback: FileFilterCallback
  ) => {
    if (allowedTypes.includes(file.mimetype)) {
      callback(null, true);
    } else {
      callback(
        new Error(
          `Invalid file type: ${file.mimetype}. Allowed types: ${allowedTypes.join(', ')}`
        )
      );
    }
  };
};

/**
 * Create multer instance for a specific file type
 */
const createUploader = (fileType: FileType, fieldName: string = 'file') => {
  const config = FILE_TYPES[fileType];

  return multer({
    storage: memoryStorage,
    limits: {
      fileSize: config.maxSize,
      files: 1,
    },
    fileFilter: createFileFilter(config.mimeTypes),
  }).single(fieldName);
};

/**
 * Create multer instance for multiple files
 */
const createMultiUploader = (
  fileType: FileType,
  fieldName: string = 'files',
  maxCount: number = 10
) => {
  const config = FILE_TYPES[fileType];

  return multer({
    storage: memoryStorage,
    limits: {
      fileSize: config.maxSize,
      files: maxCount,
    },
    fileFilter: createFileFilter(config.mimeTypes),
  }).array(fieldName, maxCount);
};

// Pre-configured uploaders for common use cases

/**
 * Photo upload (5MB, JPEG/PNG/WebP)
 */
export const uploadPhoto = createUploader('PHOTO', 'photo');

/**
 * Thumbprint upload (2MB, JPEG/PNG/BMP)
 */
export const uploadThumbprint = createUploader('THUMBPRINT', 'thumbprint');

/**
 * Signature upload (1MB, JPEG/PNG/SVG)
 */
export const uploadSignature = createUploader('SIGNATURE', 'signature');

/**
 * Document upload (10MB, PDF/JPEG/PNG/DOC/DOCX)
 */
export const uploadDocument = createUploader('DOCUMENT', 'document');

/**
 * Multiple documents upload (10MB each, max 10 files)
 */
export const uploadDocuments = createMultiUploader('DOCUMENT', 'documents', 10);

/**
 * Visit image upload (5MB, JPEG/PNG/WebP)
 */
export const uploadVisitImage = createUploader('VISIT_IMAGE', 'image');

/**
 * Multiple visit images upload (5MB each, max 5 files)
 */
export const uploadVisitImages = createMultiUploader(
  'VISIT_IMAGE',
  'images',
  5
);

/**
 * Pledge image upload (5MB, JPEG/PNG/WebP)
 */
export const uploadPledgeImage = createUploader('PLEDGE_IMAGE', 'image');

/**
 * Multiple pledge images upload (5MB each, max 5 files)
 */
export const uploadPledgeImages = createMultiUploader(
  'PLEDGE_IMAGE',
  'images',
  5
);

/**
 * Generic uploader - accepts file type as parameter
 */
export const createGenericUploader = (
  fileType: FileType,
  fieldName?: string
) => {
  return createUploader(fileType, fieldName);
};

/**
 * Error handler middleware for multer errors
 */
export const handleUploadError = (
  error: any,
  req: Request,
  res: any,
  next: any
) => {
  if (error instanceof multer.MulterError) {
    // Multer-specific errors
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        return res.status(400).json({
          success: false,
          message: 'File too large',
          error: 'FILE_TOO_LARGE',
          timestamp: new Date().toISOString(),
        });
      case 'LIMIT_FILE_COUNT':
        return res.status(400).json({
          success: false,
          message: 'Too many files',
          error: 'TOO_MANY_FILES',
          timestamp: new Date().toISOString(),
        });
      case 'LIMIT_UNEXPECTED_FILE':
        return res.status(400).json({
          success: false,
          message: `Unexpected field: ${error.field}`,
          error: 'UNEXPECTED_FIELD',
          timestamp: new Date().toISOString(),
        });
      default:
        return res.status(400).json({
          success: false,
          message: error.message,
          error: 'UPLOAD_ERROR',
          timestamp: new Date().toISOString(),
        });
    }
  } else if (error) {
    // Generic errors (e.g., file filter rejection)
    return res.status(400).json({
      success: false,
      message: error.message || 'Upload failed',
      error: 'UPLOAD_ERROR',
      timestamp: new Date().toISOString(),
    });
  }

  next();
};

/**
 * Middleware to check if file was uploaded
 */
export const requireFile = (req: Request, res: any, next: any) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: 'No file uploaded',
      error: 'NO_FILE',
      timestamp: new Date().toISOString(),
    });
  }
  next();
};

/**
 * Middleware to check if files were uploaded (for multi-file uploads)
 */
export const requireFiles = (req: Request, res: any, next: any) => {
  if (!req.files || (Array.isArray(req.files) && req.files.length === 0)) {
    return res.status(400).json({
      success: false,
      message: 'No files uploaded',
      error: 'NO_FILES',
      timestamp: new Date().toISOString(),
    });
  }
  next();
};

/**
 * Get file size in human-readable format
 */
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

/**
 * Get file extension from mime type
 */
export const getExtensionFromMime = (mimeType: string): string => {
  const mimeToExt: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/bmp': '.bmp',
    'image/svg+xml': '.svg',
    'application/pdf': '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      '.docx',
  };
  return mimeToExt[mimeType] || '';
};

export default {
  uploadPhoto,
  uploadThumbprint,
  uploadSignature,
  uploadDocument,
  uploadDocuments,
  uploadVisitImage,
  uploadVisitImages,
  uploadPledgeImage,
  uploadPledgeImages,
  createGenericUploader,
  handleUploadError,
  requireFile,
  requireFiles,
  formatFileSize,
  getExtensionFromMime,
};
