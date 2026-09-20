import 'dotenv/config';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { prisma } from '../src/config/database';

/**
 * Apply the staff notifications + client deletion requests migration.
 *
 * This repo applies schema changes with scripts rather than `prisma migrate`
 * (the migrations folder has never been under its ledger), so the SQL is read
 * from the migration file and executed statement by statement. Every statement
 * in that file is guarded, so running this twice is harmless.
 */

const MIGRATION = path.join(
  __dirname,
  '..',
  'prisma',
  'migrations',
  '20260910_notifications_and_client_deletion_requests',
  'migration.sql'
);

/**
 * Split the file into executable statements.
 *
 * $executeRawUnsafe takes one statement at a time. Comment lines are dropped so
 * a trailing comment never becomes an empty statement.
 */
function readStatements(file: string): string[] {
  const sql = readFileSync(file, 'utf8');

  return sql
    .split(';')
    .map(statement =>
      statement
        .split('\n')
        .filter(line => !line.trimStart().startsWith('--'))
        .join('\n')
        .trim()
    )
    .filter(statement => statement.length > 0);
}

/** First line of a statement, for progress output. */
const summarise = (statement: string) =>
  statement.split('\n')[0]!.trim().slice(0, 90);

async function run() {
  const statements = readStatements(MIGRATION);
  console.log(
    `Applying notifications + client deletion requests (${statements.length} statements)...\n`
  );

  try {
    for (const [index, statement] of statements.entries()) {
      process.stdout.write(
        `  ${String(index + 1).padStart(2)}/${statements.length}  ${summarise(statement)} ... `
      );
      await prisma.$executeRawUnsafe(statement);
      console.log('ok');
    }

    // Prove the tables are actually queryable, not merely created.
    const [notifications, deletionRequests] = await Promise.all([
      prisma.notification.count(),
      prisma.clientDeletionRequest.count(),
    ]);

    console.log('\n✅ Migration applied.');
    console.log(`   notifications:            ${notifications} rows`);
    console.log(`   client_deletion_requests: ${deletionRequests} rows`);
    console.log(
      '\nNext: npx tsx scripts/seed-deletion-permission.ts to grant clients:delete:request.'
    );
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

run();
