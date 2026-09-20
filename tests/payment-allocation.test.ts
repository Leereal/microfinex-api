import { Prisma } from '@prisma/client';
import { allocatePayment } from '../src/services/payment.service';

const D = (v: string | number) => new Prisma.Decimal(v);

describe('payment allocation waterfall', () => {
  it('settles penalties, then interest, then principal', () => {
    const result = allocatePayment(D('100'), D('20'), D('30'), D('500'));

    expect(result.penaltyAmount.toFixed(2)).toBe('20.00');
    expect(result.interestAmount.toFixed(2)).toBe('30.00');
    expect(result.principalAmount.toFixed(2)).toBe('50.00');
    expect(result.remainingAmount.toFixed(2)).toBe('0.00');
  });

  it('stops at the penalty tier when the payment is small', () => {
    const result = allocatePayment(D('15'), D('20'), D('30'), D('500'));

    expect(result.penaltyAmount.toFixed(2)).toBe('15.00');
    expect(result.interestAmount.toFixed(2)).toBe('0.00');
    expect(result.principalAmount.toFixed(2)).toBe('0.00');
    expect(result.remainingAmount.toFixed(2)).toBe('0.00');
  });

  it('skips tiers that carry no balance', () => {
    const result = allocatePayment(D('100'), D('0'), D('0'), D('500'));

    expect(result.penaltyAmount.toFixed(2)).toBe('0.00');
    expect(result.interestAmount.toFixed(2)).toBe('0.00');
    expect(result.principalAmount.toFixed(2)).toBe('100.00');
  });

  it('reports the unapplied excess when the payment exceeds the debt', () => {
    // The excess must be surfaced, not silently absorbed - the caller rejects
    // the payment rather than recording money it cannot apply.
    const result = allocatePayment(D('1000'), D('20'), D('30'), D('500'));

    expect(result.penaltyAmount.toFixed(2)).toBe('20.00');
    expect(result.interestAmount.toFixed(2)).toBe('30.00');
    expect(result.principalAmount.toFixed(2)).toBe('500.00');
    expect(result.remainingAmount.toFixed(2)).toBe('450.00');
  });

  it('settles a debt exactly, leaving nothing outstanding', () => {
    const result = allocatePayment(D('550'), D('20'), D('30'), D('500'));

    expect(result.remainingAmount.toFixed(2)).toBe('0.00');
    const applied = result.penaltyAmount
      .add(result.interestAmount)
      .add(result.principalAmount);
    expect(applied.toFixed(2)).toBe('550.00');
  });

  it('never allocates more than the payment', () => {
    const result = allocatePayment(D('33.33'), D('10'), D('10'), D('10'));
    const applied = result.penaltyAmount
      .add(result.interestAmount)
      .add(result.principalAmount);

    expect(applied.add(result.remainingAmount).toFixed(2)).toBe('33.33');
  });

  it('handles fractional cents without drift', () => {
    const result = allocatePayment(D('0.30'), D('0.10'), D('0.20'), D('100'));

    expect(result.penaltyAmount.toFixed(2)).toBe('0.10');
    expect(result.interestAmount.toFixed(2)).toBe('0.20');
    expect(result.principalAmount.toFixed(2)).toBe('0.00');
    expect(result.remainingAmount.toFixed(2)).toBe('0.00');
  });

  it('leaves everything unapplied for a fully settled loan', () => {
    const result = allocatePayment(D('50'), D('0'), D('0'), D('0'));
    expect(result.remainingAmount.toFixed(2)).toBe('50.00');
  });
});
