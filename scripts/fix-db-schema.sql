ALTER TABLE "charges" ADD COLUMN IF NOT EXISTS "code" TEXT;
ALTER TABLE "charges" ADD COLUMN IF NOT EXISTS "calculationType" TEXT DEFAULT 'FIXED';
ALTER TABLE "charges" ADD COLUMN IF NOT EXISTS "defaultAmount" DECIMAL(15, 2);
ALTER TABLE "charges" ADD COLUMN IF NOT EXISTS "defaultPercentage" DECIMAL(5, 4);
ALTER TABLE "charges" ADD COLUMN IF NOT EXISTS "appliesAt" TEXT DEFAULT 'DISBURSEMENT';
ALTER TABLE "charges" ADD COLUMN IF NOT EXISTS "isDeductedFromPrincipal" BOOLEAN DEFAULT false;
ALTER TABLE "charges" ADD COLUMN IF NOT EXISTS "createdBy" TEXT;
ALTER TABLE "charges" ADD COLUMN IF NOT EXISTS "updatedBy" TEXT;

UPDATE "charges" SET "code" = UPPER(REPLACE("name", ' ', '_')) WHERE "code" IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'charges_organizationId_code_key'
  ) THEN
    CREATE UNIQUE INDEX "charges_organizationId_code_key" ON "charges"("organizationId", "code");
  END IF;
END
$$;
