import { prisma } from '../src/config/database';

/**
 * Remove charges that were billed twice on the same loan.
 *
 * The application form puts the chosen charges on the loan when it is created,
 * and disbursement then applied the very same charges again - so a loan created
 * through the form and later disbursed carried its admin fee twice. The charge
 * service now skips anything already on the loan; this clears up the loans that
 * went through before it did.
 *
 * Telling a duplicate from a legitimate repeat needs care: a loan topped up
 * twice raises its admin fee three times, quite correctly, once per advance. So
 * the test is not "the same charge twice" but "more of this charge than there
 * were advances to justify it".
 *
 * Of an excess pair, the one to drop is whichever was never booked as income -
 * the row raised at application, which has no financial transaction behind it.
 * Removing that one leaves the ledger and the payment method untouched; there
 * is nothing to unwind.
 *
 * Reports what it would change unless run with --apply.
 */

const apply = process.argv.includes('--apply');

(async () => {
  const loans = await prisma.loan.findMany({
    where: { loanCharges: { some: {} } },
    select: {
      id: true,
      loanNumber: true,
      loanCharges: { orderBy: { appliedAt: 'asc' } },
      payments: {
        where: { type: { in: ['LOAN_DISBURSEMENT', 'LOAN_TOPUP'] } },
        select: { id: true },
      },
    },
  });

  let removed = 0;
  let stuck = 0;

  for (const loan of loans) {
    // A loan not yet paid out has had one chance to raise each charge.
    const advances = Math.max(loan.payments.length, 1);

    const byCharge = new Map<string, typeof loan.loanCharges>();
    for (const charge of loan.loanCharges) {
      const group = byCharge.get(charge.chargeId) ?? [];
      group.push(charge);
      byCharge.set(charge.chargeId, group);
    }

    for (const group of byCharge.values()) {
      const excess = group.length - advances;
      if (excess <= 0) continue;

      // Unbooked rows first, oldest first - those are the ones raised at
      // application that disbursement then duplicated.
      const droppable = group
        .filter(charge => !charge.financialTransactionId)
        .slice(0, excess);

      console.log(
        `${loan.loanNumber}: ${group.length} x ${group[0]!.chargeName} against ${advances} advance(s) - ${excess} too many`
      );

      if (droppable.length < excess) {
        console.log(
          `   only ${droppable.length} of them were never booked as income; leaving the rest for a human`
        );
        stuck += excess - droppable.length;
      }

      for (const duplicate of droppable) {
        console.log(
          `   removing ${duplicate.chargeName} ${duplicate.calculatedAmount} raised ${duplicate.appliedAt.toISOString()} (no income booked)`
        );
        removed += 1;
        if (apply) {
          await prisma.loanCharge.delete({ where: { id: duplicate.id } });
        }
      }
    }
  }

  console.log(
    `\n${removed} duplicate charge(s) across ${loans.length} loan(s)${
      stuck ? `; ${stuck} need looking at by hand` : ''
    }.`
  );
  console.log(apply ? 'Applied.' : 'Dry run. Re-run with --apply.');
  await prisma.$disconnect();
})();
