import {
  combineByCurrency,
  countAcross,
  groupByKeyAndCurrency,
  netByCurrency,
  toMoneyTotals,
} from '../src/utils/money-by-currency';

/**
 * The bug these cover: the dashboard reported a book holding USD 570,720 and
 * ZiG 4,350 as a single figure of $575,070. Every total the API emits must
 * stay split by denomination.
 */
describe('toMoneyTotals', () => {
  const rows = [
    { currency: 'ZWG', _sum: { amount: 4350 }, _count: 3 },
    { currency: 'USD', _sum: { amount: 570720 }, _count: 44 },
  ];

  it('keeps each currency separate and sorted', () => {
    expect(toMoneyTotals(rows, 'amount')).toEqual([
      { currency: 'USD', amount: 570720, count: 44 },
      { currency: 'ZWG', amount: 4350, count: 3 },
    ]);
  });

  it('never produces a combined figure', () => {
    const totals = toMoneyTotals(rows, 'amount');
    expect(totals.map(t => t.amount)).not.toContain(575070);
  });

  it('treats a missing sum as zero rather than NaN', () => {
    expect(
      toMoneyTotals([{ currency: 'USD', _sum: {}, _count: 0 }], 'amount')
    ).toEqual([{ currency: 'USD', amount: 0, count: 0 }]);
  });

  it('falls back to a currency rather than dropping the row', () => {
    expect(
      toMoneyTotals([{ currency: null, _sum: { amount: 10 }, _count: 1 }], 'amount')
    ).toEqual([{ currency: 'USD', amount: 10, count: 1 }]);
  });
});

describe('countAcross', () => {
  it('adds counts, which are currency-independent', () => {
    expect(
      countAcross([
        { currency: 'USD', amount: 570720, count: 44 },
        { currency: 'ZWG', amount: 4350, count: 3 },
      ])
    ).toBe(47);
  });
});

describe('combineByCurrency', () => {
  it('lines several series up per currency', () => {
    const rows = combineByCurrency({
      disbursed: [
        { currency: 'USD', amount: 100, count: 2 },
        { currency: 'ZWG', amount: 50, count: 1 },
      ],
      outstanding: [{ currency: 'USD', amount: 40, count: 1 }],
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      currency: 'USD',
      disbursed: { amount: 100 },
      outstanding: { amount: 40 },
    });
    // Present in one series only: zero, not absent, so the row still renders.
    expect(rows[1]).toMatchObject({
      currency: 'ZWG',
      disbursed: { amount: 50 },
      outstanding: { amount: 0, count: 0 },
    });
  });
});

describe('netByCurrency', () => {
  it('subtracts within each currency', () => {
    expect(
      netByCurrency(
        [
          { currency: 'USD', amount: 900, count: 3 },
          { currency: 'ZWG', amount: 500, count: 1 },
        ],
        [{ currency: 'USD', amount: 250, count: 1 }]
      )
    ).toEqual([
      { currency: 'USD', amount: 650 },
      { currency: 'ZWG', amount: 500 },
    ]);
  });

  it('reports a currency that only appears on the negative side', () => {
    expect(
      netByCurrency([], [{ currency: 'ZAR', amount: 80, count: 1 }])
    ).toEqual([{ currency: 'ZAR', amount: -80 }]);
  });
});

describe('groupByKeyAndCurrency', () => {
  it('splits one query into per-key, per-currency totals', () => {
    const grouped = groupByKeyAndCurrency<string>(
      [
        { method: 'CASH', currency: 'USD', _sum: { amount: 300 }, _count: 2 },
        { method: 'CASH', currency: 'ZWG', _sum: { amount: 700 }, _count: 4 },
        { method: 'ECOCASH', currency: 'USD', _sum: { amount: 120 }, _count: 1 },
      ],
      'method',
      'amount'
    );

    // A payment method taking both currencies keeps them apart, instead of
    // reporting 1000 and formatting it as USD.
    expect(grouped.get('CASH')).toEqual([
      { currency: 'USD', amount: 300, count: 2 },
      { currency: 'ZWG', amount: 700, count: 4 },
    ]);
    expect(grouped.get('ECOCASH')).toHaveLength(1);
  });
});
