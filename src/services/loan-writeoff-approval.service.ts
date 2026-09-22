/**
 * Writing a loan off, and collecting on one that was written off.
 *
 * A write-off removes a receivable from the books and takes the loss to profit.
 * It is the most consequential thing that can be done to a loan short of
 * reversing a disbursement, and reversals already go through request and
 * review - so this does too. One person asks, a different person decides, and
 * the decision is what actually performs the write-off.
 *
 * The rule that makes it worth anything is that the reviewer cannot be the
 * requester. Without it, somebody holding both rights writes off their own
 * arrears and the second pair of eyes is their own.
 */

import { prisma } from '../config/database';
import { loanAdjustmentService } from './loan-adjustment.service';
import { financialTransactionService } from './financial-transaction.service';
import { postRecovery } from './ledger/posting-rules';
import {
  inAppNotificationService,
  NOTIFICATION_TYPES,
} from './in-app-notification.service';

/** Who may finalise a write-off. */
export const WRITEOFF_APPROVAL_PERMISSION = 'loans:writeoff';

/** Statuses a loan can be written off from. */
const WRITEABLE = ['ACTIVE', 'OVERDUE'];

export interface RequestWriteOffInput {
  loanId: string;
  organizationId: string;
  requestedById: string;
  writeoffType: 'FULL' | 'PARTIAL';
  amount?: number;
  reason: string;
  notes?: string;
  recoveryExpected: boolean;
  recoveryAmount?: number;
}

export async function requestWriteOff(input: RequestWriteOffInput) {
  const loan = await prisma.loan.findFirst({
    where: { id: input.loanId, organizationId: input.organizationId },
    include: { client: true },
  });

  if (!loan) throw new Error('Loan not found');

  if (!WRITEABLE.includes(loan.status)) {
    throw new Error(
      `Only a running loan can be written off. ${loan.loanNumber} is ${loan.status
        .replace(/_/g, ' ')
        .toLowerCase()}.`
    );
  }

  if (input.writeoffType === 'PARTIAL') {
    const amount = Number(input.amount ?? 0);
    if (amount <= 0) {
      throw new Error('Say how much of the balance is being written off.');
    }
    if (amount > Number(loan.outstandingBalance)) {
      throw new Error(
        `You cannot write off more than the ${Number(loan.outstandingBalance).toFixed(2)} outstanding.`
      );
    }
  }

  const existing = await prisma.loanWriteOffRequest.findFirst({
    where: { loanId: input.loanId, status: 'PENDING' },
  });

  if (existing) {
    throw new Error(
      'A write-off for this loan is already waiting to be reviewed.'
    );
  }

  const request = await prisma.loanWriteOffRequest.create({
    data: {
      organizationId: input.organizationId,
      loanId: input.loanId,
      requestedById: input.requestedById,
      writeoffType: input.writeoffType,
      amount: input.writeoffType === 'PARTIAL' ? input.amount : null,
      reason: input.reason,
      notes: input.notes ?? null,
      recoveryExpected: input.recoveryExpected,
      recoveryAmount: input.recoveryAmount ?? null,
      status: 'PENDING',
    },
    include: {
      loan: { select: { loanNumber: true, currency: true } },
      requestedBy: { select: { firstName: true, lastName: true } },
    },
  });

  // Only the people who can finalise it are told; anyone else would be reading
  // about a decision they cannot take.
  try {
    const borrowerName =
      [loan.client?.firstName, loan.client?.lastName].filter(Boolean).join(' ') ||
      'a borrower';

    await inAppNotificationService.notifyPermissionHolders({
      organizationId: input.organizationId,
      type: NOTIFICATION_TYPES.LOAN_WRITEOFF_REQUESTED,
      title: 'Write-off requested',
      body: `${loan.loanNumber} for ${borrowerName} - ${input.reason}`,
      link: '/loans/writeoff-requests',
      resource: 'LOAN_WRITEOFF_REQUEST',
      resourceId: request.id,
      permission: WRITEOFF_APPROVAL_PERMISSION,
      branchId: loan.branchId,
    });
  } catch (error) {
    console.error('Could not notify about the write-off request:', error);
  }

  return request;
}

export interface ReviewWriteOffInput {
  requestId: string;
  organizationId: string;
  reviewedById: string;
  decision: 'APPROVE' | 'REJECT';
  reviewNotes?: string;
}

export async function reviewWriteOff(input: ReviewWriteOffInput) {
  const request = await prisma.loanWriteOffRequest.findFirst({
    where: { id: input.requestId, organizationId: input.organizationId },
    include: { loan: { select: { loanNumber: true } } },
  });

  if (!request) throw new Error('That write-off request could not be found');

  if (request.status !== 'PENDING') {
    throw new Error(
      `This request was already ${request.status.toLowerCase()}.`
    );
  }

  /**
   * The whole point of the flow.
   *
   * Someone holding both the request and the approval right could otherwise
   * write off their own arrears and call it reviewed.
   */
  if (request.requestedById === input.reviewedById) {
    throw new Error(
      'A write-off has to be approved by someone other than the person who asked for it.'
    );
  }

  if (input.decision === 'REJECT') {
    return prisma.loanWriteOffRequest.update({
      where: { id: request.id },
      data: {
        status: 'REJECTED',
        reviewedById: input.reviewedById,
        reviewedAt: new Date(),
        reviewNotes: input.reviewNotes ?? null,
      },
      include: { loan: { select: { loanNumber: true } } },
    });
  }

  // Approval is what performs the write-off. The adjustment service already
  // knows how to do it, and posts the loss to the ledger as it goes.
  const result = await loanAdjustmentService.writeoffLoan(
    {
      loanId: request.loanId,
      reason: request.reason,
      writeoffType: request.writeoffType as 'FULL' | 'PARTIAL',
      amount: request.amount ? Number(request.amount) : undefined,
      notes: request.notes ?? undefined,
      recoveryExpected: request.recoveryExpected,
      recoveryAmount: request.recoveryAmount
        ? Number(request.recoveryAmount)
        : undefined,
    },
    input.organizationId,
    input.reviewedById
  );

  if (!result.success) {
    throw new Error(result.error || 'The write-off could not be completed');
  }

  return prisma.loanWriteOffRequest.update({
    where: { id: request.id },
    data: {
      status: 'APPROVED',
      reviewedById: input.reviewedById,
      reviewedAt: new Date(),
      reviewNotes: input.reviewNotes ?? null,
      writtenOffAt: new Date(),
      writeoffRecord: {
        amountWrittenOff: result.amountWrittenOff,
        previousBalance: result.previousBalance,
        newBalance: result.newBalance,
      },
    },
    include: {
      loan: { select: { loanNumber: true } },
      requestedBy: { select: { firstName: true, lastName: true } },
      reviewedBy: { select: { firstName: true, lastName: true } },
    },
  });
}

/** Withdraw your own request before anybody has decided on it. */
export async function cancelWriteOffRequest(
  requestId: string,
  organizationId: string,
  userId: string
) {
  const request = await prisma.loanWriteOffRequest.findFirst({
    where: { id: requestId, organizationId },
  });

  if (!request) throw new Error('That write-off request could not be found');
  if (request.status !== 'PENDING') {
    throw new Error(`This request was already ${request.status.toLowerCase()}.`);
  }
  if (request.requestedById !== userId) {
    throw new Error('Only the person who asked for this can withdraw it.');
  }

  return prisma.loanWriteOffRequest.update({
    where: { id: request.id },
    data: { status: 'CANCELLED', reviewedAt: new Date() },
  });
}

export interface RecordRecoveryInput {
  loanId: string;
  organizationId: string;
  recordedById: string;
  amount: number;
  paymentMethodId?: string;
  reference?: string;
  notes?: string;
  recoveredAt?: Date;
}

/**
 * Money collected on a loan that was already written off.
 *
 * Not a repayment: the loan is closed and its balances are zero, so there is
 * nothing to allocate against. It is income in the period it arrives, and the
 * write-off stays visible in the period the loss was taken - netting the two
 * would hide both.
 *
 * The cash side goes through the ordinary financial transaction so the payment
 * method balance moves and the cashbook agrees. That call carries the loan id,
 * which is what stops it posting its own income entry - the ledger entry here
 * is the correct one, against recoveries rather than general income.
 */
export async function recordRecovery(input: RecordRecoveryInput) {
  const loan = await prisma.loan.findFirst({
    where: { id: input.loanId, organizationId: input.organizationId },
    select: {
      id: true,
      loanNumber: true,
      status: true,
      currency: true,
      branchId: true,
    },
  });

  if (!loan) throw new Error('Loan not found');

  if (loan.status !== 'WRITTEN_OFF') {
    throw new Error(
      `${loan.loanNumber} has not been written off, so money against it is a repayment rather than a recovery.`
    );
  }

  if (!(input.amount > 0)) {
    throw new Error('A recovery has to be for more than nothing.');
  }

  const recoveredAt = input.recoveredAt ?? new Date();

  const recovery = await prisma.loanRecovery.create({
    data: {
      organizationId: input.organizationId,
      loanId: input.loanId,
      amount: input.amount,
      currency: loan.currency,
      paymentMethodId: input.paymentMethodId ?? null,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      recoveredAt,
      recordedById: input.recordedById,
    },
    include: { loan: { select: { loanNumber: true } } },
  });

  if (input.paymentMethodId) {
    try {
      await financialTransactionService.create({
        organizationId: input.organizationId,
        branchId: loan.branchId ?? undefined,
        type: 'INCOME',
        paymentMethodId: input.paymentMethodId,
        amount: input.amount,
        currency: loan.currency as string,
        description: `Recovery on written-off loan ${loan.loanNumber}`,
        reference: input.reference ?? undefined,
        relatedLoanId: loan.id,
        transactionDate: recoveredAt,
        processedBy: input.recordedById,
      });
    } catch (error) {
      console.error(
        `Recovery ${recovery.id} was recorded but the cash movement failed:`,
        error
      );
    }
  }

  try {
    await postRecovery({
      organizationId: input.organizationId,
      branchId: loan.branchId,
      loanId: loan.id,
      loanNumber: loan.loanNumber,
      currency: loan.currency as string,
      amount: input.amount,
      paymentMethodId: input.paymentMethodId ?? null,
      postedById: input.recordedById,
      entryDate: recoveredAt,
    });
  } catch (error) {
    console.error(
      `Recovery ${recovery.id} was recorded but could not be posted to the ledger:`,
      error
    );
  }

  return recovery;
}
