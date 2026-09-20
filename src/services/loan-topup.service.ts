import { prisma } from '../config/database';
import { LoanStatus, Prisma } from '@prisma/client';
import { loanCalculationService } from './loan-calculations';
import { financialTransactionService } from './financial-transaction.service';
import { clientLimitService } from './client-limit.service';

const Decimal = Prisma.Decimal;

/**
 * Adding to a loan that is already running.
 *
 * A client mid-repayment who needs more money usually wants the same loan made
 * bigger rather than a second one alongside it: one schedule, one balance, one
 * thing to chase. Previously the only option was a new application, so the
 * client ended up with two loans and the officer with two schedules.
 *
 * A top-up is not a fresh application either. The client, product, officer and
 * branch are already settled and the loan has already been assessed and
 * approved once, so it goes straight to paying the money out. What it does do
 * is everything a disbursement does for the additional amount: charges, the
 * cash leaving a payment method, the credit limit, and a rebuilt schedule for
 * the new balance.
 */

/** Only a loan that is actually running can be topped up. */
const TOPPABLE: LoanStatus[] = [LoanStatus.ACTIVE, LoanStatus.OVERDUE];

export interface TopUpInput {
  loanId: string;
  organizationId: string;
  amount: number;
  paymentMethodId: string;
  /** Charges to apply to the additional amount. */
  chargeIds?: string[];
  reference?: string;
  notes?: string;
  processedBy: string;
}

export interface TopUpResult {
  loanNumber: string;
  addedPrincipal: number;
  chargesDeducted: number;
  cashToClient: number;
  newPrincipal: number;
  newOutstanding: number;
  installmentsRebuilt: number;
  notes: string[];
}

export async function topUpLoan(input: TopUpInput): Promise<TopUpResult> {
  const notes: string[] = [];

  const loan = await prisma.loan.findFirst({
    where: { id: input.loanId, organizationId: input.organizationId },
    include: { product: true, repaymentSchedule: true, client: true },
  });

  if (!loan) throw new Error('Loan not found');

  if (!TOPPABLE.includes(loan.status)) {
    throw new Error(
      `Only a running loan can be topped up. ${loan.loanNumber} is ${loan.status
        .replace(/_/g, ' ')
        .toLowerCase()}.`
    );
  }

  if (input.amount <= 0) {
    throw new Error('The top-up amount must be more than zero.');
  }

  const currency = loan.currency || loan.product?.currency || 'USD';
  const newPrincipal = Number(loan.amount) + input.amount;

  // The product's ceiling applies to the loan as a whole, not to the top-up.
  if (loan.product && newPrincipal > Number(loan.product.maxAmount)) {
    throw new Error(
      `Topping up by ${input.amount} would take ${loan.loanNumber} to ${newPrincipal}, above the product maximum of ${loan.product.maxAmount}.`
    );
  }

  /**
   * Everything that can refuse this is checked before anything is written -
   * the same ordering the disbursement itself had to learn.
   */
  const disbursementCategory = await prisma.expenseCategory.findFirst({
    where: { organizationId: input.organizationId, code: 'LOAN_DISBURSEMENT' },
    select: { id: true },
  });

  if (!disbursementCategory) {
    throw new Error(
      'No "Loan Disbursement" expense category exists. Add it under Finances, then top up again. Nothing has been changed.'
    );
  }

  // ---- charges on the additional amount ---------------------------------
  const charges = input.chargeIds?.length
    ? await prisma.charge.findMany({
        where: {
          organizationId: input.organizationId,
          isActive: true,
          id: { in: input.chargeIds },
        },
      })
    : [];

  /**
   * What the charges come to. Deducting them is how the client settles the fee
   * out of the money just advanced, which changes what they walk away with but
   * not the size of the top-up: the full amount is advanced and the fee is
   * income against it.
   */
  let deducted = 0;
  const chargeLines: Array<{ charge: (typeof charges)[number]; amount: number }> =
    [];

  for (const charge of charges) {
    const amount =
      charge.calculationType === 'PERCENTAGE'
        ? (input.amount * Number(charge.defaultPercentage ?? 0)) / 100
        : Number(charge.defaultAmount ?? 0);

    if (amount <= 0) continue;
    chargeLines.push({ charge, amount });
    if (charge.isDeductedFromPrincipal) deducted += amount;
  }

  const cashToClient = Math.max(input.amount - deducted, 0);

  // ---- recalculate the loan for its new principal -----------------------
  let annualRate = loan.interestRate;
  if (loan.product?.interestRateFrequency === 'MONTHLY') {
    annualRate = loan.interestRate.mul(12);
  } else if (loan.product?.interestRateFrequency === 'WEEKLY') {
    annualRate = loan.interestRate.mul(52);
  } else if (loan.product?.interestRateFrequency === 'DAILY') {
    annualRate = loan.interestRate.mul(365);
  }

  const calculation = await loanCalculationService.calculateLoan({
    principalAmount: new Decimal(newPrincipal),
    annualInterestRate: annualRate,
    termInMonths: loan.term,
    repaymentFrequency: loan.repaymentFrequency as any,
    calculationMethod: loan.calculationMethod as any,
    // Keep the dates the client already agreed to.
    firstDueDate: loan.nextDueDate ?? undefined,
  });

  /**
   * What has actually been repaid, so the new balance can be worked out rather
   * than guessed at.
   *
   * The outstanding balance used to be nudged up by the principal added, which
   * quietly understated it: a bigger principal earns more interest, and that
   * interest was never added. A loan of 200 topped up twice to 500 was left
   * owing 560 against a total due of 650. Recomputing from the new total and
   * what has come in keeps the statement's arithmetic closing.
   */
  const repaid = await prisma.payment.aggregate({
    where: {
      loanId: loan.id,
      status: 'COMPLETED',
      type: { notIn: ['LOAN_DISBURSEMENT', 'LOAN_TOPUP'] },
    },
    _sum: { amount: true, principalAmount: true, interestAmount: true },
  });

  const repaidTotal = Number(repaid._sum.amount ?? 0);
  const repaidPrincipal = Number(repaid._sum.principalAmount ?? 0);
  const repaidInterest = Number(repaid._sum.interestAmount ?? 0);

  const newTotal = Number(calculation.totalAmount);
  const newInterest = Number(calculation.totalInterest);

  const result = await prisma.$transaction(async tx => {
    // 1. The loan itself.
    await tx.loan.update({
      where: { id: loan.id },
      data: {
        amount: newPrincipal,
        totalAmount: calculation.totalAmount,
        totalInterest: calculation.totalInterest,
        interestAmount: calculation.totalInterest,
        installmentAmount: calculation.monthlyInstallment,
        principalBalance: Math.max(newPrincipal - repaidPrincipal, 0),
        interestBalance: Math.max(newInterest - repaidInterest, 0),
        outstandingBalance: Math.max(newTotal - repaidTotal, 0),
      },
    });

    // 2. A fresh schedule for the new balance. The old one describes a loan
    //    that no longer exists.
    await tx.repaymentSchedule.deleteMany({ where: { loanId: loan.id } });
    await tx.repaymentSchedule.createMany({
      data: calculation.repaymentSchedule.map((installment: any, index) => ({
        loanId: loan.id,
        installmentNumber: index + 1,
        dueDate: installment.dueDate,
        principalAmount: installment.principalAmount,
        interestAmount: installment.interestAmount,
        totalAmount: installment.totalAmount,
        outstandingAmount: installment.totalAmount,
        status: 'PENDING' as const,
      })),
    });

    // 3. The charges, against the loan.
    for (const line of chargeLines) {
      await tx.loanCharge.create({
        data: {
          loanId: loan.id,
          chargeId: line.charge.id,
          amount: line.amount,
          baseAmount: input.amount,
          calculatedAmount: line.amount,
          isDeductedFromPrincipal: line.charge.isDeductedFromPrincipal,
          status: line.charge.isDeductedFromPrincipal ? 'COMPLETED' : 'PENDING',
          paidAmount: line.charge.isDeductedFromPrincipal ? line.amount : 0,
          paidAt: line.charge.isDeductedFromPrincipal ? new Date() : null,
          chargeName: line.charge.name,
          chargeType: line.charge.type,
          calculationType: line.charge.calculationType,
          currency,
        },
      });
    }

    // 4. The money going out, recorded as its own payment so the top-up is
    //    visible as an event rather than an unexplained change in balance.
    await tx.payment.create({
      data: {
        paymentNumber: `TOPUP-${loan.loanNumber}-${Date.now().toString().slice(-6)}`,
        loanId: loan.id,
        // The amount advanced, not what the client walks away with after
        // settling the fee out of it - see the disbursement for why.
        amount: input.amount,
        principalAmount: input.amount,
        interestAmount: 0,
        penaltyAmount: 0,
        type: 'LOAN_TOPUP',
        currency: loan.currency,
        method: 'CASH',
        status: 'COMPLETED',
        paymentDate: new Date(),
        receivedBy: input.processedBy,
        transactionRef: input.reference,
        notes:
          input.notes ||
          `Top-up of ${input.amount} on ${loan.loanNumber}` +
            (deducted > 0 ? ` (charges ${deducted})` : ''),
      },
    });

    return { installmentsRebuilt: calculation.repaymentSchedule.length };
  });

  notes.push(
    `Principal increased from ${loan.amount} to ${newPrincipal}.`,
    `Total due is now ${newTotal}, of which ${repaidTotal} has been repaid.`,
    `Schedule rebuilt with ${result.installmentsRebuilt} instalment(s).`
  );

  // ---- the cash leaving, outside the transaction -------------------------
  // These adjust payment-method balances through their own service, which
  // manages its own transaction; nesting is not allowed.
  await financialTransactionService.recordLoanDisbursement(
    loan.organizationId,
    loan.branchId,
    loan.id,
    loan.loanNumber,
    // Gross, for the same reason as the disbursement: the charges are income
    // in their own right and must not also be netted off the expense.
    input.amount,
    currency,
    input.paymentMethodId,
    input.processedBy
  );
  notes.push(`${input.amount} advanced from the selected payment method.`);

  for (const line of chargeLines) {
    const feeCategory = await prisma.incomeCategory.findFirst({
      where: {
        organizationId: input.organizationId,
        code: { in: ['PROCESSING_FEE', 'OTHER_INCOME'] },
      },
      orderBy: { code: 'asc' },
    });

    if (!feeCategory) {
      notes.push(
        `${line.charge.name} was applied to the loan but not booked as income - no income category exists for charges.`
      );
      continue;
    }

    await financialTransactionService.create({
      organizationId: loan.organizationId,
      branchId: loan.branchId,
      type: 'INCOME',
      incomeCategoryId: feeCategory.id,
      paymentMethodId: input.paymentMethodId,
      amount: line.amount,
      currency,
      description: `${line.charge.name} on top-up of ${loan.loanNumber}`,
      relatedLoanId: loan.id,
      processedBy: input.processedBy,
    } as any);
  }

  // The additional amount consumes more of the client's credit limit.
  const limit = await clientLimitService.reduceAvailableBalance(
    loan.clientId,
    currency as any,
    input.amount,
    loan.id
  );
  notes.push(
    limit.success
      ? `${input.amount} taken off the client's available credit.`
      : `Credit limit not adjusted: ${limit.error}`
  );

  await prisma.loanWorkflowHistory
    .create({
      data: {
        loanId: loan.id,
        fromStatus: loan.status,
        toStatus: loan.status,
        changedBy: input.processedBy,
        notes: `Topped up by ${input.amount} ${currency}. ${notes.join(' ')}`,
      },
    })
    .catch(error => console.error('Could not record the top-up:', error));

  const updated = await prisma.loan.findUnique({
    where: { id: loan.id },
    select: { outstandingBalance: true },
  });

  return {
    loanNumber: loan.loanNumber,
    addedPrincipal: input.amount,
    chargesDeducted: deducted,
    cashToClient,
    newPrincipal,
    newOutstanding: Number(updated?.outstandingBalance ?? 0),
    installmentsRebuilt: result.installmentsRebuilt,
    notes,
  };
}

export default { topUpLoan };
