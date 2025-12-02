import { Client } from 'minio';
import { Readable } from 'stream';
import crypto from 'crypto';
import path from 'path';

// ===== STORAGE SERVICE (MinIO) =====
// Handles file uploads with MinIO S3-compatible storage
// Namespace: orgId/clients/clientId/type/filename

// MinIO configuration from environment
const minioConfig = {
  endPoint: process.env.MINIO_ENDPOINT || 'localhost',
  port: parseInt(process.env.MINIO_PORT || '9000'),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
  secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
};

const BUCKET_NAME = process.env.MINIO_BUCKET || 'microfinex';
const PRESIGNED_URL_EXPIRY = parseInt(process.env.MINIO_URL_EXPIRY || '3600'); // 1 hour default

// File type configurations
export const FILE_TYPES = {
  PHOTO: {
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    maxSize: 5 * 1024 * 1024, // 5MB
    folder: 'photos',
  },
  THUMBPRINT: {
    mimeTypes: ['image/jpeg', 'image/png', 'image/bmp'],
    maxSize: 2 * 1024 * 1024, // 2MB
    folder: 'thumbprints',
  },
  SIGNATURE: {
    mimeTypes: ['image/jpeg', 'image/png', 'image/svg+xml'],
    maxSize: 1 * 1024 * 1024, // 1MB
    folder: 'signatures',
  },
  DOCUMENT: {
    mimeTypes: [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    maxSize: 10 * 1024 * 1024, // 10MB
    folder: 'documents',
  },
  VISIT_IMAGE: {
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    maxSize: 5 * 1024 * 1024, // 5MB
    folder: 'visits',
  },
  PLEDGE_IMAGE: {
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    maxSize: 5 * 1024 * 1024, // 5MB
    folder: 'pledges',
  },
} as const;

export type FileType = keyof typeof FILE_TYPES;

interface UploadResult {
  url: string;
  path: string;
  filename: string;
  size: number;
  mimeType: string;
  etag: string;
}

interface UploadOptions {
  organizationId: string;
  entityType: 'clients' | 'loans';
  entityId: string;
  fileType: FileType;
  subEntityId?: string; // For visits/:visitId or pledges/:pledgeId
}

class StorageService {
  private client: Client;
  private initialized: boolean = false;

  constructor() {
    this.client = new Client(minioConfig);
  }

  /**
   * Initialize the storage service (create bucket if needed)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const bucketExists = await this.client.bucketExists(BUCKET_NAME);
      if (!bucketExists) {
        await this.client.makeBucket(BUCKET_NAME, 'us-east-1');
        console.log(`Created MinIO bucket: ${BUCKET_NAME}`);
      }
      this.initialized = true;
      console.log('Storage service initialized successfully');
    } catch (error) {
      console.error('Failed to initialize storage service:', error);
      throw error;
    }
  }

  /**
   * Generate storage path based on namespace
   * Format: orgId/entityType/entityId/fileType/[subEntityId/]filename
   */
  private generatePath(options: UploadOptions, filename: string): string {
    const { organizationId, entityType, entityId, fileType, subEntityId } =
      options;
    const typeConfig = FILE_TYPES[fileType];

    const parts = [organizationId, entityType, entityId, typeConfig.folder];
    if (subEntityId) {
      parts.push(subEntityId);
    }
    parts.push(filename);

    return parts.join('/');
  }

  /**
   * Generate unique filename with hash
   */
  private generateFilename(originalName: string): string {
    const ext = path.extname(originalName).toLowerCase();
    const hash = crypto.randomBytes(8).toString('hex');
    const timestamp = Date.now();
    return `${timestamp}-${hash}${ext}`;
  }

  /**
   * Validate file against type constraints
   */
  validateFile(
    fileType: FileType,
    mimeType: string,
    size: number
  ): { valid: boolean; error?: string } {
    const config = FILE_TYPES[fileType];

    if (!(config.mimeTypes as readonly string[]).includes(mimeType)) {
      return {
        valid: false,
        error: `Invalid file type. Allowed: ${config.mimeTypes.join(', ')}`,
      };
    }

    if (size > config.maxSize) {
      const maxSizeMB = config.maxSize / (1024 * 1024);
      return {
        valid: false,
        error: `File too large. Maximum size: ${maxSizeMB}MB`,
      };
    }

    return { valid: true };
  }

  /**
   * Upload a file to storage
   */
  async upload(
    file: Buffer | Readable,
    originalFilename: string,
    mimeType: string,
    size: number,
    options: UploadOptions
  ): Promise<UploadResult> {
    await this.initialize();

    // Validate file
    const validation = this.validateFile(options.fileType, mimeType, size);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // Generate filename and path
    const filename = this.generateFilename(originalFilename);
    const storagePath = this.generatePath(options, filename);

    // Upload to MinIO
    const metadata = {
      'Content-Type': mimeType,
      'X-Original-Filename': originalFilename,
      'X-Upload-Time': new Date().toISOString(),
      'X-Organization-Id': options.organizationId,
      'X-Entity-Type': options.entityType,
      'X-Entity-Id': options.entityId,
      'X-File-Type': options.fileType,
    };

    const result = await this.client.putObject(
      BUCKET_NAME,
      storagePath,
      file,
      size,
      metadata
    );

    // Generate URL
    const url = await this.getSignedUrl(storagePath);

    return {
      url,
      path: storagePath,
      filename,
      size,
      mimeType,
      etag: result.etag,
    };
  }

  /**
   * Get a presigned URL for downloading a file
   */
  async getSignedUrl(
    storagePath: string,
    expirySeconds?: number
  ): Promise<string> {
    await this.initialize();

    const expiry = expirySeconds || PRESIGNED_URL_EXPIRY;
    return this.client.presignedGetObject(BUCKET_NAME, storagePath, expiry);
  }

  /**
   * Get a presigned URL for uploading a file directly
   */
  async getUploadUrl(
    options: UploadOptions,
    originalFilename: string,
    expirySeconds?: number
  ): Promise<{ uploadUrl: string; path: string; filename: string }> {
    await this.initialize();

    const filename = this.generateFilename(originalFilename);
    const storagePath = this.generatePath(options, filename);
    const expiry = expirySeconds || PRESIGNED_URL_EXPIRY;

    const uploadUrl = await this.client.presignedPutObject(
      BUCKET_NAME,
      storagePath,
      expiry
    );

    return {
      uploadUrl,
      path: storagePath,
      filename,
    };
  }

  /**
   * Delete a file from storage
   */
  async delete(storagePath: string): Promise<boolean> {
    await this.initialize();

    try {
      await this.client.removeObject(BUCKET_NAME, storagePath);
      return true;
    } catch (error) {
      console.error('Failed to delete file:', error);
      return false;
    }
  }

  /**
   * Delete multiple files from storage
   */
  async deleteMany(
    storagePaths: string[]
  ): Promise<{ deleted: string[]; failed: string[] }> {
    await this.initialize();

    const deleted: string[] = [];
    const failed: string[] = [];

    for (const path of storagePaths) {
      try {
        await this.client.removeObject(BUCKET_NAME, path);
        deleted.push(path);
      } catch (error) {
        console.error(`Failed to delete ${path}:`, error);
        failed.push(path);
      }
    }

    return { deleted, failed };
  }

  /**
   * Check if a file exists
   */
  async exists(storagePath: string): Promise<boolean> {
    await this.initialize();

    try {
      await this.client.statObject(BUCKET_NAME, storagePath);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get file metadata
   */
  async getMetadata(storagePath: string): Promise<{
    size: number;
    contentType: string;
    lastModified: Date;
    etag: string;
    metadata: Record<string, string>;
  } | null> {
    await this.initialize();

    try {
      const stat = await this.client.statObject(BUCKET_NAME, storagePath);
      return {
        size: stat.size,
        contentType:
          stat.metaData?.['content-type'] || 'application/octet-stream',
        lastModified: stat.lastModified,
        etag: stat.etag,
        metadata: stat.metaData || {},
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * List files in a directory
   */
  async listFiles(prefix: string): Promise<
    Array<{
      name: string;
      path: string;
      size: number;
      lastModified: Date;
    }>
  > {
    await this.initialize();

    return new Promise((resolve, reject) => {
      const files: Array<{
        name: string;
        path: string;
        size: number;
        lastModified: Date;
      }> = [];

      const stream = this.client.listObjects(BUCKET_NAME, prefix, true);

      stream.on('data', obj => {
        if (obj.name) {
          files.push({
            name: path.basename(obj.name),
            path: obj.name,
            size: obj.size || 0,
            lastModified: obj.lastModified || new Date(),
          });
        }
      });

      stream.on('error', err => {
        reject(err);
      });

      stream.on('end', () => {
        resolve(files);
      });
    });
  }

  /**
   * Copy a file to a new location
   */
  async copy(sourcePath: string, destPath: string): Promise<boolean> {
    await this.initialize();

    try {
      await this.client.copyObject(
        BUCKET_NAME,
        destPath,
        `/${BUCKET_NAME}/${sourcePath}`,
        null as any
      );
      return true;
    } catch (error) {
      console.error('Failed to copy file:', error);
      return false;
    }
  }

  /**
   * Generate public URL (if bucket policy allows)
   */
  getPublicUrl(storagePath: string): string {
    const protocol = minioConfig.useSSL ? 'https' : 'http';
    const port =
      minioConfig.port !== 80 && minioConfig.port !== 443
        ? `:${minioConfig.port}`
        : '';
    return `${protocol}://${minioConfig.endPoint}${port}/${BUCKET_NAME}/${storagePath}`;
  }
}

// Export singleton instance
export const storageService = new StorageService();

export default storageService;
