/**
 * The posting engine.
 *
 * One rule holds everything else up: a journal entry whose debits do not equal
 * its credits is never written. Every caller goes through `post`, which checks
 * that inside the same transaction that writes the lines, so there is no window
 * in which the ledger is out of balance and no path that skips the check.
 *
 * Amounts are denominated and never mixed. An entry carries one currency and
 * every report is produced per currency, because this system has no base
 * currency and converting at read time would state a total that was never true.
 */

import { Prisma, JournalSource, LedgerAccount, AccountType } from '@prisma/client';
import { prisma } from '../../config/database';
import { ensureChartOfAccounts } from './chart-of-accounts';

/**
 * A single side of an entry. Exactly one of debit/credit is non-zero.
 *
 * The account is given either as a system code, which is resolved against this
 * organization's chart, or as an account id when the caller already knows it -
 * a payment method or an income category that has been mapped to an account of
 * its own. `accountId` wins when both are given.
 */
export interface PostingLine {
  account?: LedgerAccount;
  accountId?: string | null;
  debit?: number;
  credit?: number;
  description?: string;
  branchId?: string | null;
  loanId?: string | null;
}

export interface PostEntryInput {
  organizationId: string;
  branchId?: string | null;
  currency: string;
  entryDate?: Date;
  description: string;
  reference?: string | null;
  source: JournalSource;
  sourceId?: string | null;
  postedById: string;
  lines: PostingLine[];
}

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

/** Money is compared to the cent; floating point noise is not an imbalance. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * How long a posting is allowed to take.
 *
 * Prisma's five-second default assumes a database next door. A posting is
 * several round trips - resolve the chart, find the period, number the entry,
 * write the lines - and against a hosted database each one costs real time.
 * The same headroom the payment service gives itself, for the same reason.
 */
const POSTING_TRANSACTION_OPTIONS = { timeout: 20_000, maxWait: 10_000 };

class LedgerService {
  /**
   * Map every system code to its account id for one organization, seeding the
   * chart first if this organization has never posted before.
   */
  private async accountMap(
    organizationId: string,
    tx: Prisma.TransactionClient
  ): Promise<Map<LedgerAccount, string>> {
    await ensureChartOfAccounts(organizationId, tx);

    const accounts = await tx.chartOfAccount.findMany({
      where: { organizationId, systemCode: { not: null } },
      select: { id: true, systemCode: true },
    });

    return new Map(
      accounts
        .filter(a => a.systemCode !== null)
        .map(a => [a.systemCode as LedgerAccount, a.id])
    );
  }

  /**
   * The period an entry falls in, if the organization keeps periods.
   *
   * Refuses the posting outright when that period is closed. A closed period is
   * a promise that the figures already reported from it will not move.
   */
  private async resolvePeriod(
    organizationId: string,
    entryDate: Date,
    tx: Prisma.TransactionClient
  ): Promise<string | null> {
    const period = await tx.accountingPeriod.findFirst({
      where: {
        organizationId,
        startDate: { lte: entryDate },
        endDate: { gte: entryDate },
      },
    });

    if (!period) return null;

    if (period.status === 'CLOSED') {
      throw new LedgerError(
        `${period.name} is closed, so nothing more can be posted into it. Reopen the period, or post the entry with a date in an open one.`
      );
    }

    return period.id;
  }

  private async nextEntryNumber(
    organizationId: string,
    tx: Prisma.TransactionClient
  ): Promise<string> {
    const count = await tx.journalEntry.count({ where: { organizationId } });
    const now = new Date();
    const year = now.getFullYear().toString().slice(-2);
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    return `JE${year}${month}${(count + 1).toString().padStart(6, '0')}`;
  }

  /**
   * Write one balanced journal entry.
   *
   * Lines that net to nothing are dropped before the balance check - posting a
   * zero-value line is noise, and a rule that produces only zero lines (waiving
   * a penalty of nothing, say) should post no entry at all rather than an empty
   * one. That case returns null.
   */
  async post(
    input: PostEntryInput,
    client?: Prisma.TransactionClient
  ): Promise<{ id: string; entryNumber: string } | null> {
    const run = async (tx: Prisma.TransactionClient) => {
      const lines = input.lines
        .map(line => ({
          ...line,
          debit: round2(line.debit ?? 0),
          credit: round2(line.credit ?? 0),
        }))
        .filter(line => line.debit !== 0 || line.credit !== 0);

      if (lines.length === 0) return null;

      for (const line of lines) {
        if (line.debit < 0 || line.credit < 0) {
          throw new LedgerError(
            'A journal line cannot be negative. Put the amount on the other side instead.'
          );
        }
        if (line.debit !== 0 && line.credit !== 0) {
          throw new LedgerError(
            'A journal line is either a debit or a credit, never both.'
          );
        }
      }

      const debits = round2(lines.reduce((sum, l) => sum + l.debit, 0));
      const credits = round2(lines.reduce((sum, l) => sum + l.credit, 0));

      if (debits !== credits) {
        throw new LedgerError(
          `This entry does not balance: debits ${debits.toFixed(2)} against credits ${credits.toFixed(2)}. Nothing was posted.`
        );
      }

      const entryDate = input.entryDate ?? new Date();
      const accounts = await this.accountMap(input.organizationId, tx);
      const periodId = await this.resolvePeriod(
        input.organizationId,
        entryDate,
        tx
      );

      const entry = await tx.journalEntry.create({
        data: {
          organizationId: input.organizationId,
          branchId: input.branchId ?? null,
          entryNumber: await this.nextEntryNumber(input.organizationId, tx),
          entryDate,
          currency: input.currency as never,
          description: input.description,
          reference: input.reference ?? null,
          source: input.source,
          sourceId: input.sourceId ?? null,
          periodId,
          postedById: input.postedById,
          lines: {
            create: lines.map(line => {
              const accountId =
                line.accountId ??
                (line.account ? accounts.get(line.account) : undefined);
              if (!accountId) {
                throw new LedgerError(
                  line.account
                    ? `The ${line.account} account is missing from this organization's chart, so the entry cannot be posted.`
                    : 'A journal line names no account.'
                );
              }
              return {
                accountId,
                debit: line.debit,
                credit: line.credit,
                description: line.description ?? null,
                branchId: line.branchId ?? input.branchId ?? null,
                loanId: line.loanId ?? null,
              };
            }),
          },
        },
        select: { id: true, entryNumber: true },
      });

      return entry;
    };

    return client
      ? run(client)
      : prisma.$transaction(run, POSTING_TRANSACTION_OPTIONS);
  }

  /**
   * Undo an entry by posting its mirror image.
   *
   * The original is never edited or deleted. A ledger that can be rewritten is
   * not evidence of anything, so a correction is always a second entry that
   * says what it is correcting.
   */
  async reverse(
    entryId: string,
    organizationId: string,
    userId: string,
    reason?: string
  ): Promise<{ id: string; entryNumber: string }> {
    return prisma.$transaction(async tx => {
      const original = await tx.journalEntry.findFirst({
        where: { id: entryId, organizationId },
        include: { lines: { include: { account: true } } },
      });

      if (!original) {
        throw new LedgerError('That journal entry could not be found.');
      }
      if (original.status === 'REVERSED') {
        throw new LedgerError(
          `${original.entryNumber} has already been reversed.`
        );
      }

      const entryDate = new Date();
      const periodId = await this.resolvePeriod(organizationId, entryDate, tx);

      const reversal = await tx.journalEntry.create({
        data: {
          organizationId,
          branchId: original.branchId,
          entryNumber: await this.nextEntryNumber(organizationId, tx),
          entryDate,
          currency: original.currency,
          description: reason
            ? `Reversal of ${original.entryNumber}: ${reason}`
            : `Reversal of ${original.entryNumber}`,
          reference: original.reference,
          source: 'REVERSAL',
          sourceId: original.id,
          periodId,
          postedById: userId,
          reversalOfId: original.id,
          lines: {
            // Debits become credits and credits become debits.
            create: original.lines.map(line => ({
              accountId: line.accountId,
              debit: line.credit,
              credit: line.debit,
              description: line.description,
              branchId: line.branchId,
              loanId: line.loanId,
            })),
          },
        },
        select: { id: true, entryNumber: true },
      });

      await tx.journalEntry.update({
        where: { id: original.id },
        data: {
          status: 'REVERSED',
          reversedAt: entryDate,
          reversedById: userId,
        },
      });

      return reversal;
    }, POSTING_TRANSACTION_OPTIONS);
  }

  /**
   * Account balances as at a date, for one currency.
   *
   * Reversed entries are left in - both the original and its mirror - because
   * they cancel out arithmetically and removing either would hide a correction
   * that someone should be able to see.
   */
  async trialBalance(
    organizationId: string,
    currency: string,
    asOf: Date = new Date()
  ) {
    await ensureChartOfAccounts(organizationId);

    const [accounts, sums] = await Promise.all([
      prisma.chartOfAccount.findMany({
        where: { organizationId },
        orderBy: { code: 'asc' },
      }),
      prisma.journalLine.groupBy({
        by: ['accountId'],
        where: {
          entry: {
            organizationId,
            currency: currency as never,
            entryDate: { lte: asOf },
          },
        },
        _sum: { debit: true, credit: true },
      }),
    ]);

    const byAccount = new Map(
      sums.map(s => [
        s.accountId,
        {
          debit: Number(s._sum.debit ?? 0),
          credit: Number(s._sum.credit ?? 0),
        },
      ])
    );

    const rows = accounts.map(account => {
      const movement = byAccount.get(account.id) ?? { debit: 0, credit: 0 };
      // Assets and expenses are natural debits; the rest are natural credits.
      const naturalDebit =
        account.type === 'ASSET' || account.type === 'EXPENSE';
      const net = naturalDebit
        ? movement.debit - movement.credit
        : movement.credit - movement.debit;

      return {
        accountId: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
        systemCode: account.systemCode,
        parentId: account.parentId,
        debit: round2(movement.debit),
        credit: round2(movement.credit),
        balance: round2(net),
      };
    });

    const totalDebit = round2(rows.reduce((s, r) => s + r.debit, 0));
    const totalCredit = round2(rows.reduce((s, r) => s + r.credit, 0));

    return {
      currency,
      asOf,
      rows,
      totalDebit,
      totalCredit,
      /** Should always be true. If it is not, something wrote lines directly. */
      inBalance: totalDebit === totalCredit,
    };
  }

  /** Income and expense movement between two dates, for one currency. */
  async profitAndLoss(
    organizationId: string,
    currency: string,
    from: Date,
    to: Date
  ) {
    const sums = await prisma.journalLine.groupBy({
      by: ['accountId'],
      where: {
        entry: {
          organizationId,
          currency: currency as never,
          entryDate: { gte: from, lte: to },
        },
        account: { type: { in: ['INCOME', 'EXPENSE'] } },
      },
      _sum: { debit: true, credit: true },
    });

    const accounts = await prisma.chartOfAccount.findMany({
      where: { organizationId, type: { in: ['INCOME', 'EXPENSE'] } },
      orderBy: { code: 'asc' },
    });

    const byAccount = new Map(
      sums.map(s => [
        s.accountId,
        { debit: Number(s._sum.debit ?? 0), credit: Number(s._sum.credit ?? 0) },
      ])
    );

    const build = (type: AccountType) =>
      accounts
        .filter(a => a.type === type)
        .map(account => {
          const m = byAccount.get(account.id) ?? { debit: 0, credit: 0 };
          const amount =
            type === 'INCOME' ? m.credit - m.debit : m.debit - m.credit;
          return {
            accountId: account.id,
            code: account.code,
            name: account.name,
            parentId: account.parentId,
            amount: round2(amount),
          };
        });

    const income = build('INCOME');
    const expenses = build('EXPENSE');
    const totalIncome = round2(income.reduce((s, r) => s + r.amount, 0));
    const totalExpenses = round2(expenses.reduce((s, r) => s + r.amount, 0));

    return {
      currency,
      from,
      to,
      income,
      expenses,
      totalIncome,
      totalExpenses,
      netSurplus: round2(totalIncome - totalExpenses),
    };
  }

  /**
   * Position as at a date, for one currency.
   *
   * Retained earnings shown here is the ledger's own: accumulated income less
   * expenses to date, plus whatever has been posted to the retained earnings
   * account. That is what makes the sheet balance without a year-end close
   * having been run.
   */
  async balanceSheet(
    organizationId: string,
    currency: string,
    asOf: Date = new Date()
  ) {
    const tb = await this.trialBalance(organizationId, currency, asOf);

    const of = (type: AccountType) => tb.rows.filter(r => r.type === type);

    const assets = of('ASSET');
    const liabilities = of('LIABILITY');
    const equity = of('EQUITY');

    const totalAssets = round2(assets.reduce((s, r) => s + r.balance, 0));
    const totalLiabilities = round2(
      liabilities.reduce((s, r) => s + r.balance, 0)
    );
    const postedEquity = round2(equity.reduce((s, r) => s + r.balance, 0));

    const totalIncome = round2(
      of('INCOME').reduce((s, r) => s + r.balance, 0)
    );
    const totalExpenses = round2(
      of('EXPENSE').reduce((s, r) => s + r.balance, 0)
    );
    const earnings = round2(totalIncome - totalExpenses);

    const totalEquity = round2(postedEquity + earnings);

    return {
      currency,
      asOf,
      assets,
      liabilities,
      equity,
      totalAssets,
      totalLiabilities,
      postedEquity,
      /** Income less expenses to date, not yet closed to equity. */
      currentEarnings: earnings,
      totalEquity,
      /** Assets less liabilities and equity. Zero on a sound ledger. */
      difference: round2(totalAssets - totalLiabilities - totalEquity),
    };
  }
}

export const ledgerService = new LedgerService();
