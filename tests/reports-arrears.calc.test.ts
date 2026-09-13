import { Prisma } from '@prisma/client';
import {
  instalmentArrears,
  loanArrears,
  agingBucketFor,
  AGING_BUCKETS,
  PAR_THRESHOLDS,
  type ScheduleRow,
} from '../src/services/reports/arrears.calc';
import { CurrencyBook, percentOf } from '../src/services/reports/currency-book';
import { checkReconciliation } from '../src/services/reports/report-context';

/**
 * The defects these cover:
 *
 *  - A partly paid instalment was charged to arrears in full, so principal and
 *    interest added up to more than the total arrears beside them.
 *  - Every report summed outstanding balances across currencies, reporting a
 *    figure that is not true in any denomination.
 *  - PAR thresholds and aging buckets were conflated, so cumulative figures
 *    were read as if they were exclusive.
 */

const schedule = (
  dueDate: string,
  principal: number,
  interest: number,
  paid: number
): ScheduleRow => ({
  dueDate: new Date(dueDate),
  principalAmount: new Prisma.Decimal(principal),
  interestAmount: new Prisma.Decimal(interest),
  totalAmount: new Prisma.Decimal(principal + interest),
  paidAmount: new Prisma.Decimal(paid),
});

describe('instalmentArrears - partial payments', () => {
  it('charges nothing when the instalment is settled', () => {
    const result = instalmentArrears(schedule('2026-01-31', 100, 20, 120));
    expect(Number(result.remaining)).toBe(0);
    expect(Number(result.principalRemaining)).toBe(0);
    expect(Number(result.interestRemaining)).toBe(0);
  });

  it('charges the whole instalment when nothing has been paid', () => {
    const result = instalmentArrears(schedule('2026-01-31', 100, 20, 0));
    expect(Number(result.remaining)).toBe(120);
    expect(Number(result.principalRemaining)).toBe(100);
    expect(Number(result.interestRemaining)).toBe(20);
  });

  it('settles interest before principal on a part payment', () => {
    // 30 paid against 20 interest + 100 principal: interest cleared, 10 off
    // the principal, so 90 of principal remains and no interest.
    const result = instalmentArrears(schedule('2026-01-31', 100, 20, 30));
    expect(Number(result.interestRemaining)).toBe(0);
    expect(Number(result.principalRemaining)).toBe(90);
    expect(Number(result.remaining)).toBe(90);
  });

  it('leaves principal untouched when the payment is less than the interest', () => {
    const result = instalmentArrears(schedule('2026-01-31', 100, 20, 5));
    expect(Number(result.interestRemaining)).toBe(15);
    expect(Number(result.principalRemaining)).toBe(100);
    expect(Number(result.remaining)).toBe(115);
  });

  it('never charges more than the instalment - the defect this replaces', () => {
    const row = schedule('2026-01-31', 100, 20, 108);
    const result = instalmentArrears(row);

    // The old behaviour charged the full 100 + 20 to arrears on any unpaid
    // instalment. Only 12 is actually owed.
    expect(Number(result.remaining)).toBe(12);
    expect(
      Number(result.principalRemaining) + Number(result.interestRemaining)
    ).toBe(12);
  });

  it('keeps the components adding to the remainder, for any part payment', () => {
    for (let paid = 0; paid <= 120; paid += 7) {
      const result = instalmentArrears(schedule('2026-01-31', 100, 20, paid));
      expect(
        Number(result.principalRemaining) + Number(result.interestRemaining)
      ).toBeCloseTo(Number(result.remaining), 10);
    }
  });

  it('treats an overpaid instalment as settled, not negative', () => {
    const result = instalmentArrears(schedule('2026-01-31', 100, 20, 500));
    expect(Number(result.remaining)).toBe(0);
    expect(Number(result.principalRemaining)).toBe(0);
  });

  it('carries cents without float drift', () => {
    let total = new Prisma.Decimal(0);
    for (let i = 0; i < 1000; i++) {
      total = total.add(
        instalmentArrears(schedule('2026-01-31', 0.07, 0.03, 0)).remaining
      );
    }
    expect(Number(total)).toBe(100);
  });
});

describe('loanArrears', () => {
  const asOf = new Date('2026-03-31T12:00:00Z');

  it('reports nothing overdue for a loan with no due instalments', () => {
    const result = loanArrears([schedule('2026-06-30', 100, 20, 0)], asOf);
    expect(result.inArrears).toBe(false);
    expect(result.daysOverdue).toBe(0);
    expect(result.oldestUnpaidDueDate).toBeNull();
    expect(Number(result.overdueAmount)).toBe(0);
  });

  it('ignores instalments that have not fallen due yet', () => {
    const result = loanArrears(
      [schedule('2026-03-01', 100, 20, 0), schedule('2026-12-01', 100, 20, 0)],
      asOf
    );
    expect(result.overdueInstalments).toBe(1);
    expect(Number(result.overdueAmount)).toBe(120);
  });

  it('ages from the oldest unpaid instalment, not the newest', () => {
    const result = loanArrears(
      [schedule('2026-01-01', 100, 20, 0), schedule('2026-03-01', 100, 20, 0)],
      asOf
    );
    expect(result.oldestUnpaidDueDate?.toISOString().slice(0, 10)).toBe(
      '2026-01-01'
    );
    expect(result.daysOverdue).toBe(89);
  });

  it('skips settled instalments when finding the oldest unpaid one', () => {
    const result = loanArrears(
      [
        schedule('2026-01-01', 100, 20, 120), // paid in full
        schedule('2026-03-01', 100, 20, 0),
      ],
      asOf
    );
    expect(result.oldestUnpaidDueDate?.toISOString().slice(0, 10)).toBe(
      '2026-03-01'
    );
    expect(result.overdueInstalments).toBe(1);
  });

  it('keeps principal and interest adding to the overdue total', () => {
    const result = loanArrears(
      [
        schedule('2026-01-01', 100, 20, 30),
        schedule('2026-02-01', 100, 20, 0),
        schedule('2026-03-01', 100, 20, 115),
      ],
      asOf
    );
    expect(
      Number(result.overduePrincipal) + Number(result.overdueInterest)
    ).toBeCloseTo(Number(result.overdueAmount), 10);
  });

  it('returns no arrears for an empty schedule', () => {
    const result = loanArrears([], asOf);
    expect(result.inArrears).toBe(false);
    expect(Number(result.overdueAmount)).toBe(0);
  });
});

describe('aging buckets are mutually exclusive', () => {
  it('puts each day count in exactly one bucket', () => {
    for (const days of [0, 1, 30, 31, 60, 61, 90, 91, 180, 181, 5000]) {
      const matches = AGING_BUCKETS.filter(
        bucket => days >= bucket.min && days <= bucket.max
      );
      expect(matches).toHaveLength(1);
      expect(agingBucketFor(days)).toBe(matches[0]!.key);
    }
  });

  it('places boundary days in the bucket their label claims', () => {
    expect(agingBucketFor(0)).toBe('CURRENT');
    expect(agingBucketFor(1)).toBe('D1_30');
    expect(agingBucketFor(30)).toBe('D1_30');
    expect(agingBucketFor(31)).toBe('D31_60');
    expect(agingBucketFor(180)).toBe('D91_180');
    expect(agingBucketFor(181)).toBe('D180_PLUS');
  });
});

describe('PAR thresholds are cumulative', () => {
  it('includes a 200-day loan in every threshold', () => {
    const days = 200;
    const included = PAR_THRESHOLDS.filter(threshold => days >= threshold);
    expect(included).toEqual([1, 7, 30, 60, 90, 180]);
  });

  it('includes a 45-day loan in PAR1, PAR7 and PAR30 only', () => {
    const days = 45;
    expect(PAR_THRESHOLDS.filter(t => days >= t)).toEqual([1, 7, 30]);
  });
});

describe('CurrencyBook never blends currencies', () => {
  it('keeps two denominations apart', () => {
    const book = new CurrencyBook(['outstanding'] as const);
    book.add('USD', 'outstanding', 570720).count('USD');
    book.add('ZWG', 'outstanding', 4350).count('ZWG');

    const rows = book.toRows();
    expect(rows).toEqual([
      { currency: 'USD', count: 1, outstanding: 570720 },
      { currency: 'ZWG', count: 1, outstanding: 4350 },
    ]);
    // The figure the old reports produced.
    expect(rows.map(r => r.outstanding)).not.toContain(575070);
  });

  it('returns nothing at all when no records were counted', () => {
    const book = new CurrencyBook(['outstanding'] as const);
    expect(book.isEmpty()).toBe(true);
    expect(book.toRows()).toEqual([]);
  });

  it('rounds the total once rather than each addition', () => {
    const book = new CurrencyBook(['amount'] as const);
    for (let i = 0; i < 3; i++) book.add('USD', 'amount', '0.005');
    // Three additions of half a cent: 0.015, which rounds to 0.02 - not to
    // 0.00 as rounding each one first would give.
    expect(book.toRows()[0]!.amount).toBe(0.02);
  });

  it('counts records separately from amounts', () => {
    const book = new CurrencyBook(['amount'] as const);
    book.add('USD', 'amount', 100).count('USD');
    book.add('USD', 'amount', 50).count('USD');
    expect(book.countOf('USD')).toBe(2);
    expect(book.get('USD', 'amount').toNumber()).toBe(150);
  });
});

describe('percentOf', () => {
  it('is zero when there is no portfolio to measure against', () => {
    expect(percentOf(new Prisma.Decimal(500), new Prisma.Decimal(0))).toBe(0);
  });

  it('does not produce Infinity for a negative whole', () => {
    expect(percentOf(new Prisma.Decimal(500), new Prisma.Decimal(-100))).toBe(0);
  });

  it('reports a share to two places', () => {
    expect(percentOf(new Prisma.Decimal(1), new Prisma.Decimal(3))).toBe(33.33);
  });
});

describe('checkReconciliation', () => {
  it('passes when the two routes to a figure agree', () => {
    const check = checkReconciliation('a = b', 'USD', 1200.5, 1200.5);
    expect(check.ok).toBe(true);
    expect(check.difference).toBe(0);
  });

  it('allows a cent of rounding slack', () => {
    expect(checkReconciliation('a = b', 'USD', 100, 100.01).ok).toBe(true);
  });

  it('fails, and says by how much, when they do not', () => {
    const check = checkReconciliation('a = b', 'USD', 100, 130);
    expect(check.ok).toBe(false);
    expect(check.difference).toBe(30);
  });
});
