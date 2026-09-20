import { prisma } from '../src/config/database';

/**
 * Give every payment the currency of the loan it belongs to.
 *
 * `Payment.currency` is `@default(USD)` and not one of the seven code paths
 * that create a payment ever set it, so every row in the table says USD
 * whatever the loan was written in. The dashboard groups collections by
 * `payment.currency`, which is why a ZAR-only lender saw "Collected this
 * month $2,650", and why the portfolio picked up a phantom USD row with
 * nothing disbursed in it.
 *
 * The creation paths now set it. This repairs what they already wrote.
 *
 *   npx tsx scripts/backfill-payment-currency.ts            # report only
 *   npx tsx scripts/backfill-payment-currency.ts --apply    # write
 *
 * Safe to run more than once: it only touches rows that disagree with their
 * loan, so a second run reports nothing left to do.
 */

const BATCH = 500;

type Row = { currency: string; loanCurrency: string; n: bigint };

(async () => {
  const apply = process.argv.includes('--apply');

  const breakdown = await prisma.$queryRaw<Row[]>`
    SELECT p.currency::text        AS "currency",
           l.currency::text        AS "loanCurrency",
           COUNT(*)                AS "n"
      FROM payments p
      JOIN loans l ON l.id = p."loanId"
     WHERE p.currency <> l.currency
     GROUP BY 1, 2
     ORDER BY 3 DESC
  `;

  const total = breakdown.reduce((sum, r) => sum + Number(r.n), 0);

  if (total === 0) {
    console.log('Every payment already matches its loan. Nothing to do.');
    await prisma.$disconnect();
    return;
  }

  console.log(`${total} payment(s) disagree with their loan:\n`);
  for (const row of breakdown) {
    console.log(
      `  ${String(Number(row.n)).padStart(6)}  ${row.currency} -> ${row.loanCurrency}`
    );
  }

  if (!apply) {
    console.log('\nReport only. Re-run with --apply to write these changes.');
    await prisma.$disconnect();
    return;
  }

  console.log('\nApplying...');

  // Batched so a large table does not sit under one long-held lock.
  let changed = 0;
  for (;;) {
    const affected = await prisma.$executeRaw`
      UPDATE payments
         SET currency = l.currency
        FROM loans l
       WHERE l.id = payments."loanId"
         AND payments.currency <> l.currency
         AND payments.id IN (
               SELECT p2.id
                 FROM payments p2
                 JOIN loans l2 ON l2.id = p2."loanId"
                WHERE p2.currency <> l2.currency
                LIMIT ${BATCH}
             )
    `;
    if (affected === 0) break;
    changed += affected;
    console.log(`  ${changed}/${total}`);
  }

  console.log(`\nDone. ${changed} payment(s) updated.`);
  await prisma.$disconnect();
})().catch(async error => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
