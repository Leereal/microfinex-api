/**
 * What each money event does to the books.
 *
 * These are the only places that decide which accounts an event touches, so the
 * accounting policy of the whole system is readable in one file.
 *
 * Two policy choices are worth stating plainly, because they are the ones an
 * auditor will ask about:
 *
 *  - Interest is recognised as it is earned. `loan.interestBalance` is interest
 *    charged and not yet collected, which is exactly what "interest receivable"
 *    means, so the accrual run trues the ledger up to it rather than trying to
 *    add increments of its own. That makes accrual self-correcting: a repayment
 *    or a waiver reduces both sides, so the next run finds nothing to do.
 *
 *  - Penalties are recognised only when collected. A penalty charged to an
 *    overdue borrower is not income until it arrives, and treating it as income
 *    while the loan is deteriorating is how a book flatters itself. So penalties
 *    never reach the balance sheet, and waiving or writing one off costs
 *    nothing, because it was never counted.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { ledgerService, PostingLine } from './ledger.service';

/** The account a payment method posts to, or the cash control account. */
async function cashLine(
  paymentMethodId: string | null | undefined,
  tx: Prisma.TransactionClient | typeof prisma,
  side: { debit?: number; credit?: number },
  description?: string
): Promise<PostingLine> {
  let accountId: string | null = null;

  if (paymentMethodId) {
    const method = await tx.paymentMethod.findUnique({
      where: { id: paymentMethodId },
      select: { ledgerAccountId: true },
    });
    accountId = method?.ledgerAccountId ?? null;
  }

  return accountId
    ? { accountId, ...side, description }
    : { account: 'CASH_AND_BANK', ...side, description };
}

export interface DisbursementPosting {
  organizationId: string;
  branchId?: string | null;
  loanId: string;
  loanNumber: string;
  currency: string;
  /** The principal the borrower now owes. */
  principal: number;
  /** Charges taken out of the money advanced, recognised as fee income now. */
  chargesDeducted?: number;
  paymentMethodId?: string | null;
  postedById: string;
  entryDate?: Date;
}

/**
 * Paying a loan out.
 *
 * The borrower owes the full principal whatever they physically receive, so the
 * debit is the principal and the cash credit is what actually left the account.
 * The difference is the charge settled out of the advance, which is income the
 * moment it is withheld.
 */
export async function postDisbursement(
  input: DisbursementPosting,
  tx?: Prisma.TransactionClient
) {
  const charges = input.chargesDeducted ?? 0;
  const cashOut = input.principal - charges;
  const client = tx ?? prisma;

  return ledgerService.post(
    {
      organizationId: input.organizationId,
      branchId: input.branchId,
      currency: input.currency,
      entryDate: input.entryDate,
      description: `Disbursement of ${input.loanNumber}`,
      reference: input.loanNumber,
      source: 'DISBURSEMENT',
      sourceId: input.loanId,
      postedById: input.postedById,
      lines: [
        {
          account: 'LOANS_RECEIVABLE',
          debit: input.principal,
          loanId: input.loanId,
          description: 'Principal advanced',
        },
        await cashLine(
          input.paymentMethodId,
          client,
          { credit: cashOut },
          'Paid to borrower'
        ),
        {
          account: 'FEE_INCOME',
          credit: charges,
          loanId: input.loanId,
          description: 'Charges settled out of the advance',
        },
      ],
    },
    tx
  );
}

export interface RepaymentPosting {
  organizationId: string;
  branchId?: string | null;
  loanId: string;
  loanNumber: string;
  currency: string;
  principal: number;
  interest: number;
  penalty: number;
  charges: number;
  paymentMethodId?: string | null;
  reference?: string | null;
  postedById: string;
  entryDate?: Date;
}

/**
 * Taking a repayment.
 *
 * Principal and interest clear what the borrower owed, so they reduce the two
 * receivables. Penalties and fees are recognised as income here, because this
 * is the point at which they are actually collected.
 */
export async function postRepayment(
  input: RepaymentPosting,
  tx?: Prisma.TransactionClient
) {
  const total =
    input.principal + input.interest + input.penalty + input.charges;
  const client = tx ?? prisma;

  return ledgerService.post(
    {
      organizationId: input.organizationId,
      branchId: input.branchId,
      currency: input.currency,
      entryDate: input.entryDate,
      description: `Repayment on ${input.loanNumber}`,
      reference: input.reference ?? input.loanNumber,
      source: 'REPAYMENT',
      sourceId: input.loanId,
      postedById: input.postedById,
      lines: [
        await cashLine(
          input.paymentMethodId,
          client,
          { debit: total },
          'Received from borrower'
        ),
        {
          account: 'LOANS_RECEIVABLE',
          credit: input.principal,
          loanId: input.loanId,
          description: 'Principal repaid',
        },
        {
          account: 'INTEREST_RECEIVABLE',
          credit: input.interest,
          loanId: input.loanId,
          description: 'Interest collected',
        },
        {
          account: 'PENALTY_INCOME',
          credit: input.penalty,
          loanId: input.loanId,
          description: 'Penalties collected',
        },
        {
          account: 'FEE_INCOME',
          credit: input.charges,
          loanId: input.loanId,
          description: 'Fees collected',
        },
      ],
    },
    tx
  );
}

export interface WriteOffPosting {
  organizationId: string;
  branchId?: string | null;
  loanId: string;
  loanNumber: string;
  currency: string;
  principalWrittenOff: number;
  interestWrittenOff: number;
  postedById: string;
  entryDate?: Date;
}

/**
 * Accepting that a loan will not be repaid.
 *
 * Gross: the loss goes to expense and the receivables come off the book. The
 * provision already carried against this loan is not touched here - the next
 * provision run recalculates what is required against a portfolio that no
 * longer contains this loan, and releases it through the impairment charge. The
 * net effect on profit is the same, and the two figures stay separately
 * readable, which is what anyone reviewing the loss wants.
 *
 * Penalties are not written off in the ledger because they were never
 * recognised as income.
 */
export async function postWriteOff(
  input: WriteOffPosting,
  tx?: Prisma.TransactionClient
) {
  return ledgerService.post(
    {
      organizationId: input.organizationId,
      branchId: input.branchId,
      currency: input.currency,
      entryDate: input.entryDate,
      description: `Write-off of ${input.loanNumber}`,
      reference: input.loanNumber,
      source: 'WRITE_OFF',
      sourceId: input.loanId,
      postedById: input.postedById,
      lines: [
        {
          account: 'LOANS_WRITTEN_OFF',
          debit: input.principalWrittenOff + input.interestWrittenOff,
          loanId: input.loanId,
          description: 'Balance accepted as uncollectible',
        },
        {
          account: 'LOANS_RECEIVABLE',
          credit: input.principalWrittenOff,
          loanId: input.loanId,
          description: 'Principal written off',
        },
        {
          account: 'INTEREST_RECEIVABLE',
          credit: input.interestWrittenOff,
          loanId: input.loanId,
          description: 'Interest written off',
        },
      ],
    },
    tx
  );
}

export interface WaiverPosting {
  organizationId: string;
  branchId?: string | null;
  loanId: string;
  loanNumber: string;
  currency: string;
  /** Only interest reaches the ledger; penalties were never recognised. */
  interestWaived: number;
  postedById: string;
  entryDate?: Date;
}

/** Forgiving interest: an expense, and the receivable comes off. */
export async function postInterestWaiver(
  input: WaiverPosting,
  tx?: Prisma.TransactionClient
) {
  return ledgerService.post(
    {
      organizationId: input.organizationId,
      branchId: input.branchId,
      currency: input.currency,
      entryDate: input.entryDate,
      description: `Interest waived on ${input.loanNumber}`,
      reference: input.loanNumber,
      source: 'WAIVER',
      sourceId: input.loanId,
      postedById: input.postedById,
      lines: [
        {
          account: 'INTEREST_WAIVED',
          debit: input.interestWaived,
          loanId: input.loanId,
        },
        {
          account: 'INTEREST_RECEIVABLE',
          credit: input.interestWaived,
          loanId: input.loanId,
        },
      ],
    },
    tx
  );
}

export interface RecoveryPosting {
  organizationId: string;
  branchId?: string | null;
  loanId: string;
  loanNumber: string;
  currency: string;
  amount: number;
  paymentMethodId?: string | null;
  postedById: string;
  entryDate?: Date;
}

/**
 * Money collected on a loan already written off.
 *
 * Income when it arrives rather than a reversal of the original loss, so the
 * write-off expense stays visible for the period it was taken in and the
 * recovery is visible in the period it was received.
 */
export async function postRecovery(
  input: RecoveryPosting,
  tx?: Prisma.TransactionClient
) {
  const client = tx ?? prisma;

  return ledgerService.post(
    {
      organizationId: input.organizationId,
      branchId: input.branchId,
      currency: input.currency,
      entryDate: input.entryDate,
      description: `Recovery on written-off loan ${input.loanNumber}`,
      reference: input.loanNumber,
      source: 'RECOVERY',
      sourceId: input.loanId,
      postedById: input.postedById,
      lines: [
        await cashLine(input.paymentMethodId, client, { debit: input.amount }),
        {
          account: 'RECOVERY_INCOME',
          credit: input.amount,
          loanId: input.loanId,
        },
      ],
    },
    tx
  );
}

export interface CashTransactionPosting {
  organizationId: string;
  branchId?: string | null;
  currency: string;
  amount: number;
  description: string;
  reference?: string | null;
  sourceId?: string | null;
  paymentMethodId?: string | null;
  /** The account this category maps to, if it has been mapped. */
  categoryAccountId?: string | null;
  postedById: string;
  entryDate?: Date;
}

/** Income recorded on the finance screens. */
export async function postIncome(
  input: CashTransactionPosting,
  tx?: Prisma.TransactionClient
) {
  const client = tx ?? prisma;

  return ledgerService.post(
    {
      organizationId: input.organizationId,
      branchId: input.branchId,
      currency: input.currency,
      entryDate: input.entryDate,
      description: input.description,
      reference: input.reference,
      source: 'INCOME',
      sourceId: input.sourceId,
      postedById: input.postedById,
      lines: [
        await cashLine(input.paymentMethodId, client, { debit: input.amount }),
        input.categoryAccountId
          ? { accountId: input.categoryAccountId, credit: input.amount }
          : { account: 'OTHER_INCOME', credit: input.amount },
      ],
    },
    tx
  );
}

/** Expenses recorded on the finance screens. */
export async function postExpense(
  input: CashTransactionPosting,
  tx?: Prisma.TransactionClient
) {
  const client = tx ?? prisma;

  return ledgerService.post(
    {
      organizationId: input.organizationId,
      branchId: input.branchId,
      currency: input.currency,
      entryDate: input.entryDate,
      description: input.description,
      reference: input.reference,
      source: 'EXPENSE',
      sourceId: input.sourceId,
      postedById: input.postedById,
      lines: [
        input.categoryAccountId
          ? { accountId: input.categoryAccountId, debit: input.amount }
          : { account: 'OTHER_EXPENSE', debit: input.amount },
        await cashLine(input.paymentMethodId, client, { credit: input.amount }),
      ],
    },
    tx
  );
}
