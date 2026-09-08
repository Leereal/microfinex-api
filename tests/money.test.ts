import { Prisma } from '@prisma/client';
import {
  toMoney,
  roundMoney,
  isSettled,
  isOutstanding,
  atLeastZero,
  minMoney,
  sumMoney,
} from '../src/utils/money';

const D = (v: string | number) => new Prisma.Decimal(v);

describe('money utilities', () => {
  describe('toMoney', () => {
    it('treats absent values as zero', () => {
      expect(toMoney(null).toString()).toBe('0');
      expect(toMoney(undefined).toString()).toBe('0');
    });

    it('preserves precision that a float would lose', () => {
      // 0.1 + 0.2 === 0.30000000000000004 in binary floating point.
      const sum = toMoney('0.1').add(toMoney('0.2'));
      expect(sum.toString()).toBe('0.3');
      expect(sum.equals(D('0.3'))).toBe(true);
    });
  });

  describe('roundMoney', () => {
    it('rounds half away from zero to two places', () => {
      expect(roundMoney(D('10.005')).toFixed(2)).toBe('10.01');
      expect(roundMoney(D('10.004')).toFixed(2)).toBe('10.00');
    });
  });

  describe('isSettled', () => {
    it('treats sub-cent residue as settled', () => {
      // This is the case that previously left loans permanently open:
      // an exact === 0 check fails on accumulated rounding residue.
      expect(isSettled(D('0.0000000001'))).toBe(true);
      expect(isSettled(D('0'))).toBe(true);
      expect(isSettled(D('-0.001'))).toBe(true);
    });

    it('does not treat a real balance as settled', () => {
      expect(isSettled(D('0.01'))).toBe(false);
      expect(isSettled(D('100'))).toBe(false);
    });
  });

  describe('isOutstanding', () => {
    it('is the inverse of settled for positive balances', () => {
      expect(isOutstanding(D('0.01'))).toBe(true);
      expect(isOutstanding(D('0.0001'))).toBe(false);
      expect(isOutstanding(D('0'))).toBe(false);
    });
  });

  describe('atLeastZero', () => {
    it('clamps negative balances', () => {
      expect(atLeastZero(D('-5')).toString()).toBe('0');
      expect(atLeastZero(D('5')).toString()).toBe('5');
    });
  });

  describe('minMoney / sumMoney', () => {
    it('selects the smaller amount', () => {
      expect(minMoney(D('10'), D('4')).toString()).toBe('4');
      expect(minMoney(D('3'), D('9')).toString()).toBe('3');
    });

    it('sums without drift over many additions', () => {
      const cents = Array.from({ length: 1000 }, () => D('0.01'));
      expect(sumMoney(cents).toFixed(2)).toBe('10.00');
    });
  });
});
