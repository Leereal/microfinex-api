/**
 * Prisma Encryption Middleware
 * Automatically encrypts/decrypts sensitive fields on database operations
 */

import { encryptionService } from './encryption.service';
import {
  ENCRYPTED_FIELDS,
  getTableEncryptedFields,
  isEncryptedField,
  createFieldEncryptor,
} from './field-encryption';

// Custom middleware types for Prisma extension
interface MiddlewareParams {
  model?: string;
  action: string;
  args: unknown;
  dataPath: string[];
  runInTransaction: boolean;
}

type Middleware = (
  params: MiddlewareParams,
  next: (params: MiddlewareParams) => Promise<unknown>
) => Promise<unknown>;

// Map Prisma model names to database table names
const MODEL_TABLE_MAP: Record<string, string> = {
  Client: 'clients',
  ClientBankAccount: 'client_bank_accounts',
  Guarantor: 'guarantors',
  Collateral: 'collaterals',
  User: 'users',
  ApiKey: 'api_keys',
  ClientDocument: 'client_documents',
};

// Reverse mapping
const TABLE_MODEL_MAP: Record<string, string> = Object.entries(
  MODEL_TABLE_MAP
).reduce((acc, [model, table]) => ({ ...acc, [table]: model }), {});

/**
 * Get encrypted fields for a Prisma model
 */
function getModelEncryptedFields(modelName: string): string[] {
  const tableName = MODEL_TABLE_MAP[modelName];
  if (!tableName) return [];

  return getTableEncryptedFields(tableName).map(f => f.column);
}

/**
 * Check if a field in a model should be encrypted
 */
function shouldEncrypt(modelName: string, fieldName: string): boolean {
  const tableName = MODEL_TABLE_MAP[modelName];
  if (!tableName) return false;
  return isEncryptedField(tableName, fieldName);
}

/**
 * Encrypt fields in data object
 */
function encryptData(
  modelName: string,
  data: Record<string, unknown>,
  organizationId?: string
): Record<string, unknown> {
  if (!encryptionService.isEnabled()) return data;

  const tableName = MODEL_TABLE_MAP[modelName];
  if (!tableName) return data;

  const encryptor = createFieldEncryptor(organizationId);
  return encryptor.encryptObject(tableName, data);
}

/**
 * Decrypt fields in result object
 */
function decryptData(
  modelName: string,
  data: Record<string, unknown> | null
): Record<string, unknown> | null {
  if (!data || !encryptionService.isEnabled()) return data;

  const tableName = MODEL_TABLE_MAP[modelName];
  if (!tableName) return data;

  const encryptor = createFieldEncryptor();
  return encryptor.decryptObject(tableName, data);
}

/**
 * Process nested data structures (for includes/selects)
 */
function processNestedData(
  data: unknown,
  modelName: string,
  decrypt: boolean = true
): unknown {
  if (!data) return data;

  if (Array.isArray(data)) {
    return data.map(item => processNestedData(item, modelName, decrypt));
  }

  if (typeof data === 'object' && data !== null) {
    const processed = decrypt
      ? decryptData(modelName, data as Record<string, unknown>)
      : data;

    // Process nested relations
    for (const [key, value] of Object.entries(
      processed as Record<string, unknown>
    )) {
      if (value && typeof value === 'object') {
        // Try to determine the nested model name
        const nestedModelName = key.charAt(0).toUpperCase() + key.slice(1);
        if (MODEL_TABLE_MAP[nestedModelName]) {
          (processed as Record<string, unknown>)[key] = processNestedData(
            value,
            nestedModelName,
            decrypt
          );
        }
      }
    }

    return processed;
  }

  return data;
}

/**
 * Extract organization ID from query context
 */
function extractOrganizationId(args: unknown): string | undefined {
  if (!args || typeof args !== 'object') return undefined;

  const argsObj = args as Record<string, unknown>;

  // Check data
  if (argsObj.data && typeof argsObj.data === 'object') {
    const data = argsObj.data as Record<string, unknown>;
    if (data.organizationId) return data.organizationId as string;
  }

  // Check where clause
  if (argsObj.where && typeof argsObj.where === 'object') {
    const where = argsObj.where as Record<string, unknown>;
    if (where.organizationId) return where.organizationId as string;
  }

  return undefined;
}

/**
 * Create Prisma middleware for automatic encryption/decryption
 */
export function createEncryptionMiddleware(): Middleware {
  return async (
    params: MiddlewareParams,
    next: (params: MiddlewareParams) => Promise<unknown>
  ) => {
    const { model, action, args } = params;

    if (!model) return next(params);

    const encryptedFields = getModelEncryptedFields(model);
    if (encryptedFields.length === 0) {
      return next(params);
    }

    const organizationId = extractOrganizationId(args);

    // Handle write operations - encrypt data before saving
    if (
      ['create', 'update', 'upsert', 'createMany', 'updateMany'].includes(
        action
      )
    ) {
      if (args) {
        const argsObj = args as Record<string, unknown>;

        if (argsObj.data) {
          if (Array.isArray(argsObj.data)) {
            // createMany
            argsObj.data = argsObj.data.map((item: Record<string, unknown>) =>
              encryptData(model, item, organizationId)
            );
          } else {
            // create/update
            argsObj.data = encryptData(
              model,
              argsObj.data as Record<string, unknown>,
              organizationId
            );
          }
        }

        // Handle upsert
        if (action === 'upsert') {
          if (argsObj.create) {
            argsObj.create = encryptData(
              model,
              argsObj.create as Record<string, unknown>,
              organizationId
            );
          }
          if (argsObj.update) {
            argsObj.update = encryptData(
              model,
              argsObj.update as Record<string, unknown>,
              organizationId
            );
          }
        }
      }
    }

    // Execute the query
    const result = await next(params);

    // Handle read operations - decrypt data after retrieval
    if (
      [
        'findFirst',
        'findUnique',
        'findMany',
        'create',
        'update',
        'upsert',
      ].includes(action)
    ) {
      if (result) {
        if (Array.isArray(result)) {
          return result.map(item => processNestedData(item, model));
        } else {
          return processNestedData(result, model);
        }
      }
    }

    return result;
  };
}

/**
 * Encrypt query parameters for searching encrypted fields
 * Use deterministic encryption to enable searching
 */
export function encryptSearchQuery(
  modelName: string,
  where: Record<string, unknown>,
  organizationId?: string
): Record<string, unknown> {
  if (!encryptionService.isEnabled()) return where;

  const tableName = MODEL_TABLE_MAP[modelName];
  if (!tableName) return where;

  const encryptor = createFieldEncryptor(organizationId);
  const result = { ...where };

  for (const [key, value] of Object.entries(where)) {
    if (typeof value === 'string' && isEncryptedField(tableName, key)) {
      // Encrypt with deterministic mode for searchability
      result[key] = encryptionService.encrypt(value, {
        deterministic: true,
        organizationId,
      });
    }
  }

  return result;
}

/**
 * Bulk encrypt existing data in a table
 * Used for migrating existing unencrypted data
 */
export async function bulkEncryptTable(
  tableName: string,
  prismaClient: unknown,
  options: {
    batchSize?: number;
    organizationId?: string;
    dryRun?: boolean;
  } = {}
): Promise<{
  processedCount: number;
  encryptedCount: number;
  errors: string[];
}> {
  const { batchSize = 100, organizationId, dryRun = false } = options;
  const modelName = TABLE_MODEL_MAP[tableName];

  if (!modelName) {
    return { processedCount: 0, encryptedCount: 0, errors: ['Unknown table'] };
  }

  const encryptedFields = getModelEncryptedFields(modelName);
  if (encryptedFields.length === 0) {
    return {
      processedCount: 0,
      encryptedCount: 0,
      errors: ['No encrypted fields for this table'],
    };
  }

  const client = prismaClient as Record<
    string,
    {
      findMany: (args: {
        take: number;
        skip: number;
      }) => Promise<Array<Record<string, unknown>>>;
      update: (args: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => Promise<unknown>;
      count: () => Promise<number>;
    }
  >;

  const model = client[modelName.charAt(0).toLowerCase() + modelName.slice(1)];
  if (!model) {
    return {
      processedCount: 0,
      encryptedCount: 0,
      errors: ['Model not found'],
    };
  }

  let processedCount = 0;
  let encryptedCount = 0;
  const errors: string[] = [];
  let skip = 0;

  const total = await model.count();
  console.log(`Starting bulk encryption of ${tableName}: ${total} records`);

  while (true) {
    const records = await model.findMany({
      take: batchSize,
      skip,
    });

    if (records.length === 0) break;

    for (const record of records) {
      try {
        processedCount++;

        const encrypted = encryptData(modelName, record, organizationId);
        let hasChanges = false;

        // Check if any field was actually encrypted
        for (const field of encryptedFields) {
          if (record[field] && encrypted[field] !== record[field]) {
            hasChanges = true;
            break;
          }
        }

        if (hasChanges && !dryRun) {
          await model.update({
            where: { id: record.id as string },
            data: encrypted,
          });
          encryptedCount++;
        } else if (hasChanges) {
          encryptedCount++;
        }
      } catch (error) {
        errors.push(`Record ${record.id}: ${(error as Error).message}`);
      }
    }

    skip += batchSize;
    console.log(`Progress: ${processedCount}/${total} records processed`);
  }

  return { processedCount, encryptedCount, errors };
}

/**
 * Verify encryption of a table
 */
export async function verifyTableEncryption(
  tableName: string,
  prismaClient: unknown
): Promise<{
  totalRecords: number;
  encryptedRecords: number;
  unencryptedRecords: number;
  fields: Record<string, { encrypted: number; unencrypted: number }>;
}> {
  const modelName = TABLE_MODEL_MAP[tableName];
  if (!modelName) {
    throw new Error(`Unknown table: ${tableName}`);
  }

  const encryptedFields = getModelEncryptedFields(modelName);
  if (encryptedFields.length === 0) {
    return {
      totalRecords: 0,
      encryptedRecords: 0,
      unencryptedRecords: 0,
      fields: {},
    };
  }

  const client = prismaClient as Record<
    string,
    {
      findMany: () => Promise<Array<Record<string, unknown>>>;
    }
  >;

  const modelKey = modelName.charAt(0).toLowerCase() + modelName.slice(1);
  const model = client[modelKey];
  if (!model) {
    throw new Error(`Model not found: ${modelName}`);
  }
  const records = await model.findMany();

  const fieldStats: Record<string, { encrypted: number; unencrypted: number }> =
    {};
  for (const field of encryptedFields) {
    fieldStats[field] = { encrypted: 0, unencrypted: 0 };
  }

  let encryptedRecords = 0;
  let unencryptedRecords = 0;

  for (const record of records) {
    let isFullyEncrypted = true;

    for (const field of encryptedFields) {
      const value = record[field];
      const stats = fieldStats[field];
      if (typeof value === 'string' && value && stats) {
        if (encryptionService.isEncrypted(value)) {
          stats.encrypted++;
        } else {
          stats.unencrypted++;
          isFullyEncrypted = false;
        }
      }
    }

    if (isFullyEncrypted) {
      encryptedRecords++;
    } else {
      unencryptedRecords++;
    }
  }

  return {
    totalRecords: records.length,
    encryptedRecords,
    unencryptedRecords,
    fields: fieldStats,
  };
}

// Export for use in Prisma client setup
export { MODEL_TABLE_MAP, TABLE_MODEL_MAP };
