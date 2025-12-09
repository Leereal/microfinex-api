import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Fixing charges table schema...');

  try {
    // Add columns
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "charges" ADD COLUMN IF NOT EXISTS "code" TEXT;`
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "charges" ADD COLUMN IF NOT EXISTS "calculationType" TEXT DEFAULT 'FIXED';`
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "charges" ADD COLUMN IF NOT EXISTS "defaultAmount" DECIMAL(15, 2);`
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "charges" ADD COLUMN IF NOT EXISTS "defaultPercentage" DECIMAL(5, 4);`
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "charges" ADD COLUMN IF NOT EXISTS "appliesAt" TEXT DEFAULT 'DISBURSEMENT';`
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "charges" ADD COLUMN IF NOT EXISTS "isDeductedFromPrincipal" BOOLEAN DEFAULT false;`
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "charges" ADD COLUMN IF NOT EXISTS "createdBy" TEXT;`
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "charges" ADD COLUMN IF NOT EXISTS "updatedBy" TEXT;`
    );

    console.log('Columns added.');

    // Update code for existing records
    const charges = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, name FROM "charges" WHERE "code" IS NULL`
    );
    for (const charge of charges) {
      const code = charge.name.toUpperCase().replace(/[^A-Z0-9]/g, '_');
      await prisma.$executeRawUnsafe(
        `UPDATE "charges" SET "code" = '${code}' WHERE "id" = '${charge.id}'`
      );
    }

    console.log('Codes updated.');

    // Add constraints
    await prisma.$executeRawUnsafe(`
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
    `);

    console.log('Schema fix completed successfully.');
  } catch (e) {
    console.error('Error fixing schema:', e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
