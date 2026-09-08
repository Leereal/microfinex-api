-- Migration: Create Encryption Tables
-- Description: Tables for data-at-rest encryption support

-- ================================================
-- 1. Encryption Keys Table
-- ================================================
-- Stores encrypted encryption keys with versioning
CREATE TABLE IF NOT EXISTS encryption_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version INTEGER NOT NULL DEFAULT 1,
  "organizationId" UUID REFERENCES organizations(id) ON DELETE SET NULL,
  "keyType" VARCHAR(20) NOT NULL DEFAULT 'DATA' CHECK ("keyType" IN ('DATA', 'TRANSPORT', 'SIGNING')),
  algorithm VARCHAR(50) NOT NULL DEFAULT 'aes-256-gcm',
  "encryptedKey" TEXT NOT NULL, -- Key encrypted with master key
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "rotatedAt" TIMESTAMPTZ,
  "rotatedBy" UUID REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  
  -- Constraints
  CONSTRAINT unique_active_key_per_org_type UNIQUE ("organizationId", "keyType", "isActive") 
    WHERE "isActive" = true
);

-- Indexes for encryption_keys
CREATE INDEX IF NOT EXISTS idx_encryption_keys_org_active 
  ON encryption_keys ("organizationId", "isActive") 
  WHERE "isActive" = true;
CREATE INDEX IF NOT EXISTS idx_encryption_keys_expires 
  ON encryption_keys ("expiresAt") 
  WHERE "isActive" = true;
CREATE INDEX IF NOT EXISTS idx_encryption_keys_type 
  ON encryption_keys ("keyType", "isActive");

-- ================================================
-- 2. Encrypted Field Metadata Table
-- ================================================
-- Tracks which fields are encrypted and their configurations
CREATE TABLE IF NOT EXISTS encrypted_field_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tableName" VARCHAR(100) NOT NULL,
  "columnName" VARCHAR(100) NOT NULL,
  "sensitivityLevel" VARCHAR(20) NOT NULL DEFAULT 'MEDIUM' 
    CHECK ("sensitivityLevel" IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  "isDeterministic" BOOLEAN NOT NULL DEFAULT false,
  "maskPattern" VARCHAR(100),
  description TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT unique_table_column UNIQUE ("tableName", "columnName")
);

-- Insert default encrypted field configurations
INSERT INTO encrypted_field_configs ("tableName", "columnName", "sensitivityLevel", "isDeterministic", "maskPattern", description) VALUES
  ('clients', 'nationalId', 'HIGH', true, '***-**-{last4}', 'National identification number'),
  ('clients', 'taxId', 'HIGH', true, '**-*******', 'Tax identification number'),
  ('clients', 'dateOfBirth', 'MEDIUM', false, NULL, 'Date of birth'),
  ('clients', 'phone', 'LOW', false, '***-***-{last4}', 'Phone number'),
  ('clients', 'email', 'LOW', false, '{first2}***@***', 'Email address'),
  ('client_bank_accounts', 'accountNumber', 'HIGH', false, '****{last4}', 'Bank account number'),
  ('client_bank_accounts', 'routingNumber', 'HIGH', false, '****{last4}', 'Bank routing number'),
  ('client_bank_accounts', 'iban', 'HIGH', false, '{first4}****{last4}', 'International Bank Account Number'),
  ('client_bank_accounts', 'swiftCode', 'MEDIUM', false, NULL, 'SWIFT/BIC code'),
  ('guarantors', 'nationalId', 'HIGH', true, '***-**-{last4}', 'Guarantor national ID'),
  ('guarantors', 'employerPhone', 'LOW', false, NULL, 'Employer phone'),
  ('collaterals', 'registrationNumber', 'MEDIUM', true, NULL, 'Registration number'),
  ('collaterals', 'serialNumber', 'MEDIUM', false, NULL, 'Serial number'),
  ('users', 'mfaSecret', 'CRITICAL', false, NULL, 'MFA secret key'),
  ('api_keys', 'keyHash', 'CRITICAL', false, NULL, 'Hashed API key'),
  ('client_documents', 'filePath', 'MEDIUM', false, NULL, 'Document storage path')
ON CONFLICT ("tableName", "columnName") DO NOTHING;

-- ================================================
-- 3. Key Rotation Audit Log
-- ================================================
-- Track key rotation history for compliance
CREATE TABLE IF NOT EXISTS key_rotation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "previousKeyId" UUID NOT NULL,
  "newKeyId" UUID NOT NULL,
  "rotationType" VARCHAR(50) NOT NULL DEFAULT 'MANUAL' 
    CHECK ("rotationType" IN ('MANUAL', 'SCHEDULED', 'EMERGENCY', 'COMPLIANCE')),
  "rotatedBy" UUID REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT,
  "reEncryptionStatus" VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK ("reEncryptionStatus" IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED')),
  "recordsUpdated" INTEGER DEFAULT 0,
  "tablesProcessed" TEXT[],
  "startedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "completedAt" TIMESTAMPTZ,
  "errorDetails" TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'
);

-- Indexes for key_rotation_logs
CREATE INDEX IF NOT EXISTS idx_key_rotation_started 
  ON key_rotation_logs ("startedAt" DESC);
CREATE INDEX IF NOT EXISTS idx_key_rotation_status 
  ON key_rotation_logs ("reEncryptionStatus");

-- ================================================
-- 4. Update existing tables with encryption support
-- ================================================

-- Add encryption marker columns to track which records are encrypted
-- These columns help during migration from unencrypted to encrypted data

-- Clients table
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'clients' AND column_name = 'encryptionVersion'
  ) THEN
    ALTER TABLE clients ADD COLUMN "encryptionVersion" INTEGER DEFAULT 0;
    COMMENT ON COLUMN clients."encryptionVersion" IS 'Encryption key version used, 0 = unencrypted';
  END IF;
END $$;

-- Client bank accounts table
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'client_bank_accounts' AND column_name = 'encryptionVersion'
  ) THEN
    ALTER TABLE client_bank_accounts ADD COLUMN "encryptionVersion" INTEGER DEFAULT 0;
  END IF;
END $$;

-- Guarantors table
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'guarantors' AND column_name = 'encryptionVersion'
  ) THEN
    ALTER TABLE guarantors ADD COLUMN "encryptionVersion" INTEGER DEFAULT 0;
  END IF;
END $$;

-- Collaterals table
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'collaterals' AND column_name = 'encryptionVersion'
  ) THEN
    ALTER TABLE collaterals ADD COLUMN "encryptionVersion" INTEGER DEFAULT 0;
  END IF;
END $$;

-- ================================================
-- 5. Create encryption audit trigger
-- ================================================
CREATE OR REPLACE FUNCTION log_encryption_key_changes()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_logs (id, action, "entityType", "entityId", details, "createdAt")
    VALUES (
      gen_random_uuid(),
      'KEY_CREATED',
      'ENCRYPTION_KEY',
      NEW.id::text,
      jsonb_build_object(
        'version', NEW.version,
        'keyType', NEW."keyType",
        'organizationId', NEW."organizationId",
        'expiresAt', NEW."expiresAt"
      ),
      NOW()
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD."isActive" = true AND NEW."isActive" = false THEN
      INSERT INTO audit_logs (id, action, "entityType", "entityId", details, "createdAt")
      VALUES (
        gen_random_uuid(),
        'KEY_DEACTIVATED',
        'ENCRYPTION_KEY',
        NEW.id::text,
        jsonb_build_object(
          'version', NEW.version,
          'rotatedBy', NEW."rotatedBy",
          'rotatedAt', NEW."rotatedAt"
        ),
        NOW()
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger if not exists
DROP TRIGGER IF EXISTS encryption_key_audit ON encryption_keys;
CREATE TRIGGER encryption_key_audit
  AFTER INSERT OR UPDATE ON encryption_keys
  FOR EACH ROW
  EXECUTE FUNCTION log_encryption_key_changes();

-- ================================================
-- 6. Compliance Views
-- ================================================

-- View: Encryption coverage summary
CREATE OR REPLACE VIEW encryption_coverage_summary AS
SELECT 
  efc."tableName",
  efc."columnName",
  efc."sensitivityLevel",
  efc."isDeterministic",
  CASE 
    WHEN efc."isActive" THEN 'Configured'
    ELSE 'Disabled'
  END as status
FROM encrypted_field_configs efc
ORDER BY 
  CASE efc."sensitivityLevel"
    WHEN 'CRITICAL' THEN 1
    WHEN 'HIGH' THEN 2
    WHEN 'MEDIUM' THEN 3
    WHEN 'LOW' THEN 4
  END,
  efc."tableName",
  efc."columnName";

-- View: Active encryption keys
CREATE OR REPLACE VIEW active_encryption_keys AS
SELECT 
  ek.id,
  ek.version,
  ek."keyType",
  ek.algorithm,
  o.name as "organizationName",
  ek."createdAt",
  ek."expiresAt",
  EXTRACT(DAY FROM (ek."expiresAt" - NOW())) as "daysUntilExpiry"
FROM encryption_keys ek
LEFT JOIN organizations o ON ek."organizationId" = o.id
WHERE ek."isActive" = true
ORDER BY ek."expiresAt" ASC;

-- ================================================
-- 7. Add comments for documentation
-- ================================================
COMMENT ON TABLE encryption_keys IS 'Stores encryption keys for data-at-rest encryption. Keys are encrypted with master key.';
COMMENT ON TABLE encrypted_field_configs IS 'Configuration for which database fields should be encrypted.';
COMMENT ON TABLE key_rotation_logs IS 'Audit trail for encryption key rotations.';
COMMENT ON VIEW encryption_coverage_summary IS 'Summary view of configured encrypted fields.';
COMMENT ON VIEW active_encryption_keys IS 'View of currently active encryption keys with expiry info.';
