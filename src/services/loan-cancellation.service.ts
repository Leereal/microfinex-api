import { prisma } from '../config/database';
import { LoanStatus } from '@prisma/client';

/**
 * Stopping a loan that has not been paid out.
 *
 * This is deliberately not a reversal. A reversal undoes money that has already
 * moved: it voids financial transactions, puts payment-method balances back,
 * deletes the disbursement, restores the principal and releases the client's
 * credit - and because it erases a real cash movement it goes through a request
 * and a second pair of eyes.
 *
 * A loan waiting to be disbursed has done none of that. Nothing has left the
 * till, no charge has been booked as income, and no credit has been consumed -
 * the loan is a decision on paper and nothing more. Putting that through the
 * reversal machinery would be asking two people to approve the unwinding of a
 * transaction that never happened.
 *
 * So: cancel. The loan is closed with a reason against it, the schedule it
 * would have run on is cleared, and the charges it would have carried are
 * marked cancelled rather than deleted, so the file still shows what was
 * intended. Once money has gone out, this refuses and points at reversal.
 */

/** Where a loan can still simply be called off. */
const CANCELLABLE: LoanStatus[] = [
  LoanStatus.DRAFT,
  LoanStatus.PENDING,
  LoanStatus.PENDING_ASSESSMENT,
  LoanStatus.PENDING_VISIT,
  LoanStatus.PENDING_APPROVAL,
  LoanStatus.APPROVED,
  LoanStatus.PENDING_DISBURSEMENT,
];

export interface CancelLoanInput {
  loanId: string;
  organizationId: string;
  cancelledBy: string;
  reason: string;
}

export interface CancelLoanResult {
  loanNumber: string;
  previousStatus: LoanStatus;
  chargesCancelled: number;
  installmentsCleared: number;
  notes: string[];
}

/** Whether this loan could be cancelled, and why not when it cannot. */
export function canCancel(status: LoanStatus): {
  allowed: boolean;
  reason?: string;
} {
  if (CANCELLABLE.includes(status)) return { allowed: true };

  if (status === LoanStatus.CANCELLED) {
    return { allowed: false, reason: 'This loan has already been cancelled.' };
  }

  if (
    status === LoanStatus.ACTIVE ||
    status === LoanStatus.OVERDUE ||
    status === LoanStatus.DEFAULTED ||
    status === LoanStatus.DEFAULT
  ) {
    return {
      allowed: false,
      reason:
        'This loan has been paid out, so it cannot simply be cancelled - the money has to be unwound. Request a disbursement reversal instead.',
    };
  }

  return {
    allowed: false,
    reason: `A loan that is ${status
      .replace(/_/g, ' ')
      .toLowerCase()} cannot be cancelled.`,
  };
}

export async function cancelLoan(
  input: CancelLoanInput
): Promise<CancelLoanResult> {
  const reason = input.reason?.trim();
  if (!reason) {
    throw new Error('Give a reason for cancelling - it is what the file shows.');
  }

  const loan = await prisma.loan.findFirst({
    where: { id: input.loanId, organizationId: input.organizationId },
    include: {
      loanCharges: { select: { id: true, financialTransactionId: true } },
      payments: { select: { id: true } },
      repaymentSchedule: { select: { id: true } },
    },
  });

  if (!loan) throw new Error('Loan not found');

  const verdict = canCancel(loan.status);
  if (!verdict.allowed) throw new Error(verdict.reason);

  /**
   * A last check against the money itself rather than the status.
   *
   * A loan should not be sitting in APPROVED with payments against it, but if
   * one ever is, cancelling would strand a real cash movement with nothing to
   * explain it. Better to refuse and be told about it.
   */
  if (loan.payments.length > 0) {
    throw new Error(
      `${loan.loanNumber} has ${loan.payments.length} payment(s) recorded against it, so it cannot be cancelled. Request a disbursement reversal instead.`
    );
  }

  const bookedCharges = loan.loanCharges.filter(
    charge => charge.financialTransactionId
  );

  if (bookedCharges.length > 0) {
    throw new Error(
      `${loan.loanNumber} has ${bookedCharges.length} charge(s) already booked as income, so it cannot be cancelled. Request a disbursement reversal instead.`
    );
  }

  const notes: string[] = [];

  const result = await prisma.$transaction(async tx => {
    /**
     * The charges are marked, not deleted: the file should still show what the
     * client was going to be charged and that it was never collected.
     */
    const charges = await tx.loanCharge.updateMany({
      where: { loanId: loan.id },
      data: { status: 'CANCELLED', paidAmount: 0, paidAt: null },
    });

    // The schedule describes repayments that will never fall due.
    const schedule = await tx.repaymentSchedule.deleteMany({
      where: { loanId: loan.id },
    });

    await tx.loan.update({
      where: { id: loan.id },
      data: {
        status: LoanStatus.CANCELLED,
        outstandingBalance: 0,
        principalBalance: 0,
        interestBalance: 0,
        penaltyBalance: 0,
        nextDueDate: null,
      },
    });

    return {
      chargesCancelled: charges.count,
      installmentsCleared: schedule.count,
    };
  });

  if (result.chargesCancelled > 0) {
    notes.push(
      `${result.chargesCancelled} charge(s) cancelled - none had been collected.`
    );
  }
  if (result.installmentsCleared > 0) {
    notes.push(
      `${result.installmentsCleared} scheduled instalment(s) cleared.`
    );
  }
  notes.push('No money had moved, so there was nothing to reverse.');

  await prisma.loanWorkflowHistory
    .create({
      data: {
        loanId: loan.id,
        fromStatus: loan.status,
        toStatus: LoanStatus.CANCELLED,
        changedBy: input.cancelledBy,
        notes: `Cancelled: ${reason} ${notes.join(' ')}`.trim(),
      },
    })
    .catch(error =>
      console.error('Could not record the cancellation:', error)
    );

  return {
    loanNumber: loan.loanNumber,
    previousStatus: loan.status,
    chargesCancelled: result.chargesCancelled,
    installmentsCleared: result.installmentsCleared,
    notes,
  };
}

export default { cancelLoan, canCancel };
