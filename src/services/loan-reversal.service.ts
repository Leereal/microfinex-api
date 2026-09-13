import { prisma } from '../config/database';
import { LoanStatus, Prisma } from '@prisma/client';
import { loanCalculationService } from './loan-calculations';
import { financialTransactionService } from './financial-transaction.service';
import { clientLimitService } from './client-limit.service';
import { paymentMethodService } from './payment-method.service';
import { loadUserPermissions } from '../middleware/permissions';
import {
  inAppNotificationService,
  NOTIFICATION_TYPES,
} from './in-app-notification.service';

/**
 * Undoing a disbursement.
 *
 * A disbursement is not one act but six: charges are applied and booked as
 * income, the loan is marked ACTIVE, a disbursement payment is recorded, cash
 * leaves a payment method, interest and due dates are calculated, and part of
 * the client's credit limit is consumed. Reversing it therefore cannot be a
 * status change - every one of those has to be undone, in the opposite order,
 * and what was undone has to be written down. The loan ends up looking as if it
 * was never disbursed, so the reversal record is the only evidence it ever was.
 *
 * Who may do what:
 *   - request:  the person who disbursed it, or anyone who may reverse
 *   - finalise: only someone who may reverse
 *
 * A four-eyes rule applies where the organization can support it: the requester
 * cannot approve their own request unless they are the only person who could.
 */

export const REVERSAL_PERMISSION = 'loans:reverse_disbursement';

/** Statuses a loan can be reversed from. A settled loan is not reversible. */
const REVERSIBLE: LoanStatus[] = [LoanStatus.ACTIVE, LoanStatus.OVERDUE];

export interface ReversalRecord {
  reversedAt: string;
  reversedBy: string;
  loanNumber: string;
  previousStatus: LoanStatus;
  /** Financial transactions voided and what that restored. */
  transactionsVoided: number;
  balanceRestored: number;
  /** Disbursement payments removed. */
  paymentsRemoved: Array<{ id: string; amount: number }>;
  /** Charges taken off the loan. */
  chargesRemoved: Array<{ id: string; name: string; amount: number }>;
  /** Repayment schedule rows discarded. */
  scheduleRowsRemoved: number;
  /** Credit limit handed back to the client. */
  creditLimitRestored: number | null;
  notes: string[];
}

/** Whether this person may ask for a reversal of this loan. */
export async function canRequestReversal(
  userId: string,
  loan: { disbursedById: string | null }
): Promise<boolean> {
  if (loan.disbursedById === userId) return true;
  const permissions = await loadUserPermissions(userId);
  return permissions.has(REVERSAL_PERMISSION);
}

/** Whether this person may finalise a reversal. */
export async function canFinaliseReversal(userId: string): Promise<boolean> {
  const permissions = await loadUserPermissions(userId);
  return permissions.has(REVERSAL_PERMISSION);
}

/** How many people in this organization may finalise a reversal. */
async function countFinalisers(organizationId: string): Promise<number> {
  const users = await prisma.user.findMany({
    where: { organizationId, isActive: true },
    select: { id: true },
  });

  let count = 0;
  for (const user of users) {
    const permissions = await loadUserPermissions(user.id);
    if (permissions.has(REVERSAL_PERMISSION)) count += 1;
  }
  return count;
}

export interface RequestReversalInput {
  loanId: string;
  organizationId: string;
  requestedById: string;
  reason: string;
}

export async function requestReversal(input: RequestReversalInput) {
  const loan = await prisma.loan.findFirst({
    where: { id: input.loanId, organizationId: input.organizationId },
    include: { client: true },
  });

  if (!loan) throw new Error('Loan not found');

  if (!REVERSIBLE.includes(loan.status)) {
    throw new Error(
      `Only a disbursed loan can be reversed. ${loan.loanNumber} is ${loan.status
        .replace(/_/g, ' ')
        .toLowerCase()}.`
    );
  }

  const allowed = await canRequestReversal(input.requestedById, loan);
  if (!allowed) {
    throw new Error(
      'Only the person who disbursed this loan, or someone who may reverse disbursements, can request a reversal.'
    );
  }

  const existing = await prisma.loanReversalRequest.findFirst({
    where: { loanId: input.loanId, status: 'PENDING' },
  });

  if (existing) {
    throw new Error(
      'A reversal request for this loan is already waiting to be reviewed.'
    );
  }

  const request = await prisma.loanReversalRequest.create({
    data: {
      organizationId: input.organizationId,
      loanId: input.loanId,
      requestedById: input.requestedById,
      reason: input.reason,
      status: 'PENDING',
    },
    include: {
      loan: { select: { loanNumber: true } },
      requestedBy: { select: { firstName: true, lastName: true } },
    },
  });

  /**
   * Only people who can actually finalise it are told.
   *
   * Sending this to everyone would put a decision nobody else can take in
   * everybody's list.
   */
  try {
    const clientName =
      [loan.client?.firstName, loan.client?.lastName]
        .filter(Boolean)
        .join(' ') || 'a client';

    await inAppNotificationService.notifyPermissionHolders({
      organizationId: input.organizationId,
      type: NOTIFICATION_TYPES.LOAN_REVERSAL_REQUESTED,
      title: 'Disbursement reversal requested',
      body: `${loan.loanNumber} for ${clientName} - ${input.reason}`,
      link: `/loans/reversal-requests`,
      resource: 'LOAN_REVERSAL_REQUEST',
      resourceId: request.id,
      permission: REVERSAL_PERMISSION,
      branchId: loan.branchId,
    });
  } catch (error) {
    console.error('Could not notify about the reversal request:', error);
  }

  return request;
}

/**
 * Undo the disbursement.
 *
 * Ordered as the mirror image of disbursing: the money first, then the records
 * that describe it, then the loan itself. Each step records what it did, so the
 * request carries a full account even though the loan will look untouched.
 */
async function executeReversal(
  loan: any,
  reversedBy: string,
  reason: string
): Promise<ReversalRecord> {
  const notes: string[] = [];

  // 1. Void every financial transaction this loan produced - the disbursement
  //    expense and each charge's income. voidByLoanId puts the payment method
  //    balances back: income subtracted, expense added.
  const voided = await financialTransactionService.voidByLoanId(
    loan.id,
    'ALL',
    reversedBy,
    `Disbursement reversal: ${reason}`
  );
  notes.push(
    `Voided ${voided.voidedCount} financial transaction(s), restoring ${voided.restoredAmount} to payment methods.`
  );

  // 2. Remove the money paid out. Any repayment already received is left alone
  //    and reported - money the client has handed over is not ours to delete,
  //    and it is the reason a reversal may need a manual decision.
  //
  //    Top-ups count here too: reversing a disbursement unwinds everything that
  //    was advanced on that loan, not just the first payout.
  const isAdvance = (p: any) =>
    p.type === 'LOAN_DISBURSEMENT' || p.type === 'LOAN_TOPUP';

  const disbursementPayments = (loan.payments ?? []).filter(isAdvance);
  const repayments = (loan.payments ?? []).filter((p: any) => !isAdvance(p));

  const paymentsRemoved: ReversalRecord['paymentsRemoved'] = [];
  for (const payment of disbursementPayments) {
    await prisma.payment.delete({ where: { id: payment.id } });
    paymentsRemoved.push({ id: payment.id, amount: Number(payment.amount) });
  }
  notes.push(`Removed ${paymentsRemoved.length} disbursement payment(s).`);

  if (repayments.length > 0) {
    notes.push(
      `WARNING: ${repayments.length} repayment(s) totalling ${repayments
        .reduce((sum: number, p: any) => sum + Number(p.amount), 0)
        .toFixed(2)} were received against this loan and have been left in place. Refund them separately.`
    );
  }

  // 3. Take the charges off. Their income transactions were voided in step 1;
  //    the charge rows themselves would otherwise remain on a loan that is no
  //    longer disbursed.
  const chargesRemoved: ReversalRecord['chargesRemoved'] = (
    loan.loanCharges ?? []
  ).map((charge: any) => ({
    id: charge.id,
    name: charge.chargeName,
    amount: Number(charge.calculatedAmount ?? charge.amount ?? 0),
  }));

  if (chargesRemoved.length > 0) {
    await prisma.loanCharge.deleteMany({ where: { loanId: loan.id } });
    notes.push(`Removed ${chargesRemoved.length} loan charge(s).`);
  }

  // 4. Discard the repayment schedule. It was generated from the disbursement
  //    and would otherwise describe instalments on a loan that was never paid
  //    out; a re-disbursement generates a fresh one.
  const scheduleRowsRemoved = await prisma.repaymentSchedule.deleteMany({
    where: { loanId: loan.id },
  });
  notes.push(`Discarded ${scheduleRowsRemoved.count} repayment schedule row(s).`);

  // 5. Hand the client's credit limit back.
  let creditLimitRestored: number | null = null;
  try {
    const result = await clientLimitService.increaseAvailableBalance(
      loan.clientId,
      (loan.currency || 'USD') as any,
      Number(loan.amount),
      'CANCELLATION',
      loan.id
    );
    if (result.success) {
      creditLimitRestored = Number(loan.amount);
      notes.push(`Restored ${loan.amount} to the client's available credit.`);
    } else {
      notes.push(`Credit limit not restored: ${result.error}`);
    }
  } catch (error) {
    notes.push(
      `Credit limit not restored: ${error instanceof Error ? error.message : 'unknown error'}`
    );
  }

  // 6. Put the loan back to where it was before disbursement.
  const previousStatus = loan.status as LoanStatus;
  /**
   * Put the principal back to what was approved.
   *
   * A top-up raises the loan's principal, and the reversal has just removed the
   * money that paid for it. Leaving `amount` where the top-ups took it would
   * return the loan to APPROVED recorded as a larger loan than anyone ever
   * approved - and it would be disbursed again at that size.
   */
  const toppedUp = (loan.payments ?? [])
    .filter((p: any) => p.type === 'LOAN_TOPUP')
    .reduce(
      (sum: number, p: any) => sum + Number(p.principalAmount ?? p.amount ?? 0),
      0
    );

  const restoredPrincipal = Math.max(Number(loan.amount) - toppedUp, 0);

  const restoredTerms: Record<string, unknown> = {};
  if (toppedUp > 0 && restoredPrincipal > 0) {
    let annualRate = loan.interestRate;
    if (loan.product?.interestRateFrequency === 'MONTHLY') {
      annualRate = loan.interestRate.mul(12);
    } else if (loan.product?.interestRateFrequency === 'WEEKLY') {
      annualRate = loan.interestRate.mul(52);
    } else if (loan.product?.interestRateFrequency === 'DAILY') {
      annualRate = loan.interestRate.mul(365);
    }

    const calculation = await loanCalculationService.calculateLoan({
      principalAmount: new Prisma.Decimal(restoredPrincipal),
      annualInterestRate: annualRate,
      termInMonths: loan.term,
      repaymentFrequency: loan.repaymentFrequency as any,
      calculationMethod: loan.calculationMethod as any,
    });

    restoredTerms.amount = restoredPrincipal;
    restoredTerms.totalAmount = calculation.totalAmount;
    restoredTerms.totalInterest = calculation.totalInterest;
    restoredTerms.interestAmount = calculation.totalInterest;
    restoredTerms.installmentAmount = calculation.monthlyInstallment;

    // The schedule describes a loan that no longer exists; it is rebuilt when
    // the loan is disbursed again.
    await prisma.repaymentSchedule.deleteMany({ where: { loanId: loan.id } });

    notes.push(
      `Principal restored from ${loan.amount} to ${restoredPrincipal} by removing ${toppedUp} of top-ups, and the schedule cleared.`
    );
  }

  await prisma.loan.update({
    where: { id: loan.id },
    data: {
      status: LoanStatus.APPROVED,
      disbursedDate: null,
      disbursedById: null,
      outstandingBalance: 0,
      principalBalance: 0,
      interestBalance: 0,
      penaltyBalance: 0,
      nextDueDate: null,
      ...restoredTerms,
    },
  });
  notes.push(
    `Loan returned to APPROVED and can be disbursed again once the reason is resolved.`
  );

  return {
    reversedAt: new Date().toISOString(),
    reversedBy,
    loanNumber: loan.loanNumber,
    previousStatus,
    transactionsVoided: voided.voidedCount,
    balanceRestored: voided.restoredAmount,
    paymentsRemoved,
    chargesRemoved,
    scheduleRowsRemoved: scheduleRowsRemoved.count,
    creditLimitRestored,
    notes,
  };
}

export interface ReviewReversalInput {
  requestId: string;
  organizationId: string;
  reviewedById: string;
  approve: boolean;
  reviewNotes?: string;
}

export async function reviewReversal(input: ReviewReversalInput) {
  const request = await prisma.loanReversalRequest.findFirst({
    where: { id: input.requestId, organizationId: input.organizationId },
    include: {
      loan: {
        include: {
          payments: true,
          loanCharges: true,
          client: true,
          // Needed to restore the loan's terms when a topped-up loan is
          // reversed: the rate's frequency decides how it annualises.
          product: true,
        },
      },
    },
  });

  if (!request) throw new Error('Reversal request not found');

  if (request.status !== 'PENDING') {
    throw new Error(
      `This request has already been ${request.status.toLowerCase()}.`
    );
  }

  const allowed = await canFinaliseReversal(input.reviewedById);
  if (!allowed) {
    throw new Error(
      'Only someone who may reverse disbursements can finalise this request.'
    );
  }

  /**
   * Four eyes, where the organization has four eyes to offer.
   *
   * Letting the requester approve their own reversal removes the review
   * entirely. Blocking it outright in an organization with only one such person
   * would make reversal impossible, which is worse.
   */
  if (request.requestedById === input.reviewedById) {
    const finalisers = await countFinalisers(input.organizationId);
    if (finalisers > 1) {
      throw new Error(
        'A reversal has to be reviewed by somebody other than the person who requested it.'
      );
    }
  }

  if (!input.approve) {
    return prisma.loanReversalRequest.update({
      where: { id: request.id },
      data: {
        status: 'REJECTED',
        reviewedById: input.reviewedById,
        reviewedAt: new Date(),
        reviewNotes: input.reviewNotes ?? null,
      },
    });
  }

  if (!REVERSIBLE.includes(request.loan.status)) {
    throw new Error(
      `${request.loan.loanNumber} is ${request.loan.status
        .replace(/_/g, ' ')
        .toLowerCase()} and can no longer be reversed.`
    );
  }

  const record = await executeReversal(
    request.loan,
    input.reviewedById,
    request.reason
  );

  const updated = await prisma.loanReversalRequest.update({
    where: { id: request.id },
    data: {
      status: 'APPROVED',
      reviewedById: input.reviewedById,
      reviewedAt: new Date(),
      reviewNotes: input.reviewNotes ?? null,
      reversalRecord: record as any,
      reversedAt: new Date(),
    },
  });

  // Tell the requester what happened to their request.
  try {
    await inAppNotificationService.notify({
      organizationId: input.organizationId,
      recipientId: request.requestedById,
      type: NOTIFICATION_TYPES.LOAN_REVERSAL_COMPLETED,
      title: 'Disbursement reversed',
      body: `${record.loanNumber} has been reversed. ${record.notes[0] ?? ''}`,
      link: `/loans/${request.loanId}`,
      resource: 'LOAN_REVERSAL_REQUEST',
      resourceId: request.id,
    });
  } catch (error) {
    console.error('Could not notify the requester:', error);
  }

  return updated;
}

export async function listReversalRequests(
  organizationId: string,
  status?: string
) {
  return prisma.loanReversalRequest.findMany({
    where: { organizationId, ...(status ? { status } : {}) },
    include: {
      loan: {
        select: {
          id: true,
          loanNumber: true,
          amount: true,
          currency: true,
          status: true,
          client: { select: { firstName: true, lastName: true } },
        },
      },
      requestedBy: { select: { id: true, firstName: true, lastName: true } },
      reviewedBy: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
  });
}

export default {
  requestReversal,
  reviewReversal,
  listReversalRequests,
  canRequestReversal,
  canFinaliseReversal,
  REVERSAL_PERMISSION,
};
