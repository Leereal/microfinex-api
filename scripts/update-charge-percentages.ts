/**
 * Script to update existing charge percentages from decimal to whole number format
 * E.g., 0.1 -> 10 (meaning 10%)
 *
 * Run with: npx tsx scripts/update-charge-percentages.ts
 */

import { prisma } from '../src/config/database';

async function main() {
  console.log('Starting charge percentage conversion...');

  // Get all charges with defaultPercentage values
  const charges = await prisma.charge.findMany({
    where: {
      defaultPercentage: {
        not: null,
      },
    },
    select: {
      id: true,
      name: true,
      defaultPercentage: true,
    },
  });

  console.log(`Found ${charges.length} charges with percentages to check`);

  let updated = 0;
  for (const charge of charges) {
    const oldValue = charge.defaultPercentage;
    // If value is less than 1, it's stored as decimal - convert to whole number
    const numValue = oldValue !== null ? Number(oldValue) : null;
    if (numValue !== null && numValue < 1) {
      const newValue = numValue * 100;
      await prisma.charge.update({
        where: { id: charge.id },
        data: { defaultPercentage: newValue },
      });
      console.log(`Updated ${charge.name}: ${numValue} -> ${newValue}%`);
      updated++;
    } else {
      console.log(
        `Skipped ${charge.name}: ${numValue}% (already whole number)`
      );
    }
  }

  // Also update charge rates
  const rates = await prisma.chargeRate.findMany({
    where: {
      percentage: {
        not: null,
      },
    },
    select: {
      id: true,
      percentage: true,
      chargeId: true,
    },
  });

  console.log(`\nFound ${rates.length} charge rates with percentages to check`);

  for (const rate of rates) {
    const oldValue = rate.percentage;
    const numValue = oldValue !== null ? Number(oldValue) : null;
    if (numValue !== null && numValue < 1) {
      const newValue = numValue * 100;
      await prisma.chargeRate.update({
        where: { id: rate.id },
        data: { percentage: newValue },
      });
      console.log(`Updated rate ${rate.id}: ${numValue} -> ${newValue}%`);
      updated++;
    }
  }

  console.log(`\nDone! Updated ${updated} records.`);
}

main()
  .catch(e => {
    console.error('Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
