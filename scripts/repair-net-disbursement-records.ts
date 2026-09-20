import { prisma } from '../src/config/database';

/**
 * Restore disbursements and top-ups to the amount actually advanced.
 *
 * A loan of 100 with a 10 fee was recorded as an expense of 90 and income of
 * 10. The fee was therefore counted twice in the payment method's favour: once
 * as income, and again by being netted off the expense. Every disbursement left
 * the till reading higher than it was, by the size of its charges, and Income &
 * Expenses understated both sides of the ledger.
 *
 * The loan was always for the full amount; what the client walks away with
 * after settling the fee out of it is a figure to show them, not one to keep.
 * This puts the expense and the payment back to the amount advanced and
 * corrects the payment-method balances by the difference.
 *
 * Reports what it would change unless run with --apply.
 */

const apply = process.argv.includes('--apply');

const ADVANCE_TYPES = ['LOAN_DISBURSEMENT', 'LOAN_TOPUP'] as const;

(async () => {
  const payments = await prisma.payment.findMany({
    where: { type: { in: [...ADVANCE_TYPES] } },
    include: {
      loan: {
        select: {
          id: true,
          loanNumber: true,
          amount: true,
          organizationId: true,
          branchId: true,
        },
      },
    },
    orderBy: { paymentDate: 'asc' },
  });

  /**
   * What each advance was for. A top-up already records the principal it added;
   * the original disbursement is the loan's principal less everything topped up
   * on it since.
   */
  const topUpTotals = new Map<string, number>();
  for (const payment of payments) {
    if (payment.type !== 'LOAN_TOPUP') continue;
    topUpTotals.set(
      payment.loanId,
      (topUpTotals.get(payment.loanId) ?? 0) +
        Number(payment.principalAmount ?? payment.amount)
    );
  }

  /** Correction to apply to each payment method, by id. */
  const methodDeltas = new Map<string, number>();
  let paymentsFixed = 0;
  let transactionsFixed = 0;

  console.log(`${payments.length} advance payment(s) to check.\n`);

  for (const payment of payments) {
    const gross =
      payment.type === 'LOAN_TOPUP'
        ? Number(payment.principalAmount ?? payment.amount)
        : Math.max(
            Number(payment.loan.amount) - (topUpTotals.get(payment.loanId) ?? 0),
            0
          );

    const recorded = Number(payment.amount);
    const shortfall = gross - recorded;

    if (shortfall <= 0.004) continue;

    console.log(
      `${payment.paymentNumber}: advanced ${gross}, recorded ${recorded} (short by ${shortfall.toFixed(2)})`
    );
    paymentsFixed += 1;

    if (apply) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { amount: gross, principalAmount: gross },
      });
    }

    /**
     * The matching expense. Several can exist on one loan - one per advance -
     * so the one nearest this payment in time is the one it produced.
     */
    const candidates = await prisma.financialTransaction.findMany({
      where: {
        relatedLoanId: payment.loanId,
        type: 'EXPENSE',
        status: 'COMPLETED',
      },
    });

    let expense = null as (typeof candidates)[number] | null;
    let smallest = Infinity;
    for (const candidate of candidates) {
      if (Math.abs(Number(candidate.amount) - recorded) > 0.004) continue;
      const distance = Math.abs(
        candidate.createdAt.getTime() - payment.paymentDate.getTime()
      );
      if (distance < smallest) {
        smallest = distance;
        expense = candidate;
      }
    }

    if (!expense) {
      console.log('   no matching expense transaction found - skipped');
      continue;
    }

    console.log(
      `   ${expense.transactionNumber}: expense ${expense.amount} -> ${gross}`
    );
    transactionsFixed += 1;

    if (expense.paymentMethodId) {
      methodDeltas.set(
        expense.paymentMethodId,
        (methodDeltas.get(expense.paymentMethodId) ?? 0) - shortfall
      );
    }

    if (apply) {
      await prisma.financialTransaction.update({
        where: { id: expense.id },
        data: { amount: gross },
      });
    }
  }

  console.log('\nPayment method corrections:');
  for (const [methodId, delta] of methodDeltas) {
    const method = await prisma.paymentMethod.findUnique({
      where: { id: methodId },
      select: { name: true, currentBalance: true, currency: true },
    });
    if (!method) continue;

    const next = Number(method.currentBalance) + delta;
    console.log(
      `  ${method.name}: ${method.currentBalance} -> ${next.toFixed(2)} ${method.currency} (${delta.toFixed(2)})`
    );

    if (apply) {
      await prisma.paymentMethod.update({
        where: { id: methodId },
        data: { currentBalance: next },
      });
    }
  }

  if (!methodDeltas.size) console.log('  none');

  console.log(
    `\n${paymentsFixed} payment(s), ${transactionsFixed} transaction(s).`
  );
  console.log(apply ? 'Applied.' : 'Dry run. Re-run with --apply.');
  await prisma.$disconnect();
})();
