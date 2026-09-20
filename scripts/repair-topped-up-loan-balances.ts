import { prisma } from '../src/config/database';

/**
 * Repair loans whose balances were left behind by a top-up.
 *
 * Topping up used to raise the outstanding balance by the principal added and
 * nothing else, so the extra interest the bigger principal earns was never
 * carried into the balance - a loan of 200 topped up twice to 500 was left
 * owing 560 against a total due of 650. It also never refreshed interestAmount
 * or interestBalance. The service now recomputes all three; this brings the
 * loans that were topped up before that across.
 *
 * While here it also fills in disbursedById, which the disbursement never set,
 * from the disbursement payment - whoever took that payment is whoever paid the
 * loan out, which is what "Disbursed By" on the statement is asking.
 *
 * Reports what it would change unless run with --apply.
 */

const apply = process.argv.includes('--apply');

(async () => {
  const loans = await prisma.loan.findMany({
    where: { payments: { some: { type: 'LOAN_TOPUP' } } },
    include: { payments: true },
  });

  console.log(`${loans.length} loan(s) have been topped up.\n`);

  for (const loan of loans) {
    const repayments = loan.payments.filter(
      p =>
        p.type !== 'LOAN_TOPUP' &&
        p.type !== 'LOAN_DISBURSEMENT' &&
        p.status === 'COMPLETED'
    );

    const sum = (pick: (p: (typeof repayments)[number]) => unknown) =>
      repayments.reduce((total, p) => total + Number(pick(p) ?? 0), 0);

    const repaidTotal = sum(p => p.amount);
    const repaidPrincipal = sum(p => p.principalAmount);
    const repaidInterest = sum(p => p.interestAmount);

    const totalAmount = Number(loan.totalAmount);
    const totalInterest = Number(loan.totalInterest);

    const next = {
      outstandingBalance: Math.max(totalAmount - repaidTotal, 0),
      principalBalance: Math.max(Number(loan.amount) - repaidPrincipal, 0),
      interestBalance: Math.max(totalInterest - repaidInterest, 0),
      interestAmount: totalInterest,
    };

    const changes = Object.entries(next).filter(
      ([key, value]) => Number((loan as any)[key]) !== value
    );

    console.log(
      `${loan.loanNumber}: principal ${loan.amount}, total due ${totalAmount}, repaid ${repaidTotal}`
    );
    for (const [key, value] of changes) {
      console.log(`  ${key}: ${(loan as any)[key]} -> ${value}`);
    }
    if (!changes.length) console.log('  balances already correct');

    if (apply && changes.length) {
      await prisma.loan.update({ where: { id: loan.id }, data: next });
    }
  }

  // ---- Disbursed By ------------------------------------------------------
  const missingDisburser = await prisma.loan.findMany({
    where: { disbursedById: null, disbursedDate: { not: null } },
    include: {
      payments: {
        where: { type: 'LOAN_DISBURSEMENT' },
        orderBy: { paymentDate: 'asc' },
        take: 1,
      },
    },
  });

  const recoverable = missingDisburser.filter(l => l.payments.length > 0);
  console.log(
    `\n${missingDisburser.length} disbursed loan(s) have no disburser recorded; ${recoverable.length} can be recovered from the disbursement payment.`
  );

  for (const loan of recoverable) {
    console.log(`  ${loan.loanNumber} -> ${loan.payments[0]!.receivedBy}`);
    if (apply) {
      await prisma.loan.update({
        where: { id: loan.id },
        data: { disbursedById: loan.payments[0]!.receivedBy },
      });
    }
  }

  console.log(apply ? '\nApplied.' : '\nDry run. Re-run with --apply.');
  await prisma.$disconnect();
})();
