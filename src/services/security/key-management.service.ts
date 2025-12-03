/**
 * Key Management Service
 * Handles encryption key lifecycle: generation, rotation, storage, and versioning
 */

import crypto from 'crypto';
import { prisma } from '../../config/database';
import { encryptionService } from './encryption.service';

const KEY_LENGTH = 32; // 256 bits
const KEY_EXPIRY_DAYS = 365; // Keys expire after 1 year

export interface EncryptionKeyRecord {
  id: string;
  version: number;
  organizationId: string | null;
  keyType: 'DATA' | 'TRANSPORT' | 'SIGNING';
  algorithm: string;
  isActive: boolean;
  createdAt: Date;
  expiresAt: Date;
  rotatedAt: Date | null;
  rotatedBy: string | null;
  metadata: Record<string, unknown>;
}

export interface KeyGenerationOptions {
  organizationId?: string;
  keyType?: 'DATA' | 'TRANSPORT' | 'SIGNING';
  expiryDays?: number;
  metadata?: Record<string, unknown>;
}

export interface KeyRotationOptions {
  organizationId?: string;
  rotatedBy: string;
  reason?: string;
  reEncryptData?: boolean;
}

export interface KeyRotationStatus {
  inProgress: boolean;
  startedAt?: Date;
  completedAt?: Date;
  progress: number;
  tablesProcessed: string[];
  recordsUpdated: number;
  errors: string[];
}

class KeyManagementService {
  private rotationStatus: Map<string, KeyRotationStatus> = new Map();

  /**
   * Generate a new encryption key
   */
  async generateKey(
    options: KeyGenerationOptions = {}
  ): Promise<EncryptionKeyRecord> {
    const {
      organizationId = null,
      keyType = 'DATA',
      expiryDays = KEY_EXPIRY_DAYS,
      metadata = {},
    } = options;

    // Generate random key
    const rawKey = crypto.randomBytes(KEY_LENGTH);
    const keyId = crypto.randomUUID();

    // Get current max version for this org/type
    const maxVersionResult = await prisma.$queryRaw<[{ max: number | null }]>`
      SELECT MAX(version) as max FROM encryption_keys
      WHERE ("organizationId" = ${organizationId} OR ("organizationId" IS NULL AND ${organizationId} IS NULL))
        AND "keyType" = ${keyType}
    `;
    const newVersion = (maxVersionResult[0]?.max || 0) + 1;

    // Encrypt key with master key for storage
    const encryptedKey = encryptionService.encrypt(rawKey.toString('base64'));

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiryDays);

    // Insert key record
    await prisma.$executeRaw`
      INSERT INTO encryption_keys (
        id, version, "organizationId", "keyType", algorithm,
        "encryptedKey", "isActive", "createdAt", "expiresAt", metadata
      ) VALUES (
        ${keyId}, ${newVersion}, ${organizationId}, ${keyType}, 'aes-256-gcm',
        ${encryptedKey}, true, NOW(), ${expiresAt}, ${JSON.stringify(metadata)}::jsonb
      )
    `;

    // Deactivate previous active keys of same type/org
    await prisma.$executeRaw`
      UPDATE encryption_keys
      SET "isActive" = false
      WHERE id != ${keyId}
        AND ("organizationId" = ${organizationId} OR ("organizationId" IS NULL AND ${organizationId} IS NULL))
        AND "keyType" = ${keyType}
        AND "isActive" = true
    `;

    // Log key generation
    await this.logKeyEvent('KEY_GENERATED', keyId, {
      version: newVersion,
      keyType,
      organizationId,
      expiresAt,
    });

    return {
      id: keyId,
      version: newVersion,
      organizationId,
      keyType,
      algorithm: 'aes-256-gcm',
      isActive: true,
      createdAt: new Date(),
      expiresAt,
      rotatedAt: null,
      rotatedBy: null,
      metadata,
    };
  }

  /**
   * Get active encryption key
   */
  async getActiveKey(
    organizationId?: string,
    keyType: string = 'DATA'
  ): Promise<EncryptionKeyRecord | null> {
    const keys = await prisma.$queryRaw<EncryptionKeyRecord[]>`
      SELECT id, version, "organizationId", "keyType", algorithm,
             "isActive", "createdAt", "expiresAt", "rotatedAt", "rotatedBy", metadata
      FROM encryption_keys
      WHERE ("organizationId" = ${organizationId || null} OR ("organizationId" IS NULL AND ${organizationId || null} IS NULL))
        AND "keyType" = ${keyType}
        AND "isActive" = true
      ORDER BY version DESC
      LIMIT 1
    `;

    return keys[0] || null;
  }

  /**
   * Get all keys (for admin dashboard)
   */
  async getAllKeys(organizationId?: string): Promise<EncryptionKeyRecord[]> {
    const keys = await prisma.$queryRaw<EncryptionKeyRecord[]>`
      SELECT id, version, "organizationId", "keyType", algorithm,
             "isActive", "createdAt", "expiresAt", "rotatedAt", "rotatedBy", metadata
      FROM encryption_keys
      WHERE ${organizationId ? prisma.$queryRaw`"organizationId" = ${organizationId}` : prisma.$queryRaw`true`}
      ORDER BY "createdAt" DESC
    `;

    return keys;
  }

  /**
   * Check for expiring keys
   */
  async getExpiringKeys(
    daysThreshold: number = 30
  ): Promise<EncryptionKeyRecord[]> {
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() + daysThreshold);

    const keys = await prisma.$queryRaw<EncryptionKeyRecord[]>`
      SELECT id, version, "organizationId", "keyType", algorithm,
             "isActive", "createdAt", "expiresAt", "rotatedAt", "rotatedBy", metadata
      FROM encryption_keys
      WHERE "isActive" = true
        AND "expiresAt" <= ${thresholdDate}
      ORDER BY "expiresAt" ASC
    `;

    return keys;
  }

  /**
   * Rotate encryption key
   */
  async rotateKey(options: KeyRotationOptions): Promise<{
    oldKeyId: string;
    newKeyId: string;
    version: number;
    reEncryptionStarted: boolean;
  }> {
    const {
      organizationId,
      rotatedBy,
      reason = 'Scheduled rotation',
      reEncryptData = true,
    } = options;

    // Get current active key
    const currentKey = await this.getActiveKey(organizationId);
    if (!currentKey) {
      throw new Error('No active key found to rotate');
    }

    // Generate new key
    const newKey = await this.generateKey({
      organizationId,
      keyType: currentKey.keyType,
      metadata: {
        rotatedFrom: currentKey.id,
        rotationReason: reason,
      },
    });

    // Update old key with rotation info
    await prisma.$executeRaw`
      UPDATE encryption_keys
      SET "rotatedAt" = NOW(), "rotatedBy" = ${rotatedBy}
      WHERE id = ${currentKey.id}
    `;

    // Log rotation
    await this.logKeyEvent('KEY_ROTATED', newKey.id, {
      previousKeyId: currentKey.id,
      previousVersion: currentKey.version,
      newVersion: newKey.version,
      rotatedBy,
      reason,
    });

    // Start re-encryption if requested
    if (reEncryptData) {
      this.startReEncryption(
        organizationId || 'global',
        currentKey.id,
        newKey.id,
        rotatedBy
      );
    }

    return {
      oldKeyId: currentKey.id,
      newKeyId: newKey.id,
      version: newKey.version,
      reEncryptionStarted: reEncryptData,
    };
  }

  /**
   * Start background re-encryption of data
   */
  private async startReEncryption(
    scope: string,
    oldKeyId: string,
    newKeyId: string,
    userId: string
  ): Promise<void> {
    const status: KeyRotationStatus = {
      inProgress: true,
      startedAt: new Date(),
      progress: 0,
      tablesProcessed: [],
      recordsUpdated: 0,
      errors: [],
    };

    this.rotationStatus.set(scope, status);

    // Run re-encryption in background
    setImmediate(async () => {
      try {
        const result = await encryptionService.rotateKeys(
          scope === 'global' ? undefined : scope
        );

        status.completedAt = new Date();
        status.inProgress = false;
        status.progress = 100;
        status.tablesProcessed = result.tablesProcessed;
        status.recordsUpdated = result.fieldsUpdated;

        await this.logKeyEvent('REENCRYPTION_COMPLETE', newKeyId, {
          oldKeyId,
          recordsUpdated: result.fieldsUpdated,
          duration: result.duration,
        });
      } catch (error) {
        status.inProgress = false;
        status.errors.push((error as Error).message);

        await this.logKeyEvent('REENCRYPTION_FAILED', newKeyId, {
          oldKeyId,
          error: (error as Error).message,
        });
      }

      this.rotationStatus.set(scope, status);
    });
  }

  /**
   * Get re-encryption status
   */
  getReEncryptionStatus(organizationId?: string): KeyRotationStatus | null {
    const scope = organizationId || 'global';
    return this.rotationStatus.get(scope) || null;
  }

  /**
   * Revoke a key (mark as compromised)
   */
  async revokeKey(
    keyId: string,
    revokedBy: string,
    reason: string
  ): Promise<void> {
    await prisma.$executeRaw`
      UPDATE encryption_keys
      SET "isActive" = false,
          metadata = metadata || ${JSON.stringify({
            revokedAt: new Date().toISOString(),
            revokedBy,
            revocationReason: reason,
          })}::jsonb
      WHERE id = ${keyId}
    `;

    await this.logKeyEvent('KEY_REVOKED', keyId, {
      revokedBy,
      reason,
    });

    // Alert about revoked key - in production, this would trigger notifications
    console.warn(
      `⚠️ SECURITY ALERT: Encryption key ${keyId} has been revoked. Reason: ${reason}`
    );
  }

  /**
   * Backup encryption keys (encrypted)
   */
  async exportKeys(masterPassword: string): Promise<string> {
    const keys = await prisma.$queryRaw<
      Array<{
        id: string;
        version: number;
        encryptedKey: string;
        keyType: string;
        organizationId: string | null;
        createdAt: Date;
        expiresAt: Date;
      }>
    >`
      SELECT id, version, "encryptedKey", "keyType", "organizationId", "createdAt", "expiresAt"
      FROM encryption_keys
      WHERE "isActive" = true
    `;

    const backup = {
      exportedAt: new Date().toISOString(),
      version: 1,
      keys: keys.map(k => ({
        id: k.id,
        version: k.version,
        keyType: k.keyType,
        organizationId: k.organizationId,
        encryptedKey: k.encryptedKey, // Already encrypted
        createdAt: k.createdAt,
        expiresAt: k.expiresAt,
      })),
    };

    // Encrypt the backup with master password
    const salt = crypto.randomBytes(32);
    const key = crypto.pbkdf2Sync(masterPassword, salt, 100000, 32, 'sha512');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    let encrypted = cipher.update(JSON.stringify(backup), 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const authTag = cipher.getAuthTag();

    return JSON.stringify({
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      data: encrypted,
    });
  }

  /**
   * Import encryption keys from backup
   */
  async importKeys(
    encryptedBackup: string,
    masterPassword: string
  ): Promise<number> {
    const { salt, iv, authTag, data } = JSON.parse(encryptedBackup);

    const key = crypto.pbkdf2Sync(
      masterPassword,
      Buffer.from(salt, 'base64'),
      100000,
      32,
      'sha512'
    );

    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(authTag, 'base64'));

    let decrypted = decipher.update(data, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    const backup = JSON.parse(decrypted);
    let importedCount = 0;

    for (const keyData of backup.keys) {
      try {
        await prisma.$executeRaw`
          INSERT INTO encryption_keys (
            id, version, "organizationId", "keyType", algorithm,
            "encryptedKey", "isActive", "createdAt", "expiresAt", metadata
          ) VALUES (
            ${keyData.id}, ${keyData.version}, ${keyData.organizationId},
            ${keyData.keyType}, 'aes-256-gcm', ${keyData.encryptedKey},
            false, ${new Date(keyData.createdAt)}, ${new Date(keyData.expiresAt)},
            ${JSON.stringify({ importedAt: new Date().toISOString() })}::jsonb
          )
          ON CONFLICT (id) DO NOTHING
        `;
        importedCount++;
      } catch (error) {
        console.error(`Failed to import key ${keyData.id}:`, error);
      }
    }

    await this.logKeyEvent('KEYS_IMPORTED', 'system', {
      importedCount,
      totalKeys: backup.keys.length,
    });

    return importedCount;
  }

  /**
   * Get key usage statistics
   */
  async getKeyStats(): Promise<{
    totalKeys: number;
    activeKeys: number;
    expiringKeys: number;
    rotationsPastMonth: number;
    oldestActiveKey: Date | null;
  }> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    const stats = await prisma.$queryRaw<
      [
        {
          total: string;
          active: string;
          expiring: string;
          rotations: string;
          oldest: Date | null;
        },
      ]
    >`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE "isActive" = true) as active,
        COUNT(*) FILTER (WHERE "isActive" = true AND "expiresAt" <= ${thirtyDaysFromNow}) as expiring,
        COUNT(*) FILTER (WHERE "rotatedAt" >= ${thirtyDaysAgo}) as rotations,
        MIN("createdAt") FILTER (WHERE "isActive" = true) as oldest
      FROM encryption_keys
    `;

    return {
      totalKeys: parseInt(stats[0].total, 10),
      activeKeys: parseInt(stats[0].active, 10),
      expiringKeys: parseInt(stats[0].expiring, 10),
      rotationsPastMonth: parseInt(stats[0].rotations, 10),
      oldestActiveKey: stats[0].oldest,
    };
  }

  /**
   * Log key management event
   */
  private async logKeyEvent(
    action: string,
    keyId: string,
    details: Record<string, unknown>
  ): Promise<void> {
    try {
      await prisma.$executeRaw`
        INSERT INTO audit_logs (id, action, "entityType", "entityId", details, "createdAt")
        VALUES (
          ${crypto.randomUUID()},
          ${action},
          'ENCRYPTION_KEY',
          ${keyId},
          ${JSON.stringify(details)}::jsonb,
          NOW()
        )
      `;
    } catch (error) {
      console.error('Failed to log key event:', error);
    }
  }

  /**
   * Verify key integrity
   */
  async verifyKeyIntegrity(keyId: string): Promise<{
    valid: boolean;
    message: string;
  }> {
    try {
      const key = await prisma.$queryRaw<
        Array<{
          encryptedKey: string;
          isActive: boolean;
          expiresAt: Date;
        }>
      >`
        SELECT "encryptedKey", "isActive", "expiresAt"
        FROM encryption_keys
        WHERE id = ${keyId}
      `;

      if (!key[0]) {
        return { valid: false, message: 'Key not found' };
      }

      // Try to decrypt the key
      const decrypted = encryptionService.decrypt(key[0].encryptedKey);
      if (!decrypted) {
        return { valid: false, message: 'Key decryption failed' };
      }

      // Check if key is expired
      if (key[0].expiresAt < new Date()) {
        return { valid: false, message: 'Key has expired' };
      }

      return { valid: true, message: 'Key integrity verified' };
    } catch (error) {
      return {
        valid: false,
        message: `Verification failed: ${(error as Error).message}`,
      };
    }
  }
}

// Export singleton instance
export const keyManagementService = new KeyManagementService();
