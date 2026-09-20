import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { prisma } from '../src/config/database';

/**
 * Record a migration that was applied with `_mig.ts`.
 *
 * The SQL in this project is applied directly rather than through
 * `prisma migrate deploy`, so `_prisma_migrations` has to be told the
 * migration ran - otherwise the next `migrate` command tries to apply it again
 * against tables that already exist.
 *
 *   npx tsx scripts/_mig-record.ts prisma/migrations/<name>/migration.sql
 */
(async () => {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: tsx scripts/_mig-record.ts <path to migration.sql>');
    process.exit(1);
  }
  const name = path.basename(path.dirname(path.resolve(file)));
  const sql = fs.readFileSync(file, 'utf8');
  const checksum = createHash('sha256').update(sql).digest('hex');

  const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    'SELECT id FROM "_prisma_migrations" WHERE migration_name = $1',
    name
  );
  if (existing.length > 0) {
    console.log(`already recorded: ${name}`);
  } else {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       VALUES ($1, $2, now(), $3, NULL, NULL, now(), 1)`,
      crypto.randomUUID(),
      checksum,
      name
    );
    console.log(`recorded: ${name}`);
  }
  await prisma.$disconnect();
})();
