/**
 * Put every permission the code declares into the database.
 *
 * A permission only exists as far as the app is concerned once there is a row
 * for it: the roles screen lists the Permission table, so a code added to
 * constants/permissions.ts and never seeded can be checked by the API and
 * granted by nobody. The feature behind it is then invisible - not broken, not
 * refused, simply absent - which is a hard thing to notice.
 *
 * `db:seed` does seed permissions, but it also rebuilds the permission list of
 * every system role from scratch, so running it to pick up one new code throws
 * away whatever those roles have been tuned to since. This does the first half
 * only.
 *
 * It inserts and it updates wording. It never deletes: a code removed from the
 * source may still be granted to somebody, and quietly revoking it here would
 * change what people can do as a side effect of a rename.
 *
 *   npm run permissions:sync            list what is missing, change nothing
 *   npm run permissions:sync -- --apply write it
 */

import { prisma } from '../src/config/database';
import { ALL_PERMISSIONS } from '../src/constants/permissions';

async function main() {
  const apply = process.argv.includes('--apply');

  const existing = await prisma.permission.findMany({
    select: { code: true, name: true, description: true, module: true },
  });
  const byCode = new Map(existing.map(p => [p.code, p]));

  const missing = ALL_PERMISSIONS.filter(p => !byCode.has(p.code));
  const changed = ALL_PERMISSIONS.filter(p => {
    const current = byCode.get(p.code);
    return (
      current &&
      (current.name !== p.name ||
        current.description !== p.description ||
        current.module !== p.module)
    );
  });
  const orphans = existing.filter(
    e => !ALL_PERMISSIONS.some(p => p.code === e.code)
  );

  console.log(`in code: ${ALL_PERMISSIONS.length}   in database: ${existing.length}`);
  console.log(`missing: ${missing.length}   wording changed: ${changed.length}   in database but not in code: ${orphans.length}\n`);

  for (const p of missing) console.log(`  + ${p.code}  (${p.module})`);
  for (const p of changed) console.log(`  ~ ${p.code}`);
  for (const p of orphans) console.log(`  ? ${p.code} - left alone; somebody may still be granted it`);

  if (!apply) {
    console.log('\nNothing written. Re-run with --apply to write it.');
    return;
  }

  if (missing.length === 0 && changed.length === 0) {
    console.log('\nNothing to do.');
    return;
  }

  if (missing.length > 0) {
    await prisma.permission.createMany({
      data: missing.map(p => ({
        code: p.code,
        name: p.name,
        description: p.description,
        module: p.module,
        isActive: true,
      })),
      skipDuplicates: true,
    });
  }

  for (const p of changed) {
    await prisma.permission.update({
      where: { code: p.code },
      data: { name: p.name, description: p.description, module: p.module },
    });
  }

  console.log(`\nwrote ${missing.length} new, updated ${changed.length}.`);
}

main()
  .catch(error => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
