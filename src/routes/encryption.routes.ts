/**
 * Encryption Management Routes
 * Admin endpoints for managing encryption keys, status, and data migration
 */

import { Router, Request, Response, NextFunction } from 'express';
import { encryptionService } from '../services/security/encryption.service';
import { keyManagementService } from '../services/security/key-management.service';
import {
  bulkEncryptTable,
  verifyTableEncryption,
  MODEL_TABLE_MAP,
} from '../services/security/prisma-encryption.middleware';
import {
  ENCRYPTED_FIELDS,
  SensitivityLevel,
} from '../services/security/field-encryption';
import { authenticate, authorize } from '../middleware/auth-supabase';
import { UserRole, JWTPayload } from '../types';
import { prisma } from '../config/database';

const router = Router();

// Helper to get user ID from request
const getUserId = (req: Request): string => {
  const user = req.user as JWTPayload | undefined;
  return user?.userId || 'system';
};

// All routes require SUPER_ADMIN role
router.use(authenticate, authorize(UserRole.SUPER_ADMIN));

/**
 * GET /encryption/status
 * Get encryption service status and key information
 */
router.get(
  '/status',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const status = await encryptionService.getStatus();
      const keyStats = await keyManagementService.getKeyStats();
      const expiringKeys = await keyManagementService.getExpiringKeys(30);

      res.json({
        success: true,
        data: {
          service: status,
          keys: keyStats,
          expiringKeys: expiringKeys.map(k => ({
            id: k.id,
            version: k.version,
            keyType: k.keyType,
            expiresAt: k.expiresAt,
            daysUntilExpiry: Math.ceil(
              (k.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
            ),
          })),
          alerts:
            expiringKeys.length > 0
              ? [`${expiringKeys.length} key(s) expiring within 30 days`]
              : [],
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /encryption/keys
 * List all encryption keys
 */
router.get('/keys', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { organizationId } = req.query;
    const keys = await keyManagementService.getAllKeys(
      organizationId as string
    );

    res.json({
      success: true,
      data: keys.map(k => ({
        id: k.id,
        version: k.version,
        organizationId: k.organizationId,
        keyType: k.keyType,
        algorithm: k.algorithm,
        isActive: k.isActive,
        createdAt: k.createdAt,
        expiresAt: k.expiresAt,
        rotatedAt: k.rotatedAt,
        rotatedBy: k.rotatedBy,
        // Never expose actual key material
      })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /encryption/keys/generate
 * Generate a new encryption key
 */
router.post(
  '/keys/generate',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { organizationId, keyType, expiryDays, metadata } = req.body;

      const key = await keyManagementService.generateKey({
        organizationId,
        keyType: keyType || 'DATA',
        expiryDays: expiryDays || 365,
        metadata: {
          ...metadata,
          generatedBy: getUserId(req),
        },
      });

      res.status(201).json({
        success: true,
        message: 'Encryption key generated successfully',
        data: {
          id: key.id,
          version: key.version,
          keyType: key.keyType,
          isActive: key.isActive,
          expiresAt: key.expiresAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /encryption/keys/rotate
 * Rotate encryption keys and optionally re-encrypt data
 */
router.post(
  '/keys/rotate',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { organizationId, reason, reEncryptData } = req.body;

      const result = await keyManagementService.rotateKey({
        organizationId,
        rotatedBy: getUserId(req),
        reason: reason || 'Manual rotation',
        reEncryptData: reEncryptData !== false, // Default true
      });

      res.json({
        success: true,
        message: 'Key rotation initiated',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /encryption/keys/rotation-status
 * Get current key rotation/re-encryption status
 */
router.get(
  '/keys/rotation-status',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const organizationId = req.query.organizationId as string | undefined;
      const status = keyManagementService.getReEncryptionStatus(organizationId);

      res.json({
        success: true,
        data: status || { inProgress: false, message: 'No active rotation' },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /encryption/keys/:keyId/revoke
 * Revoke a compromised key
 */
router.post(
  '/keys/:keyId/revoke',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const keyId = req.params.keyId;
      const { reason } = req.body;

      if (!keyId) {
        return res.status(400).json({
          success: false,
          error: 'Key ID is required',
        });
      }

      if (!reason) {
        return res.status(400).json({
          success: false,
          error: 'Revocation reason is required',
        });
      }

      await keyManagementService.revokeKey(keyId, getUserId(req), reason);

      res.json({
        success: true,
        message: 'Key revoked successfully',
        warning: 'Data encrypted with this key may no longer be accessible',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /encryption/keys/:keyId/verify
 * Verify key integrity
 */
router.post(
  '/keys/:keyId/verify',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const keyId = req.params.keyId;
      if (!keyId) {
        return res.status(400).json({
          success: false,
          error: 'Key ID is required',
        });
      }
      const result = await keyManagementService.verifyKeyIntegrity(keyId);

      res.json({
        success: result.valid,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /encryption/fields
 * List all encrypted field configurations
 */
router.get(
  '/fields',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const fields = ENCRYPTED_FIELDS.map(f => ({
        table: f.table,
        column: f.column,
        sensitivityLevel: f.sensitivityLevel,
        deterministic: f.deterministic || false,
        maskPattern: f.maskPattern,
        description: f.description,
      }));

      // Group by table
      const byTable: Record<string, typeof fields> = {};
      for (const field of fields) {
        const tableFields = byTable[field.table];
        if (!tableFields) {
          byTable[field.table] = [field];
        } else {
          tableFields.push(field);
        }
      }

      // Summary
      const summary = {
        totalFields: fields.length,
        byLevel: {
          [SensitivityLevel.LOW]: fields.filter(
            f => f.sensitivityLevel === SensitivityLevel.LOW
          ).length,
          [SensitivityLevel.MEDIUM]: fields.filter(
            f => f.sensitivityLevel === SensitivityLevel.MEDIUM
          ).length,
          [SensitivityLevel.HIGH]: fields.filter(
            f => f.sensitivityLevel === SensitivityLevel.HIGH
          ).length,
          [SensitivityLevel.CRITICAL]: fields.filter(
            f => f.sensitivityLevel === SensitivityLevel.CRITICAL
          ).length,
        },
        searchableFields: fields.filter(f => f.deterministic).length,
      };

      res.json({
        success: true,
        data: {
          fields: byTable,
          summary,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /encryption/tables/:tableName/verify
 * Verify encryption status of a table
 */
router.get(
  '/tables/:tableName/verify',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tableName = req.params.tableName;
      if (!tableName) {
        return res.status(400).json({
          success: false,
          error: 'Table name is required',
        });
      }

      const modelName = tableName.charAt(0).toUpperCase() + tableName.slice(1);
      if (!MODEL_TABLE_MAP[modelName]) {
        return res.status(400).json({
          success: false,
          error: 'Invalid or non-encrypted table',
        });
      }

      const result = await verifyTableEncryption(tableName, prisma);

      res.json({
        success: true,
        data: {
          table: tableName,
          ...result,
          encryptionPercentage:
            result.totalRecords > 0
              ? Math.round(
                  (result.encryptedRecords / result.totalRecords) * 100
                )
              : 100,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /encryption/tables/:tableName/encrypt
 * Bulk encrypt existing unencrypted data in a table
 */
router.post(
  '/tables/:tableName/encrypt',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tableName = req.params.tableName;
      const { batchSize, organizationId, dryRun } = req.body;

      if (!tableName) {
        return res.status(400).json({
          success: false,
          error: 'Table name is required',
        });
      }

      const modelName = tableName.charAt(0).toUpperCase() + tableName.slice(1);
      if (!MODEL_TABLE_MAP[modelName]) {
        return res.status(400).json({
          success: false,
          error: 'Invalid or non-encrypted table',
        });
      }

      const result = await bulkEncryptTable(tableName, prisma, {
        batchSize: batchSize || 100,
        organizationId,
        dryRun: dryRun === true,
      });

      res.json({
        success: true,
        message: dryRun ? 'Dry run completed' : 'Bulk encryption completed',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /encryption/backup
 * Export encrypted backup of encryption keys
 */
router.post(
  '/backup',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { masterPassword } = req.body;

      if (!masterPassword || masterPassword.length < 16) {
        return res.status(400).json({
          success: false,
          error: 'Master password must be at least 16 characters',
        });
      }

      const encryptedBackup =
        await keyManagementService.exportKeys(masterPassword);

      // Set headers for file download
      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="encryption-keys-backup-${Date.now()}.json"`
      );

      res.send(encryptedBackup);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /encryption/restore
 * Import encryption keys from backup
 */
router.post(
  '/restore',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { backup, masterPassword } = req.body;

      if (!backup || !masterPassword) {
        return res.status(400).json({
          success: false,
          error: 'Backup data and master password are required',
        });
      }

      const importedCount = await keyManagementService.importKeys(
        backup,
        masterPassword
      );

      res.json({
        success: true,
        message: `${importedCount} keys imported successfully`,
        data: { importedCount },
      });
    } catch (error) {
      if ((error as Error).message.includes('Unsupported state')) {
        return res.status(400).json({
          success: false,
          error: 'Invalid master password or corrupted backup',
        });
      }
      next(error);
    }
  }
);

/**
 * POST /encryption/test
 * Test encryption/decryption with sample data
 */
router.post(
  '/test',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { plaintext } = req.body;

      if (!plaintext) {
        return res.status(400).json({
          success: false,
          error: 'Plaintext is required',
        });
      }

      // Test standard encryption
      const encrypted = encryptionService.encrypt(plaintext);
      const decrypted = encryptionService.decrypt(encrypted);

      // Test deterministic encryption
      const deterministicEncrypted = encryptionService.encrypt(plaintext, {
        deterministic: true,
      });
      const deterministicDecrypted = encryptionService.decrypt(
        deterministicEncrypted
      );

      // Verify determinism (same plaintext = same ciphertext)
      const deterministicEncrypted2 = encryptionService.encrypt(plaintext, {
        deterministic: true,
      });

      res.json({
        success: true,
        data: {
          standard: {
            encrypted: encrypted.substring(0, 50) + '...', // Truncate for display
            decrypted,
            matches: decrypted === plaintext,
          },
          deterministic: {
            encrypted: deterministicEncrypted.substring(0, 50) + '...',
            decrypted: deterministicDecrypted,
            matches: deterministicDecrypted === plaintext,
            isDeterministic: deterministicEncrypted === deterministicEncrypted2,
          },
          masking: {
            default: encryptionService.mask(plaintext),
            middle: encryptionService.maskMiddle(plaintext),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /encryption/audit
 * Get encryption-related audit logs
 */
router.get(
  '/audit',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { limit = 50, offset = 0 } = req.query;

      const logs = await prisma.$queryRaw<
        Array<{
          id: string;
          action: string;
          entityId: string;
          details: Record<string, unknown>;
          createdAt: Date;
        }>
      >`
      SELECT id, action, "entityId", details, "createdAt"
      FROM audit_logs
      WHERE "entityType" = 'ENCRYPTION_KEY'
      ORDER BY "createdAt" DESC
      LIMIT ${Number(limit)}
      OFFSET ${Number(offset)}
    `;

      const total = await prisma.$queryRaw<[{ count: string }]>`
      SELECT COUNT(*) as count FROM audit_logs WHERE "entityType" = 'ENCRYPTION_KEY'
    `;

      res.json({
        success: true,
        data: {
          logs,
          pagination: {
            total: parseInt(total[0].count, 10),
            limit: Number(limit),
            offset: Number(offset),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
