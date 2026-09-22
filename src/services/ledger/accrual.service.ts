/**
 * Recognising interest as it is earned rather than as it arrives.
 *
 * Without this, income appears on the day a borrower happens to pay, so a good
 * month followed by a quiet one looks like a collapse in earnings when nothing
 * about the book has changed. Accrual puts the income in the period the loan
 * actually earned it.
 *
 * The run is a true-up, not an increment. `loan.interestBalance` is already the
 * interest charged and not yet collected - which is precisely what the interest
 * receivable account is meant to say - so the job compares the ledger against
 * that figure and posts the difference. Two things follow, both of them useful:
 *
 *  - Running it twice in a day does nothing the second time.
 *  - A repayment or a waiver moves both sides by the same amount, so the next
 *    run finds no gap and posts nothing. The accrual can never double-count
 *    interest that has already been collected or forgiven.
 */

import { prisma } from '../../config/database';
import { ledgerService } from './ledger.service';

export interface AccrualResult {
  currency: string;
  asOf: Date;
  /** What the ledger should carry as interest receivable. */
  target: number;
  /** What it carried before this run. */
  previous: number;
  movement: number;
  loansAssessed: number;
  entryNumber?: string;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

class AccrualService {
  /**
   * Bring interest receivable into line with what the loan book says is owed,
   * for one currency.
   */
  async run(
    organizationId: string,
    currency: string,
    postedById: string,
    asOf: Date = new Date()
  ): Promise<AccrualResult> {
    const loans = await prisma.loan.findMany({
      where: {
        organizationId,
        currency: currency as never,
        status: { in: ['ACTIVE', 'OVERDUE'] },
      },
      select: { id: true, interestBalance: true },
    });

    const target = round2(
      loans.reduce((sum, loan) => sum + Number(loan.interestBalance), 0)
    );

    const tb = await ledgerService.trialBalance(organizationId, currency, asOf);
    const receivable = tb.rows.find(r => r.systemCode === 'INTEREST_RECEIVABLE');
    const previous = round2(receivable?.balance ?? 0);
    const movement = round2(target - previous);

    const result: AccrualResult = {
      currency,
      asOf,
      target,
      previous,
      movement,
      loansAssessed: loans.length,
    };

    if (movement === 0) return result;

    const entry = await ledgerService.post({
      organizationId,
      currency,
      entryDate: asOf,
      description:
        movement > 0
          ? 'Interest accrued'
          : 'Interest accrual reduced to match the loan book',
      source: 'ACCRUAL',
      postedById,
      lines:
        movement > 0
          ? [
              { account: 'INTEREST_RECEIVABLE', debit: movement },
              { account: 'INTEREST_INCOME', credit: movement },
            ]
          : [
              { account: 'INTEREST_INCOME', debit: Math.abs(movement) },
              { account: 'INTEREST_RECEIVABLE', credit: Math.abs(movement) },
            ],
    });

    if (entry) result.entryNumber = entry.entryNumber;
    return result;
  }

  /** Every currency this organization has lent in. */
  async currencies(organizationId: string): Promise<string[]> {
    const rows = await prisma.loan.findMany({
      where: { organizationId, status: { in: ['ACTIVE', 'OVERDUE'] } },
      select: { currency: true },
      distinct: ['currency'],
    });
    return rows.map(r => r.currency as string);
  }

  /** Run the accrual across every currency the organization lends in. */
  async runAll(
    organizationId: string,
    postedById: string,
    asOf: Date = new Date()
  ): Promise<AccrualResult[]> {
    const codes = await this.currencies(organizationId);
    const results: AccrualResult[] = [];
    for (const currency of codes) {
      results.push(await this.run(organizationId, currency, postedById, asOf));
    }
    return results;
  }
}

export const accrualService = new AccrualService();
