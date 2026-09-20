import { prisma } from '../config/database';
import { UserRole } from '../types';

/**
 * What a new organization still needs before it can operate.
 *
 * A freshly created organization is an empty shell: it has a name and not much
 * else. Nothing in the product told anyone that, so the first person to sign in
 * met a dashboard of zeroes and a series of screens that refused to work for
 * reasons they had to deduce - no branch to assign a user to, no product to
 * lend against, no way to record a repayment.
 *
 * This reports that state as data. `required` steps block real work and are
 * what the setup wizard walks through; `recommended` ones are things an
 * operator will want soon but can leave.
 */

export type SetupStepKey =
  | 'profile'
  | 'administrator'
  | 'branch'
  | 'loanProduct'
  | 'paymentMethod'
  | 'currency'
  | 'loanCategory'
  | 'charge'
  | 'collateralType'
  | 'loanPurpose'
  | 'accountingCategories';

export interface SetupStep {
  key: SetupStepKey;
  label: string;
  /** One line on why this is needed, shown in the wizard. */
  description: string;
  required: boolean;
  complete: boolean;
  /** What is there now, e.g. 2 branches. */
  count?: number;
  /** What is missing, when the step is incomplete for a specific reason. */
  detail?: string;
  /**
   * Where in the app to go and do it, when the viewer can get there.
   *
   * Absent when the only screen for this step lives in the platform admin
   * area, which an organization's own staff cannot open. A step with no href
   * renders without a button rather than offering a link that redirects them
   * straight back out.
   */
  href?: string;
  /** Shown in place of the button when there is nowhere for this viewer to go. */
  blockedReason?: string;
  /**
   * Endpoints that fill this step with sensible defaults.
   *
   * Present only where seeding exists and is additive - nothing already there
   * is touched. The wizard offers them as a one-click alternative to visiting
   * the screen, which for a brand new organization is most of the work.
   */
  seedEndpoints?: string[];
}

export interface SetupStatus {
  organizationId: string;
  organizationName: string;
  /** True once every required step is done. */
  isComplete: boolean;
  requiredTotal: number;
  requiredComplete: number;
  recommendedTotal: number;
  recommendedComplete: number;
  steps: SetupStep[];
}

/** Fields an organization needs before it can put its name on a document. */
const PROFILE_FIELDS: Array<{ field: 'email' | 'phone' | 'address'; label: string }> = [
  { field: 'email', label: 'email address' },
  { field: 'phone', label: 'phone number' },
  { field: 'address', label: 'address' },
];

const PLATFORM_ONLY =
  'Only a platform administrator can change this - ask them to complete it.';

export async function getSetupStatus(
  organizationId: string,
  viewer: { isSuperAdmin: boolean } = { isSuperAdmin: false }
): Promise<SetupStatus | null> {
  // Several of these screens exist only in the platform admin area, which the
  // admin layout redirects non-super-admins away from. Sending an organization
  // admin there would bounce them back to the dashboard and look broken, so
  // the organization-level equivalent is used where one exists and the link is
  // withheld where one does not.
  const { isSuperAdmin } = viewer;
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      address: true,
    },
  });

  if (!organization) return null;

  const [
    administrators,
    branches,
    loanProducts,
    paymentMethods,
    activeCurrencies,
    loanCategories,
    charges,
    collateralTypes,
    loanPurposes,
    expenseCategories,
    incomeCategories,
  ] = await Promise.all([
    prisma.user.count({
      where: {
        organizationId,
        role: { in: [UserRole.ORG_ADMIN, UserRole.ADMIN] as any },
      },
    }),
    prisma.branch.count({ where: { organizationId, isActive: true } }),
    prisma.loanProduct.count({ where: { organizationId } }),
    prisma.paymentMethod.count({ where: { organizationId, isActive: true } }),
    prisma.currencyRecord.count({ where: { isActive: true } }),
    prisma.loanCategory.count({ where: { organizationId } }),
    prisma.charge.count({ where: { organizationId } }),
    prisma.collateralType.count({ where: { organizationId } }),
    prisma.loanPurpose.count({ where: { organizationId } }),
    prisma.expenseCategory.count({ where: { organizationId } }),
    prisma.incomeCategory.count({ where: { organizationId } }),
  ]);

  const missingProfileFields = PROFILE_FIELDS.filter(
    entry => !String(organization[entry.field] ?? '').trim()
  ).map(entry => entry.label);

  const steps: SetupStep[] = [
    {
      key: 'profile',
      label: 'Organization details',
      description:
        'Contact details appear on statements, receipts and client correspondence.',
      required: true,
      complete: missingProfileFields.length === 0,
      detail: missingProfileFields.length
        ? `Missing ${missingProfileFields.join(', ')}`
        : undefined,
      href: isSuperAdmin ? '/admin/organizations' : undefined,
      blockedReason: isSuperAdmin ? undefined : PLATFORM_ONLY,
    },
    {
      key: 'administrator',
      label: 'Organization administrator',
      description:
        'Someone inside the organization who can configure it and manage its people.',
      required: true,
      complete: administrators > 0,
      count: administrators,
      detail:
        administrators === 0
          ? 'No administrator yet - no other users can be created until there is one'
          : undefined,
      href: isSuperAdmin ? '/admin/users' : '/users',
    },
    {
      key: 'branch',
      label: 'At least one branch',
      description:
        'Staff, clients and loans all belong to a branch. Nothing can be assigned without one.',
      required: true,
      complete: branches > 0,
      count: branches,
      href: '/branches',
    },
    {
      key: 'loanProduct',
      label: 'A loan product',
      description:
        'Defines the amounts, interest and term a loan can be issued on. No loan can be created without one.',
      required: true,
      complete: loanProducts > 0,
      count: loanProducts,
      href: '/loan-products',
    },
    {
      key: 'paymentMethod',
      label: 'A payment method',
      description:
        'Cash, bank or mobile money - repayments cannot be recorded until one exists.',
      required: true,
      complete: paymentMethods > 0,
      count: paymentMethods,
      href: '/payment-methods',
      seedEndpoints: ['/payment-methods/seed'],
    },
    {
      key: 'currency',
      label: 'An active currency',
      description: 'Currencies are shared platform-wide and one must be active.',
      required: true,
      complete: activeCurrencies > 0,
      count: activeCurrencies,
      href: isSuperAdmin ? '/admin/currencies' : '/currencies',
    },
    {
      key: 'loanCategory',
      label: 'Loan categories',
      description: 'Groups your products so reporting can break lending down.',
      required: false,
      complete: loanCategories > 0,
      count: loanCategories,
      href: '/loan-categories',
    },
    {
      key: 'charge',
      label: 'Fees and charges',
      description: 'Arrangement fees, penalties and any other charge you apply.',
      required: false,
      complete: charges > 0,
      count: charges,
      href: '/charges',
    },
    {
      key: 'collateralType',
      label: 'Collateral types',
      description: 'What borrowers can pledge against a secured loan.',
      required: false,
      complete: collateralTypes > 0,
      count: collateralTypes,
      href: isSuperAdmin ? '/admin/collateral-types' : undefined,
      blockedReason: isSuperAdmin ? undefined : PLATFORM_ONLY,
    },
    {
      key: 'loanPurpose',
      label: 'Loan purposes',
      description:
        'What borrowers are borrowing for. Recorded on every application and is what portfolio reporting breaks down by.',
      // Promoted from recommended: without it every loan is booked against a
      // blank purpose, and that cannot be reconstructed afterwards.
      required: true,
      complete: loanPurposes > 0,
      count: loanPurposes,
      href: '/loan-purposes',
      seedEndpoints: ['/loan-purposes/seed'],
    },
    {
      key: 'accountingCategories',
      label: 'Income and expense categories',
      description: 'Needed before the finance screens can classify movements.',
      required: false,
      complete: expenseCategories > 0 && incomeCategories > 0,
      count: expenseCategories + incomeCategories,
      detail:
        expenseCategories === 0 && incomeCategories === 0
          ? 'None set up'
          : expenseCategories === 0
            ? 'No expense categories'
            : incomeCategories === 0
              ? 'No income categories'
              : undefined,
      href: '/expense-categories',
      // Both sets: a disbursement needs the expense category and a loan charge
      // needs the income one, so seeding half of it still leaves work blocked.
      seedEndpoints: [
        '/expense-categories/seed',
        '/income-categories/seed',
      ],
    },
  ];

  const required = steps.filter(step => step.required);
  const recommended = steps.filter(step => !step.required);

  return {
    organizationId: organization.id,
    organizationName: organization.name,
    isComplete: required.every(step => step.complete),
    requiredTotal: required.length,
    requiredComplete: required.filter(step => step.complete).length,
    recommendedTotal: recommended.length,
    recommendedComplete: recommended.filter(step => step.complete).length,
    steps,
  };
}

export default { getSetupStatus };
