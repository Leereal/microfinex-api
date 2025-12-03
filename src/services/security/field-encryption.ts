/**
 * Field-Level Encryption Configuration
 * Defines which database fields should be encrypted at rest
 */

import { encryptionService, EncryptionOptions } from './encryption.service';

/**
 * Sensitivity levels for encrypted fields
 */
export enum SensitivityLevel {
  LOW = 'LOW', // General PII
  MEDIUM = 'MEDIUM', // Financial data
  HIGH = 'HIGH', // National IDs, bank accounts
  CRITICAL = 'CRITICAL', // Authentication secrets
}

/**
 * Field encryption configuration
 */
export interface EncryptedFieldConfig {
  table: string;
  column: string;
  sensitivityLevel: SensitivityLevel;
  deterministic?: boolean; // Allow searching on encrypted value
  maskPattern?: string; // How to display masked value
  description?: string;
}

/**
 * Registry of all encrypted fields in the system
 */
export const ENCRYPTED_FIELDS: EncryptedFieldConfig[] = [
  // Client PII
  {
    table: 'clients',
    column: 'nationalId',
    sensitivityLevel: SensitivityLevel.HIGH,
    deterministic: true, // Allow lookup by national ID
    maskPattern: '***-**-{last4}',
    description: 'National identification number (SSN, NIN, etc.)',
  },
  {
    table: 'clients',
    column: 'taxId',
    sensitivityLevel: SensitivityLevel.HIGH,
    deterministic: true,
    maskPattern: '**-*******',
    description: 'Tax identification number',
  },
  {
    table: 'clients',
    column: 'dateOfBirth',
    sensitivityLevel: SensitivityLevel.MEDIUM,
    description: 'Date of birth',
  },

  // Client Bank Accounts
  {
    table: 'client_bank_accounts',
    column: 'accountNumber',
    sensitivityLevel: SensitivityLevel.HIGH,
    maskPattern: '****{last4}',
    description: 'Bank account number',
  },
  {
    table: 'client_bank_accounts',
    column: 'routingNumber',
    sensitivityLevel: SensitivityLevel.HIGH,
    maskPattern: '****{last4}',
    description: 'Bank routing number',
  },
  {
    table: 'client_bank_accounts',
    column: 'iban',
    sensitivityLevel: SensitivityLevel.HIGH,
    maskPattern: '{first4}****{last4}',
    description: 'International Bank Account Number',
  },
  {
    table: 'client_bank_accounts',
    column: 'swiftCode',
    sensitivityLevel: SensitivityLevel.MEDIUM,
    description: 'SWIFT/BIC code',
  },

  // Guarantor Information
  {
    table: 'guarantors',
    column: 'nationalId',
    sensitivityLevel: SensitivityLevel.HIGH,
    deterministic: true,
    maskPattern: '***-**-{last4}',
    description: 'Guarantor national ID',
  },
  {
    table: 'guarantors',
    column: 'employerPhone',
    sensitivityLevel: SensitivityLevel.LOW,
    description: 'Guarantor employer phone',
  },

  // Collateral Information
  {
    table: 'collaterals',
    column: 'registrationNumber',
    sensitivityLevel: SensitivityLevel.MEDIUM,
    deterministic: true,
    description: 'Vehicle/property registration number',
  },
  {
    table: 'collaterals',
    column: 'serialNumber',
    sensitivityLevel: SensitivityLevel.MEDIUM,
    description: 'Asset serial number',
  },

  // User Authentication
  {
    table: 'users',
    column: 'mfaSecret',
    sensitivityLevel: SensitivityLevel.CRITICAL,
    description: 'MFA/2FA secret key',
  },

  // API Keys
  {
    table: 'api_keys',
    column: 'keyHash',
    sensitivityLevel: SensitivityLevel.CRITICAL,
    description: 'Hashed API key',
  },

  // Documents
  {
    table: 'client_documents',
    column: 'filePath',
    sensitivityLevel: SensitivityLevel.MEDIUM,
    description: 'Document storage path',
  },

  // Contact Information
  {
    table: 'clients',
    column: 'phone',
    sensitivityLevel: SensitivityLevel.LOW,
    maskPattern: '***-***-{last4}',
    description: 'Client phone number',
  },
  {
    table: 'clients',
    column: 'email',
    sensitivityLevel: SensitivityLevel.LOW,
    maskPattern: '{first2}***@***',
    description: 'Client email address',
  },
];

/**
 * Get field configuration
 */
export function getFieldConfig(
  table: string,
  column: string
): EncryptedFieldConfig | undefined {
  return ENCRYPTED_FIELDS.find(f => f.table === table && f.column === column);
}

/**
 * Get all encrypted fields for a table
 */
export function getTableEncryptedFields(table: string): EncryptedFieldConfig[] {
  return ENCRYPTED_FIELDS.filter(f => f.table === table);
}

/**
 * Check if a field should be encrypted
 */
export function isEncryptedField(table: string, column: string): boolean {
  return ENCRYPTED_FIELDS.some(f => f.table === table && f.column === column);
}

/**
 * Field encryptor/decryptor helper class
 */
export class FieldEncryptor {
  private organizationId?: string;

  constructor(organizationId?: string) {
    this.organizationId = organizationId;
  }

  /**
   * Encrypt a value for a specific field
   */
  encrypt(
    table: string,
    column: string,
    value: string | null | undefined
  ): string | null {
    if (!value) return null;

    const config = getFieldConfig(table, column);
    if (!config) {
      // Field not in registry - don't encrypt
      return value;
    }

    const options: EncryptionOptions = {
      deterministic: config.deterministic,
      organizationId: this.organizationId,
    };

    return encryptionService.encrypt(value, options);
  }

  /**
   * Decrypt a value from a specific field
   */
  decrypt(
    table: string,
    column: string,
    value: string | null | undefined
  ): string | null {
    if (!value) return null;

    if (!encryptionService.isEncrypted(value)) {
      // Value is not encrypted (legacy data)
      return value;
    }

    return encryptionService.decrypt(value);
  }

  /**
   * Mask a value for display based on field configuration
   */
  mask(
    table: string,
    column: string,
    value: string | null | undefined
  ): string | null {
    if (!value) return null;

    const config = getFieldConfig(table, column);
    if (!config?.maskPattern) {
      // Default masking
      return encryptionService.mask(value);
    }

    return this.applyMaskPattern(value, config.maskPattern);
  }

  /**
   * Apply a mask pattern to a value
   * Patterns: {first2}, {last4}, *, etc.
   */
  private applyMaskPattern(value: string, pattern: string): string {
    let result = pattern;

    // Replace {firstN} with first N characters
    const firstMatch = pattern.match(/\{first(\d+)\}/);
    if (firstMatch && firstMatch[1]) {
      const n = parseInt(firstMatch[1], 10);
      result = result.replace(firstMatch[0], value.slice(0, n));
    }

    // Replace {lastN} with last N characters
    const lastMatch = result.match(/\{last(\d+)\}/);
    if (lastMatch && lastMatch[1]) {
      const n = parseInt(lastMatch[1], 10);
      result = result.replace(lastMatch[0], value.slice(-n));
    }

    return result;
  }

  /**
   * Encrypt multiple fields in an object
   */
  encryptObject<T extends Record<string, unknown>>(table: string, obj: T): T {
    const result = { ...obj };
    const fields = getTableEncryptedFields(table);

    for (const field of fields) {
      const value = obj[field.column];
      if (typeof value === 'string') {
        (result as Record<string, unknown>)[field.column] = this.encrypt(
          table,
          field.column,
          value
        );
      }
    }

    return result;
  }

  /**
   * Decrypt multiple fields in an object
   */
  decryptObject<T extends Record<string, unknown>>(table: string, obj: T): T {
    const result = { ...obj };
    const fields = getTableEncryptedFields(table);

    for (const field of fields) {
      const value = obj[field.column];
      if (typeof value === 'string' && encryptionService.isEncrypted(value)) {
        (result as Record<string, unknown>)[field.column] = this.decrypt(
          table,
          field.column,
          value
        );
      }
    }

    return result;
  }

  /**
   * Mask multiple fields in an object for safe display
   */
  maskObject<T extends Record<string, unknown>>(
    table: string,
    obj: T,
    fieldsToMask?: string[]
  ): T {
    const result = { ...obj };
    const fields = getTableEncryptedFields(table);

    for (const field of fields) {
      // Skip if fieldsToMask is provided and field is not in the list
      if (fieldsToMask && !fieldsToMask.includes(field.column)) {
        continue;
      }

      let value = obj[field.column];

      // Decrypt first if encrypted
      if (typeof value === 'string' && encryptionService.isEncrypted(value)) {
        value = this.decrypt(table, field.column, value);
      }

      // Then mask
      if (typeof value === 'string') {
        (result as Record<string, unknown>)[field.column] = this.mask(
          table,
          field.column,
          value
        );
      }
    }

    return result;
  }
}

/**
 * Create a field encryptor for an organization
 */
export function createFieldEncryptor(organizationId?: string): FieldEncryptor {
  return new FieldEncryptor(organizationId);
}

/**
 * Encrypt client data
 */
export function encryptClientData<T extends Record<string, unknown>>(
  data: T,
  organizationId?: string
): T {
  const encryptor = createFieldEncryptor(organizationId);
  return encryptor.encryptObject('clients', data);
}

/**
 * Decrypt client data
 */
export function decryptClientData<T extends Record<string, unknown>>(
  data: T
): T {
  const encryptor = createFieldEncryptor();
  return encryptor.decryptObject('clients', data);
}

/**
 * Mask client data for display
 */
export function maskClientData<T extends Record<string, unknown>>(
  data: T,
  fieldsToMask?: string[]
): T {
  const encryptor = createFieldEncryptor();
  return encryptor.maskObject('clients', data, fieldsToMask);
}
