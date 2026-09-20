import { prisma } from '../config/database';
import { LoanStatus } from '@prisma/client';

/**
 * Whether a client should be given another loan, and what to do instead.
 *
 * Nothing told an operator that the person in front of them already had a loan
 * running: the create form asked for a client and went straight on to amounts,
 * so a second loan could be written against a client who was mid-repayment, or
 * who had defaulted, without anything being said.
 */

/** A loan that is already running. Another advance should be a top-up. */
const RUNNING: LoanStatus[] = [LoanStatus.ACTIVE, LoanStatus.OVERDUE];

/** An application already under way. Finish it rather than starting another. */
const IN_FLIGHT: LoanStatus[] = [
  LoanStatus.DRAFT,
  LoanStatus.PENDING,
  LoanStatus.PENDING_ASSESSMENT,
  LoanStatus.PENDING_VISIT,
  LoanStatus.PENDING_APPROVAL,
  LoanStatus.APPROVED,
  LoanStatus.PENDING_DISBURSEMENT,
];

/** Bad standing. Lending again needs a deliberate decision, not a default. */
const BAD_STANDING: LoanStatus[] = [
  LoanStatus.DEFAULTED,
  LoanStatus.DEFAULT,
  LoanStatus.WRITTEN_OFF,
];

export type EligibilityVerdict = 'ALLOWED' | 'TOP_UP' | 'IN_FLIGHT' | 'BLOCKED';

export interface LoanEligibility {
  clientId: string;
  verdict: EligibilityVerdict;
  /**
   * False only where lending again is not a judgement call - a default or a
   * write-off. A running loan or an application in progress is reported and
   * left to the operator.
   */
  canApply: boolean;
  /** One sentence an operator can act on. */
  reason?: string;
  /** Loans behind the verdict, newest first. */
  loans: Array<{
    id: string;
    loanNumber: string;
    status: LoanStatus;
    amount: number;
    currency: string;
    outstandingBalance: number;
    nextDueDate: Date | null;
    disbursedDate: Date | null;
    productName: string | null;
    /** True when this loan could be topped up instead. */
    topUpEligible: boolean;
  }>;
}

export async function getLoanEligibility(
  clientId: string,
  organizationId: string
): Promise<LoanEligibility> {
  const loans = await prisma.loan.findMany({
    where: {
      clientId,
      organizationId,
      // Settled and abandoned loans say nothing about whether to lend again.
      status: { notIn: [LoanStatus.COMPLETED, LoanStatus.CANCELLED] },
    },
    include: { product: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  });

  const mapped = loans.map(loan => ({
    id: loan.id,
    loanNumber: loan.loanNumber,
    status: loan.status,
    amount: Number(loan.amount),
    currency: loan.currency || 'USD',
    outstandingBalance: Number(loan.outstandingBalance ?? 0),
    nextDueDate: loan.nextDueDate,
    disbursedDate: loan.disbursedDate,
    productName: loan.product?.name ?? null,
    topUpEligible: RUNNING.includes(loan.status),
  }));

  // Worst news first: bad standing outranks a running loan, which outranks an
  // application still in progress.
  const bad = mapped.filter(l => BAD_STANDING.includes(l.status));
  if (bad.length > 0) {
    return {
      clientId,
      verdict: 'BLOCKED',
      canApply: false,
      reason: `This client has ${bad.length} loan${bad.length === 1 ? '' : 's'} in default or written off (${bad
        .map(l => l.loanNumber)
        .join(', ')}). A new loan should not be issued.`,
      loans: mapped,
    };
  }

  /**
   * A running loan informs but does not block.
   *
   * Lending again to somebody mid-repayment is a judgement the lender makes,
   * not something the software decides: the operator is told, offered a top-up
   * as the usual alternative, and left to choose. Only bad standing above is a
   * hard stop, because that is a credit decision with a clear answer.
   */
  const running = mapped.filter(l => RUNNING.includes(l.status));
  if (running.length > 0) {
    return {
      clientId,
      verdict: 'TOP_UP',
      canApply: true,
      reason: `This client already has a running loan (${running
        .map(l => l.loanNumber)
        .join(', ')}). You can top it up instead of issuing a second loan.`,
      loans: mapped,
    };
  }

  const inFlight = mapped.filter(l => IN_FLIGHT.includes(l.status));
  if (inFlight.length > 0) {
    return {
      clientId,
      verdict: 'IN_FLIGHT',
      canApply: true,
      reason: `This client has an application already in progress (${inFlight
        .map(l => `${l.loanNumber} - ${l.status.replace(/_/g, ' ').toLowerCase()}`)
        .join(', ')}). Check it is not a duplicate before continuing.`,
      loans: mapped,
    };
  }

  return { clientId, verdict: 'ALLOWED', canApply: true, loans: mapped };
}

export default { getLoanEligibility };
