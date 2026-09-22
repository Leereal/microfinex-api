/**
 * The standard chart a new organization starts with.
 *
 * Seeded per organization rather than shared, so an accountant can rename
 * accounts to match the language their auditor expects and add their own
 * children underneath. What they cannot do is delete a seeded account, because
 * the posting engine resolves by `systemCode` rather than by code or name - so
 * "1200 Loans to borrowers" can become "1200 Advances to members" without a
 * single posting rule changing.
 *
 * Codes follow the usual five blocks: 1 asset, 2 liability, 3 equity, 4 income,
 * 5 expense. Parents carry no postings; they exist so a balance sheet and a
 * profit and loss have something to group by.
 */

import { randomUUID } from 'crypto';
import { AccountType, LedgerAccount, Prisma } from '@prisma/client';
import { prisma } from '../../config/database';

export interface SeedAccount {
  code: string;
  name: string;
  type: AccountType;
  systemCode?: LedgerAccount;
  description?: string;
  /** Code of the parent in this same list. */
  parent?: string;
}

export const STANDARD_CHART: SeedAccount[] = [
  // ------------------------------------------------------------------ assets
  { code: '1000', name: 'Assets', type: 'ASSET' },
  {
    code: '1100',
    name: 'Cash and bank',
    type: 'ASSET',
    parent: '1000',
    systemCode: 'CASH_AND_BANK',
    description:
      'Money the organization holds. A payment method can post to its own child account instead of this one.',
  },
  {
    code: '1200',
    name: 'Loans to borrowers',
    type: 'ASSET',
    parent: '1000',
    systemCode: 'LOANS_RECEIVABLE',
    description: 'Principal advanced and not yet repaid.',
  },
  {
    code: '1210',
    name: 'Interest receivable',
    type: 'ASSET',
    parent: '1000',
    systemCode: 'INTEREST_RECEIVABLE',
    description:
      'Interest earned but not yet collected. Built up by the accrual run.',
  },
  {
    code: '1290',
    name: 'Provision for loan losses',
    type: 'ASSET',
    parent: '1000',
    systemCode: 'LOAN_LOSS_PROVISION',
    description:
      'What the book expects not to collect. A contra-asset: it normally carries a credit balance and is shown as a deduction from loans.',
  },

  // ------------------------------------------------------------- liabilities
  { code: '2000', name: 'Liabilities', type: 'LIABILITY' },
  {
    code: '2900',
    name: 'Suspense',
    type: 'LIABILITY',
    parent: '2000',
    systemCode: 'SUSPENSE',
    description:
      'Where a posting lands when no better account can be resolved. A healthy book keeps this at zero; anything sitting here is something to investigate.',
  },

  // ------------------------------------------------------------------ equity
  { code: '3000', name: 'Equity', type: 'EQUITY' },
  {
    code: '3100',
    name: 'Opening balance equity',
    type: 'EQUITY',
    parent: '3000',
    systemCode: 'OPENING_BALANCE_EQUITY',
    description:
      'The balancing side of the opening balances posted when the ledger went live. It is not a real source of funds; it should be cleared to retained earnings once the opening position has been agreed.',
  },
  {
    code: '3200',
    name: 'Retained earnings',
    type: 'EQUITY',
    parent: '3000',
    systemCode: 'RETAINED_EARNINGS',
  },

  // ------------------------------------------------------------------ income
  { code: '4000', name: 'Income', type: 'INCOME' },
  {
    code: '4100',
    name: 'Interest income',
    type: 'INCOME',
    parent: '4000',
    systemCode: 'INTEREST_INCOME',
  },
  {
    code: '4200',
    name: 'Fee income',
    type: 'INCOME',
    parent: '4000',
    systemCode: 'FEE_INCOME',
  },
  {
    code: '4300',
    name: 'Penalty income',
    type: 'INCOME',
    parent: '4000',
    systemCode: 'PENALTY_INCOME',
  },
  {
    code: '4400',
    name: 'Recoveries of written-off loans',
    type: 'INCOME',
    parent: '4000',
    systemCode: 'RECOVERY_INCOME',
    description:
      'Money collected on a loan already written off. It is income when it arrives, not a reversal of the original loss.',
  },
  {
    code: '4900',
    name: 'Other income',
    type: 'INCOME',
    parent: '4000',
    systemCode: 'OTHER_INCOME',
    description:
      'Where an income category posts when it has not been mapped to an account of its own.',
  },

    // --------------------------------------------------------------- expenses
  { code: '5000', name: 'Expenses', type: 'EXPENSE' },
  {
    code: '5100',
    name: 'Impairment charge',
    type: 'EXPENSE',
    parent: '5000',
    systemCode: 'IMPAIRMENT_EXPENSE',
    description:
      'The movement in the loan loss provision for the period. This is what makes reported profit honest about arrears.',
  },
  {
    code: '5110',
    name: 'Loans written off',
    type: 'EXPENSE',
    parent: '5000',
    systemCode: 'LOANS_WRITTEN_OFF',
    description:
      'Balances accepted as uncollectible, to the extent they were not already provided for.',
  },
  {
    code: '5120',
    name: 'Interest and penalties waived',
    type: 'EXPENSE',
    parent: '5000',
    systemCode: 'INTEREST_WAIVED',
    description:
      'Amounts forgiven rather than collected. Kept separate from write-offs because a waiver is a decision to charge less, not a failure to collect.',
  },
  {
    code: '5900',
    name: 'Other expenses',
    type: 'EXPENSE',
    parent: '5000',
    systemCode: 'OTHER_EXPENSE',
    description:
      'Where an expense category posts when it has not been mapped to an account of its own.',
  },
];

/**
 * Give an organization its chart if it has none.
 *
 * Idempotent: seeding twice adds nothing, and an organization that has renamed
 * its accounts keeps those names. Safe to call on every ledger write, which is
 * what makes the ledger work for organizations that existed before it did.
 */
export async function ensureChartOfAccounts(
  organizationId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<void> {
  const existing = await client.chartOfAccount.count({
    where: { organizationId },
  });
  if (existing > 0) return;

  /**
   * Two round trips, not twenty-one.
   *
   * This ran one `create` per account, which is fine next to a local database
   * and not fine against a hosted one: twenty-one sequential round trips took
   * over five seconds, and since the seed runs inside the caller's transaction
   * - the posting engine seeds on its first write - that blew Prisma's default
   * interactive transaction timeout. The very first journal entry an
   * organization ever posted would fail.
   *
   * Ids are generated here so children can name their parent without a read
   * between the two writes.
   */
  const ids = new Map<string, string>(
    STANDARD_CHART.map(account => [account.code, randomUUID()])
  );

  const row = (account: SeedAccount) => ({
    id: ids.get(account.code)!,
    organizationId,
    code: account.code,
    name: account.name,
    type: account.type,
    systemCode: account.systemCode ?? null,
    description: account.description ?? null,
    parentId: account.parent ? (ids.get(account.parent) ?? null) : null,
    isSystem: true,
  });

  // Parents first, so the children's foreign key has something to point at.
  await client.chartOfAccount.createMany({
    data: STANDARD_CHART.filter(a => !a.parent).map(row),
  });
  await client.chartOfAccount.createMany({
    data: STANDARD_CHART.filter(a => a.parent).map(row),
  });
}
