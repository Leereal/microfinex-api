/**
 * Security Services Index
 * Central export for all security-related services
 */

// Encryption Services
export {
  encryptionService,
  EncryptionOptions,
  KeyRotationResult,
} from './encryption.service';
export {
  keyManagementService,
  EncryptionKeyRecord,
  KeyGenerationOptions,
} from './key-management.service';
export {
  FieldEncryptor,
  createFieldEncryptor,
  encryptClientData,
  decryptClientData,
  maskClientData,
  ENCRYPTED_FIELDS,
  SensitivityLevel,
  getFieldConfig,
  getTableEncryptedFields,
  isEncryptedField,
} from './field-encryption';
export {
  createEncryptionMiddleware,
  encryptSearchQuery,
  bulkEncryptTable,
  verifyTableEncryption,
  MODEL_TABLE_MAP,
  TABLE_MODEL_MAP,
} from './prisma-encryption.middleware';

// Authentication & Session Services
export { EmailVerificationService } from './email-verification.service';
export { PasswordPolicyService } from './password-policy.service';
export { SessionManagementService } from './session-management.service';
