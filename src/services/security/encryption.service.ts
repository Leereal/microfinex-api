/**
 * Data Encryption Service
 * Provides AES-256-GCM encryption for data at rest
 *
 * Features:
 * - Field-level encryption for sensitive data
 * - Key rotation support with versioning
 * - Deterministic encryption for searchable fields
 * - Automatic key derivation per organization
 */

import crypto from 'crypto';
import { prisma } from '../../config/database';

// Encryption configuration
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16; // 128 bits
const SALT_LENGTH = 32;
const KEY_LENGTH = 32; // 256 bits
const PBKDF2_ITERATIONS = 100000;

// Encrypted data format: version:iv:authTag:encryptedData (all base64)
const ENCRYPTED_PREFIX = 'enc:v';
const CURRENT_VERSION = 1;

// Deterministic encryption uses HMAC for searchable encrypted fields
const DETERMINISTIC_ALGORITHM = 'aes-256-cbc';

interface EncryptionKey {
  id: string;
  version: number;
  key: Buffer;
  createdAt: Date;
  expiresAt?: Date;
  isActive: boolean;
}

interface EncryptedValue {
  version: number;
  iv: string;
  authTag: string;
  data: string;
  keyId?: string;
}

interface EncryptionOptions {
  deterministic?: boolean; // For searchable encrypted fields
  keyId?: string; // Specific key to use
  organizationId?: string; // For org-specific keys
}

interface KeyRotationResult {
  fieldsUpdated: number;
  tablesProcessed: string[];
  oldKeyId: string;
  newKeyId: string;
  duration: number;
}

class EncryptionService {
  private masterKey: Buffer | null = null;
  private keyCache: Map<string, EncryptionKey> = new Map();
  private deterministicKey: Buffer | null = null;

  /**
   * Initialize the encryption service with master key
   */
  async initialize(): Promise<void> {
    const masterKeyEnv = process.env.ENCRYPTION_MASTER_KEY;

    if (!masterKeyEnv) {
      console.warn(
        '⚠️ ENCRYPTION_MASTER_KEY not set - encryption service disabled'
      );
      return;
    }

    // Derive master key from environment variable
    const salt = process.env.ENCRYPTION_KEY_SALT || 'microfinex-default-salt';
    this.masterKey = crypto.pbkdf2Sync(
      masterKeyEnv,
      salt,
      PBKDF2_ITERATIONS,
      KEY_LENGTH,
      'sha512'
    );

    // Derive deterministic encryption key
    this.deterministicKey = crypto.pbkdf2Sync(
      masterKeyEnv + ':deterministic',
      salt,
      PBKDF2_ITERATIONS,
      KEY_LENGTH,
      'sha512'
    );

    // Load active keys from database
    await this.loadActiveKeys();

    console.log('✅ Encryption service initialized');
  }

  /**
   * Check if encryption is enabled
   */
  isEnabled(): boolean {
    return this.masterKey !== null;
  }

  /**
   * Load active encryption keys from database
   */
  private async loadActiveKeys(): Promise<void> {
    try {
      const keys = await prisma.$queryRaw<
        Array<{
          id: string;
          version: number;
          encryptedKey: string;
          createdAt: Date;
          expiresAt: Date | null;
          isActive: boolean;
        }>
      >`
        SELECT id, version, "encryptedKey", "createdAt", "expiresAt", "isActive"
        FROM encryption_keys
        WHERE "isActive" = true OR "expiresAt" > NOW()
        ORDER BY version DESC
      `;

      for (const keyRecord of keys) {
        const decryptedKey = this.decryptKeyWithMaster(keyRecord.encryptedKey);
        this.keyCache.set(keyRecord.id, {
          id: keyRecord.id,
          version: keyRecord.version,
          key: decryptedKey,
          createdAt: keyRecord.createdAt,
          expiresAt: keyRecord.expiresAt || undefined,
          isActive: keyRecord.isActive,
        });
      }
    } catch (error) {
      // Table might not exist yet
      console.log(
        '📝 Encryption keys table not found, will create on first use'
      );
    }
  }

  /**
   * Encrypt data using the master key
   */
  private encryptWithMaster(data: string): string {
    if (!this.masterKey) {
      throw new Error('Encryption service not initialized');
    }

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.masterKey, iv);

    let encrypted = cipher.update(data, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    const authTag = cipher.getAuthTag();

    return `${ENCRYPTED_PREFIX}${CURRENT_VERSION}:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
  }

  /**
   * Decrypt data using the master key
   */
  private decryptWithMaster(encryptedData: string): string {
    if (!this.masterKey) {
      throw new Error('Encryption service not initialized');
    }

    const parsed = this.parseEncryptedValue(encryptedData);

    const iv = Buffer.from(parsed.iv, 'base64');
    const authTag = Buffer.from(parsed.authTag, 'base64');
    const data = Buffer.from(parsed.data, 'base64');

    const decipher = crypto.createDecipheriv(ALGORITHM, this.masterKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(data);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString('utf8');
  }

  /**
   * Decrypt a key that was encrypted with master key
   */
  private decryptKeyWithMaster(encryptedKey: string): Buffer {
    const decrypted = this.decryptWithMaster(encryptedKey);
    return Buffer.from(decrypted, 'base64');
  }

  /**
   * Parse encrypted value string
   */
  private parseEncryptedValue(encrypted: string): EncryptedValue {
    if (!encrypted.startsWith(ENCRYPTED_PREFIX)) {
      throw new Error('Invalid encrypted value format');
    }

    const withoutPrefix = encrypted.substring(ENCRYPTED_PREFIX.length);
    const parts = withoutPrefix.split(':');

    if (parts.length < 4) {
      throw new Error('Invalid encrypted value format');
    }

    return {
      version: parseInt(parts[0] || '1', 10),
      iv: parts[1] || '',
      authTag: parts[2] || '',
      data: parts[3] || '',
      keyId: parts[4],
    };
  }

  /**
   * Check if a value is encrypted
   */
  isEncrypted(value: string | null | undefined): boolean {
    if (!value || typeof value !== 'string') {
      return false;
    }
    return value.startsWith(ENCRYPTED_PREFIX);
  }

  /**
   * Encrypt a field value
   */
  encrypt(plaintext: string, options: EncryptionOptions = {}): string {
    if (!this.isEnabled()) {
      console.warn('Encryption disabled - returning plaintext');
      return plaintext;
    }

    if (!plaintext) {
      return plaintext;
    }

    // Already encrypted
    if (this.isEncrypted(plaintext)) {
      return plaintext;
    }

    if (options.deterministic) {
      return this.encryptDeterministic(plaintext, options.organizationId);
    }

    // Get the active key (or org-specific key)
    const key = this.getActiveKey(options.organizationId);

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key.key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    const authTag = cipher.getAuthTag();

    return `${ENCRYPTED_PREFIX}${CURRENT_VERSION}:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}:${key.id}`;
  }

  /**
   * Decrypt a field value
   */
  decrypt(encryptedData: string): string {
    if (!this.isEnabled()) {
      return encryptedData;
    }

    if (!encryptedData || !this.isEncrypted(encryptedData)) {
      return encryptedData;
    }

    try {
      const parsed = this.parseEncryptedValue(encryptedData);

      // Check if it's deterministic encryption
      if (parsed.version === 0) {
        return this.decryptDeterministic(encryptedData);
      }

      // Get the key used for encryption
      let key: Buffer;
      if (parsed.keyId) {
        const cachedKey = this.keyCache.get(parsed.keyId);
        if (!cachedKey) {
          throw new Error(`Encryption key not found: ${parsed.keyId}`);
        }
        key = cachedKey.key;
      } else {
        // Use master key for legacy encrypted data
        key = this.masterKey!;
      }

      const iv = Buffer.from(parsed.iv, 'base64');
      const authTag = Buffer.from(parsed.authTag, 'base64');
      const data = Buffer.from(parsed.data, 'base64');

      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(data);
      decrypted = Buffer.concat([decrypted, decipher.final()]);

      return decrypted.toString('utf8');
    } catch (error) {
      console.error('Decryption failed:', error);
      throw new Error('Failed to decrypt data');
    }
  }

  /**
   * Deterministic encryption for searchable fields
   * Same plaintext always produces same ciphertext
   */
  private encryptDeterministic(
    plaintext: string,
    organizationId?: string
  ): string {
    if (!this.deterministicKey) {
      throw new Error('Encryption service not initialized');
    }

    // Derive org-specific key if provided
    let key = this.deterministicKey;
    if (organizationId) {
      key = crypto.pbkdf2Sync(
        this.deterministicKey,
        organizationId,
        10000,
        KEY_LENGTH,
        'sha256'
      );
    }

    // Use fixed IV derived from plaintext for deterministic encryption
    const iv = crypto
      .createHmac('sha256', key)
      .update(plaintext)
      .digest()
      .subarray(0, IV_LENGTH);

    const cipher = crypto.createCipheriv(DETERMINISTIC_ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    // Version 0 indicates deterministic encryption
    return `${ENCRYPTED_PREFIX}0:${iv.toString('base64')}:none:${encrypted}`;
  }

  /**
   * Decrypt deterministic encrypted value
   */
  private decryptDeterministic(encryptedData: string): string {
    if (!this.deterministicKey) {
      throw new Error('Encryption service not initialized');
    }

    const parsed = this.parseEncryptedValue(encryptedData);
    const iv = Buffer.from(parsed.iv, 'base64');
    const data = Buffer.from(parsed.data, 'base64');

    const decipher = crypto.createDecipheriv(
      DETERMINISTIC_ALGORITHM,
      this.deterministicKey,
      iv
    );

    let decrypted = decipher.update(data);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString('utf8');
  }

  /**
   * Get the active encryption key
   */
  private getActiveKey(organizationId?: string): EncryptionKey {
    // Find active key (prefer org-specific if exists)
    for (const [, key] of this.keyCache) {
      if (key.isActive) {
        return key;
      }
    }

    // If no key exists, create one
    return this.createDefaultKey();
  }

  /**
   * Create a default encryption key
   */
  private createDefaultKey(): EncryptionKey {
    if (!this.masterKey) {
      throw new Error('Encryption service not initialized');
    }

    const key: EncryptionKey = {
      id: 'default',
      version: 1,
      key: this.masterKey,
      createdAt: new Date(),
      isActive: true,
    };

    this.keyCache.set('default', key);
    return key;
  }

  /**
   * Generate a new encryption key
   */
  async generateKey(
    organizationId?: string
  ): Promise<{ keyId: string; version: number }> {
    if (!this.masterKey) {
      throw new Error('Encryption service not initialized');
    }

    const newKey = crypto.randomBytes(KEY_LENGTH);
    const keyId = crypto.randomUUID();

    // Find the latest version for this org
    let maxVersion = 0;
    for (const [, key] of this.keyCache) {
      if (key.version > maxVersion) {
        maxVersion = key.version;
      }
    }
    const newVersion = maxVersion + 1;

    // Encrypt the key with master key for storage
    const encryptedKey = this.encryptWithMaster(newKey.toString('base64'));

    // Store in database
    await prisma.$executeRaw`
      INSERT INTO encryption_keys (id, version, "encryptedKey", "organizationId", "isActive", "createdAt")
      VALUES (${keyId}, ${newVersion}, ${encryptedKey}, ${organizationId}, true, NOW())
    `;

    // Deactivate old keys
    await prisma.$executeRaw`
      UPDATE encryption_keys
      SET "isActive" = false
      WHERE id != ${keyId}
        AND ("organizationId" = ${organizationId} OR ("organizationId" IS NULL AND ${organizationId} IS NULL))
    `;

    // Cache the new key
    const encryptionKey: EncryptionKey = {
      id: keyId,
      version: newVersion,
      key: newKey,
      createdAt: new Date(),
      isActive: true,
    };
    this.keyCache.set(keyId, encryptionKey);

    return { keyId, version: newVersion };
  }

  /**
   * Rotate encryption keys and re-encrypt data
   */
  async rotateKeys(organizationId?: string): Promise<KeyRotationResult> {
    const startTime = Date.now();

    // Generate new key
    const { keyId: newKeyId, version } = await this.generateKey(organizationId);
    const oldKeyId =
      Array.from(this.keyCache.values()).find(
        k => !k.isActive && k.id !== newKeyId
      )?.id || 'unknown';

    // Tables and columns that contain encrypted data
    const encryptedFields: Array<{
      table: string;
      column: string;
      idColumn: string;
    }> = [
      { table: 'clients', column: 'nationalId', idColumn: 'id' },
      { table: 'clients', column: 'taxId', idColumn: 'id' },
      {
        table: 'client_bank_accounts',
        column: 'accountNumber',
        idColumn: 'id',
      },
      {
        table: 'client_bank_accounts',
        column: 'routingNumber',
        idColumn: 'id',
      },
      { table: 'collaterals', column: 'registrationNumber', idColumn: 'id' },
      { table: 'guarantors', column: 'nationalId', idColumn: 'id' },
    ];

    let fieldsUpdated = 0;
    const tablesProcessed: string[] = [];

    for (const field of encryptedFields) {
      try {
        // Fetch encrypted records
        const records = await prisma.$queryRawUnsafe<
          Array<{ id: string; value: string }>
        >(
          `SELECT "${field.idColumn}" as id, "${field.column}" as value FROM "${field.table}" WHERE "${field.column}" LIKE 'enc:v%'`
        );

        for (const record of records) {
          if (record.value && this.isEncrypted(record.value)) {
            // Decrypt with old key and re-encrypt with new key
            const decrypted = this.decrypt(record.value);
            const reEncrypted = this.encrypt(decrypted, { organizationId });

            await prisma.$executeRawUnsafe(
              `UPDATE "${field.table}" SET "${field.column}" = $1 WHERE "${field.idColumn}" = $2`,
              reEncrypted,
              record.id
            );

            fieldsUpdated++;
          }
        }

        if (!tablesProcessed.includes(field.table)) {
          tablesProcessed.push(field.table);
        }
      } catch (error) {
        console.error(
          `Error rotating keys for ${field.table}.${field.column}:`,
          error
        );
      }
    }

    const duration = Date.now() - startTime;

    // Log key rotation
    await prisma.$executeRaw`
      INSERT INTO audit_logs (id, action, "entityType", details, "createdAt")
      VALUES (
        ${crypto.randomUUID()},
        'KEY_ROTATION',
        'ENCRYPTION',
        ${JSON.stringify({ oldKeyId, newKeyId, fieldsUpdated, tablesProcessed, version, duration })}::jsonb,
        NOW()
      )
    `;

    return {
      fieldsUpdated,
      tablesProcessed,
      oldKeyId,
      newKeyId,
      duration,
    };
  }

  /**
   * Get encryption status
   */
  async getStatus(): Promise<{
    enabled: boolean;
    algorithm: string;
    keyCount: number;
    activeKeyId: string | null;
    activeKeyVersion: number | null;
  }> {
    let activeKey: EncryptionKey | null = null;
    for (const [, key] of this.keyCache) {
      if (key.isActive) {
        activeKey = key;
        break;
      }
    }

    return {
      enabled: this.isEnabled(),
      algorithm: ALGORITHM,
      keyCount: this.keyCache.size,
      activeKeyId: activeKey?.id || null,
      activeKeyVersion: activeKey?.version || null,
    };
  }

  /**
   * Encrypt an object's sensitive fields
   */
  encryptFields<T extends Record<string, unknown>>(
    obj: T,
    fieldsToEncrypt: (keyof T)[],
    options: EncryptionOptions = {}
  ): T {
    const result = { ...obj };

    for (const field of fieldsToEncrypt) {
      const value = obj[field];
      if (typeof value === 'string' && value) {
        (result as Record<string, unknown>)[field as string] = this.encrypt(
          value,
          options
        );
      }
    }

    return result;
  }

  /**
   * Decrypt an object's encrypted fields
   */
  decryptFields<T extends Record<string, unknown>>(
    obj: T,
    fieldsToDecrypt: (keyof T)[]
  ): T {
    const result = { ...obj };

    for (const field of fieldsToDecrypt) {
      const value = obj[field];
      if (typeof value === 'string' && this.isEncrypted(value)) {
        (result as Record<string, unknown>)[field as string] =
          this.decrypt(value);
      }
    }

    return result;
  }

  /**
   * Hash a value for secure storage (one-way)
   */
  hash(value: string, salt?: string): string {
    const actualSalt =
      salt || crypto.randomBytes(SALT_LENGTH).toString('base64');
    const hash = crypto.pbkdf2Sync(
      value,
      actualSalt,
      PBKDF2_ITERATIONS,
      64,
      'sha512'
    );
    return `${actualSalt}:${hash.toString('base64')}`;
  }

  /**
   * Verify a value against its hash
   */
  verifyHash(value: string, storedHash: string): boolean {
    const [salt] = storedHash.split(':');
    const newHash = this.hash(value, salt);
    return crypto.timingSafeEqual(
      Buffer.from(newHash),
      Buffer.from(storedHash)
    );
  }

  /**
   * Generate a secure random token
   */
  generateToken(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Mask sensitive data for display
   */
  mask(
    value: string,
    visibleChars: number = 4,
    maskChar: string = '*'
  ): string {
    if (!value || value.length <= visibleChars) {
      return maskChar.repeat(value?.length || 4);
    }

    const masked = maskChar.repeat(value.length - visibleChars);
    return masked + value.slice(-visibleChars);
  }

  /**
   * Mask with first and last characters visible
   */
  maskMiddle(
    value: string,
    visibleStart: number = 2,
    visibleEnd: number = 2
  ): string {
    if (!value || value.length <= visibleStart + visibleEnd) {
      return value;
    }

    const start = value.slice(0, visibleStart);
    const end = value.slice(-visibleEnd);
    const middle = '*'.repeat(value.length - visibleStart - visibleEnd);

    return `${start}${middle}${end}`;
  }
}

// Export singleton instance
export const encryptionService = new EncryptionService();

// Export types
export type { EncryptionOptions, EncryptedValue, KeyRotationResult };
