/**
 * Charges applied at disbursement, with the database mocked.
 *
 * A failed disbursement used to leave the admin fee booked as income against
 * the payment method: the income went through a separate transaction started
 * from inside the charge transaction, so when the charge transaction expired
 * and rolled back, the income stayed. These hold the income inside the same
 * transaction, and stop a retry from booking a fee a second time.
 */

const LOAN = 'loan-1';
const CHARGE = 'charge-1';
const EXISTING = 'loancharge-515ce83d';

const tx: any = {
  loanCharge: {
    update: jest.fn(async ({ where, data }: any) => ({ id: where.id, financialTransactionId: null, ...data })),
    create: jest.fn(),
    findFirst: jest.fn(async () => null),
  },
  financialTransaction: { findFirst: jest.fn(async () => null) },
};

const db: any = {
  loan: {
    findUnique: jest.fn(async () => ({
      id: LOAN,
      loanNumber: 'LN26090003',
      amount: 500,
      organizationId: 'org-1',
      branchId: 'branch-1',
      productId: 'product-1',
      product: { currency: 'ZAR', productCharges: [] },
    })),
  },
  charge: {
    findMany: jest.fn(async () => [
      { id: CHARGE, name: 'Admin Fee', isDeductedFromPrincipal: true, chargeRates: [] },
    ]),
  },
  loanCharge: {
    findMany: jest.fn(async () => [
      {
        id: EXISTING,
        chargeId: CHARGE,
        calculatedAmount: 50,
        isDeductedFromPrincipal: true,
        appliedBy: null,
        paidAt: null,
      },
    ]),
  },
  incomeCategory: { findFirst: jest.fn(async () => ({ id: 'fee-category' })) },
  $transaction: jest.fn(async (fn: (client: unknown) => unknown) => fn(tx)),
};

jest.mock('../src/config/database', () => ({
  get prisma() {
    return db;
  },
}));

const createTransaction = jest.fn(async () => ({ id: 'ft-new' }));
jest.mock('../src/services/financial-transaction.service', () => ({
  financialTransactionService: {
    create: (...args: unknown[]) => (createTransaction as any)(...args),
  },
}));

import { chargeService } from '../src/services/charge.service';

const apply = () =>
  chargeService.applyDisbursementCharges({
    loanId: LOAN,
    chargeIds: [CHARGE],
    appliedBy: 'user-1',
    paymentMethodId: 'fnb',
  });

beforeEach(() => {
  jest.clearAllMocks();
});

it('books the fee inside the charge transaction, not in one of its own', async () => {
  await apply();
  expect(createTransaction).toHaveBeenCalledTimes(1);
  const [input, client] = createTransaction.mock.calls[0] as any[];
  expect(client).toBe(tx);
  expect(input).toMatchObject({
    type: 'INCOME',
    incomeCategoryId: 'fee-category',
    amount: 50,
    currency: 'ZAR',
    paymentMethodId: 'fnb',
    reference: 'CHG-515CE83D',
  });
  expect(tx.loanCharge.update).toHaveBeenLastCalledWith({
    where: { id: EXISTING },
    data: { financialTransactionId: 'ft-new' },
  });
});

it('allows a remote database enough time', async () => {
  await apply();
  expect(db.$transaction.mock.calls[0][1]).toMatchObject({ timeout: 30_000 });
});

it('uses the fee an earlier failed attempt already booked, instead of taking it twice', async () => {
  tx.financialTransaction.findFirst.mockResolvedValueOnce({ id: 'ft-orphan' });
  await apply();
  expect(createTransaction).not.toHaveBeenCalled();
  expect(tx.financialTransaction.findFirst.mock.calls[0][0].where).toMatchObject({
    relatedLoanId: LOAN,
    type: 'INCOME',
    reference: 'CHG-515CE83D',
    paymentMethodId: 'fnb',
    amount: 50,
    currency: 'ZAR',
  });
  expect(tx.loanCharge.update).toHaveBeenLastCalledWith({
    where: { id: EXISTING },
    data: { financialTransactionId: 'ft-orphan' },
  });
});

it('does not reuse an entry another charge already points at', async () => {
  tx.financialTransaction.findFirst.mockResolvedValueOnce({ id: 'ft-taken' });
  tx.loanCharge.findFirst.mockResolvedValueOnce({ id: 'other-charge' });
  await apply();
  expect(createTransaction).toHaveBeenCalledTimes(1);
});

it('refuses before writing anything when there is no income category', async () => {
  db.incomeCategory.findFirst.mockResolvedValueOnce(null);
  await expect(apply()).rejects.toThrow(/income category/);
  expect(db.$transaction).not.toHaveBeenCalled();
});
