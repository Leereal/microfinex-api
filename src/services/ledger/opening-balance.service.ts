/**
 * The ledger's starting position.
 *
 * The book existed before the ledger did, so the first thing posted has to be
 * where things already stood: what borrowers owe, what is in the bank, and the
 * balancing figure that represents everything that happened before anyone was
 * keeping double entry.
 *
 * Nothing before the go-live date is replayed. Replaying years of operational
 * history would turn every historical inconsistency into an unbalanced journal
 * to be reconciled by hand, and the reward - comparatives for periods nobody
 * closed - is not worth it. Opening balances are what an accountant does when
 * taking on a set of books, and they cannot corrupt what came before because
 * they do not touch it.
 */

import { prisma } from '../../config/database';
import { ledgerService, LedgerError } from './ledger.service';

export interface OpeningBalanceResult {
  currency: string;
  asOfDate: Date;
  loansReceivable: number;
  interestReceivable: number;
  cashAndBank: number;
  openingEquity: number;
  entryNumber?: string;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

class OpeningBalanceService {
  /** What would be posted, without posting it. */
  async preview(
    organizationId: string,
    currency: string
  ): Promise<OpeningBalanceResult> {
    const [loans, methods] = await Promise.all([
      prisma.loan.findMany({
        where: {
          organizationId,
          currency: currency as never,
          status: { in: ['ACTIVE', 'OVERDUE'] },
        },
        select: { principalBalance: true, interestBalance: true },
      }),
      prisma.paymentMethod.findMany({
        where: { organizationId, currency, isActive: true },
        select: { currentBalance: true },
      }),
    ]);

    const loansReceivable = round2(
      loans.reduce((s, l) => s + Number(l.principalBalance), 0)
    );
    const interestReceivable = round2(
      loans.reduce((s, l) => s + Number(l.interestBalance), 0)
    );
    const cashAndBank = round2(
      methods.reduce((s, m) => s + Number(m.currentBalance), 0)
    );

    return {
      currency,
      asOfDate: new Date(),
      loansReceivable,
      interestReceivable,
      cashAndBank,
      openingEquity: round2(
        loansReceivable + interestReceivable + cashAndBank
      ),
    };
  }

  /** Whether this currency's books have already been opened. */
  async alreadyPosted(
    organizationId: string,
    currency: string
  ): Promise<boolean> {
    const existing = await prisma.journalEntry.count({
      where: {
        organizationId,
        currency: currency as never,
        source: 'OPENING_BALANCE',
        status: 'POSTED',
      },
    });
    return existing > 0;
  }

  /**
   * Post the opening position for one currency.
   *
   * Refuses if it has been done, because posting it twice would double every
   * asset on the balance sheet. Correcting a wrong opening balance is a
   * reversal of the entry and a fresh one, which leaves both on the record.
   */
  async post(
    organizationId: string,
    currency: string,
    postedById: string,
    asOfDate: Date = new Date()
  ): Promise<OpeningBalanceResult> {
    if (await this.alreadyPosted(organizationId, currency)) {
      throw new LedgerError(
        `The ${currency} books have already been opened. Reverse the existing opening entry first if it needs to change.`
      );
    }

    const figures = await this.preview(organizationId, currency);
    figures.asOfDate = asOfDate;

    if (figures.openingEquity === 0) {
      throw new LedgerError(
        `There is nothing to open the ${currency} books with: no active loans and no balance on any ${currency} payment method.`
      );
    }

    const entry = await ledgerService.post({
      organizationId,
      currency,
      entryDate: asOfDate,
      description: `Opening balances for ${currency}`,
      source: 'OPENING_BALANCE',
      postedById,
      lines: [
        {
          account: 'LOANS_RECEIVABLE',
          debit: figures.loansReceivable,
          description: 'Principal outstanding at go-live',
        },
        {
          account: 'INTEREST_RECEIVABLE',
          debit: figures.interestReceivable,
          description: 'Interest outstanding at go-live',
        },
        {
          account: 'CASH_AND_BANK',
          debit: figures.cashAndBank,
          description: 'Payment method balances at go-live',
        },
        {
          account: 'OPENING_BALANCE_EQUITY',
          credit: figures.openingEquity,
          description: 'Position brought forward',
        },
      ],
    });

    if (entry) figures.entryNumber = entry.entryNumber;
    return figures;
  }
}

export const openingBalanceService = new OpeningBalanceService();
