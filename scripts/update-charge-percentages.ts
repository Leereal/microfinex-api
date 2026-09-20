/**
 * Convert charge percentages from fraction format to whole-number format.
 * E.g. 0.1 -> 10 (meaning 10%)
 *
 * Run with: npx tsx scripts/update-charge-percentages.ts [--apply]
 *
 * Defaults to a dry run. Pass --apply to write.
 *
 * IMPORTANT: run the 20260908_indexes_and_charge_precision migration first.
 * charge_rates.percentage was NUMERIC(5,4) (max 9.9999), so writing a
 * converted value of 10 or more fails with a numeric overflow until the
 * column is widened.
 */

import { prisma } from '../src/config/database';

const APPLY = process.argv.includes('--apply');

/**
 * Values below 1 are ambiguous: 0.1 is almost certainly 10% stored as a
 * fraction, but 0.5 could legitimately be a half-percent charge. Converting
 * everything below 1 would silently turn a 0.5% fee into 50%.
 *
 * Only values that round-trip cleanly from a fraction are converted
 * automatically. Anything else is reported for a human to decide.
 */
const AUTO_CONVERT_CEILING = 0.1; // <= 10% when read as a fraction

type Row = { id: string; label: string; value: number };

function classify(rows: Row[]) {
  const convert: Row[] = [];
  const ambiguous: Row[] = [];
  const alreadyWhole: Row[] = [];

  for (const row of rows) {
    if (row.value >= 1) {
      alreadyWhole.push(row);
    } else if (row.value > 0 && row.value <= AUTO_CONVERT_CEILING) {
      convert.push(row);
    } else {
      // Between 0.1 and 1 exclusive - could be 10%-100% as a fraction, or a
      // genuine sub-1% charge. Too risky to guess.
      ambiguous.push(row);
    }
  }

  return { convert, ambiguous, alreadyWhole };
}

async function main() {
  console.log(
    APPLY
      ? 'Converting charge percentages (writing changes)...'
      : 'Dry run - no changes will be written. Re-run with --apply to commit.\n'
  );

  const charges = await prisma.charge.findMany({
    where: { defaultPercentage: { not: null } },
    select: { id: true, name: true, defaultPercentage: true },
  });

  const chargeRows: Row[] = charges.map(c => ({
    id: c.id,
    label: c.name,
    value: Number(c.defaultPercentage),
  }));

  const rates = await prisma.chargeRate.findMany({
    where: { percentage: { not: null } },
    select: { id: true, percentage: true, currency: true, chargeId: true },
  });

  const rateRows: Row[] = rates.map(r => ({
    id: r.id,
    label: `rate ${r.id} (${r.currency})`,
    value: Number(r.percentage),
  }));

  let updated = 0;

  for (const [name, rows, write] of [
    [
      'charges.defaultPercentage',
      chargeRows,
      (id: string, value: number) =>
        prisma.charge.update({
          where: { id },
          data: { defaultPercentage: value },
        }),
    ],
    [
      'charge_rates.percentage',
      rateRows,
      (id: string, value: number) =>
        prisma.chargeRate.update({
          where: { id },
          data: { percentage: value },
        }),
    ],
  ] as const) {
    const { convert, ambiguous, alreadyWhole } = classify(rows);

    console.log(`\n=== ${name} ===`);
    console.log(`  ${rows.length} rows with a percentage`);
    console.log(`  ${alreadyWhole.length} already whole-number, skipping`);
    console.log(`  ${convert.length} to convert`);
    console.log(`  ${ambiguous.length} ambiguous, needs review`);

    for (const row of convert) {
      const newValue = Number((row.value * 100).toFixed(4));
      if (APPLY) {
        await write(row.id, newValue);
      }
      console.log(
        `  ${APPLY ? 'Updated' : 'Would update'} ${row.label}: ${row.value} -> ${newValue}%`
      );
      updated++;
    }

    for (const row of ambiguous) {
      console.warn(
        `  ⚠️  REVIEW ${row.label}: ${row.value}. This is either ` +
          `${row.value * 100}% stored as a fraction or a genuine ` +
          `${row.value}% charge. Left unchanged - set it explicitly.`
      );
    }
  }

  console.log(
    `\n${APPLY ? 'Done' : 'Dry run complete'}. ${updated} record(s) ${
      APPLY ? 'updated' : 'would be updated'
    }.`
  );

  if (!APPLY && updated > 0) {
    console.log('Re-run with --apply to write these changes.');
  }
}

main()
  .catch(e => {
    console.error('Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
