import 'dotenv/config';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { prisma } from '../src/config/database';
import { seedDemoData } from './seed/seed-demo-data';
import { SEED_RUN_DIR, loadManifest, rollback } from './seed/manifest';

/**
 * Demo data: seed it, inspect it, undo it.
 *
 *   npx tsx scripts/seed-demo.ts seed [--clients 24] [--no-ai] [--org <id>]
 *   npx tsx scripts/seed-demo.ts list
 *   npx tsx scripts/seed-demo.ts show <batchId>
 *   npx tsx scripts/seed-demo.ts rollback <batchId|latest> [--dry-run]
 *
 * Seeding never deletes anything and never edits a row it did not create.
 * Rollback removes exactly the rows in that run's manifest, youngest first.
 */

const arg = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
};
const has = (flag: string) => process.argv.includes(flag);

function listRuns(): string[] {
  if (!existsSync(SEED_RUN_DIR)) return [];
  return readdirSync(SEED_RUN_DIR)
    .filter(name => name.endsWith('.json'))
    .map(name => name.replace(/\.json$/, ''))
    .sort();
}

function printSummary(summary: Record<string, number> = {}) {
  const rows = Object.entries(summary).sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((sum, [, count]) => sum + count, 0);
  for (const [model, count] of rows) {
    console.log(`    ${model.padEnd(24)} ${String(count).padStart(6)}`);
  }
  console.log(`    ${'TOTAL'.padEnd(24)} ${String(total).padStart(6)}`);
}

async function doSeed() {
  const clients = arg('--clients') ? parseInt(arg('--clients')!, 10) : undefined;
  const started = Date.now();

  const { manifest, organization } = await seedDemoData({
    organizationId: arg('--org'),
    clients,
    useAi: !has('--no-ai'),
  });

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n✅ Seeded ${organization.name} in ${elapsed}s\n`);
  printSummary(manifest.tally());
  console.log(`\n  manifest  ${manifest.file}`);
  console.log(`  undo with npx tsx scripts/seed-demo.ts rollback ${manifest.batchId}\n`);
}

async function doList() {
  const runs = listRuns();
  if (runs.length === 0) {
    console.log('No seed runs recorded.');
    return;
  }

  console.log(`Seed runs in ${SEED_RUN_DIR}:\n`);
  for (const batchId of runs) {
    const manifest = loadManifest(batchId);
    const total = manifest.entries.length;
    console.log(
      `  ${batchId}  ${String(total).padStart(5)} rows  ${manifest.organizationName}` +
        `  ${manifest.finishedAt ? 'complete' : 'INCOMPLETE'}`
    );
  }
  console.log('');
}

async function doShow(batchId: string) {
  const manifest = loadManifest(batchId);
  console.log(`\n${batchId}`);
  console.log(`  organization  ${manifest.organizationName}`);
  console.log(`  started       ${manifest.startedAt}`);
  console.log(`  finished      ${manifest.finishedAt ?? 'did not finish'}`);
  console.log(`  personas from ${manifest.aiProvider ?? 'unknown'}\n`);
  printSummary(manifest.summary);
  console.log('');
}

async function doRollback(target: string) {
  const runs = listRuns();
  const batchId = target === 'latest' ? runs[runs.length - 1] : target;

  if (!batchId) {
    console.error('No seed run to roll back.');
    process.exit(1);
  }

  const manifest = loadManifest(batchId);
  const dryRun = has('--dry-run');

  console.log(
    `\n${dryRun ? 'Would remove' : 'Removing'} ${manifest.entries.length} rows from ${manifest.organizationName} (${batchId})`
  );

  const result = await rollback(batchId, { dryRun });

  if (dryRun) {
    console.log(`\n  ${result.deleted} rows would be deleted. Nothing was changed.\n`);
    return;
  }

  console.log(`\n  deleted  ${result.deleted}`);
  console.log(`  skipped  ${result.skipped} (already gone)`);
  if (result.failed.length > 0) {
    console.log(`  FAILED   ${result.failed.length}`);
    for (const entry of result.failed.slice(0, 10)) {
      console.log(`    ${entry.model} ${entry.id}`);
    }
    console.log(
      '\n  Those rows are still present - usually something else now points at them.'
    );
  } else {
    console.log('\n✅ Everything this run created has been removed.\n');
  }
}

async function main() {
  const command = process.argv[2] ?? 'seed';

  switch (command) {
    case 'seed':
      await doSeed();
      break;
    case 'list':
      await doList();
      break;
    case 'show':
      await doShow(process.argv[3]!);
      break;
    case 'rollback':
      await doRollback(process.argv[3] ?? 'latest');
      break;
    default:
      console.error(`Unknown command "${command}". Use seed, list, show or rollback.`);
      process.exit(1);
  }

  await prisma.$disconnect();
}

main().catch(async error => {
  console.error('\n❌ Failed:', error);
  await prisma.$disconnect();
  process.exit(1);
});
