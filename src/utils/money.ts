import { Prisma } from '@prisma/client';

/**
 * Money utilities.
 *
 * All monetary values in this system are stored as PostgreSQL NUMERIC(15,2)
 * and surfaced by Prisma as Decimal. Never perform monetary arithmetic with
 * JavaScript numbers: binary floating point cannot represent values such as
 * 0.1 exactly, so repeated add/subtract cycles accumulate residue. That
 * residue makes exact comparisons (`balance === 0`) fail and can leave a
 * fully repaid loan permanently open.
 *
 * Use these helpers to convert at the boundary and compare with tolerance.
 */

const Decimal = Prisma.Decimal;
export type Money = Prisma.Decimal;

/** Number of decimal places money is stored with (matches @db.Decimal(15, 2)). */
export const MONEY_SCALE = 2;

/**
 * Smallest amount we treat as non-zero. Anything strictly below half a cent is
 * rounding residue, not money owed.
 */
const EPSILON = new Decimal('0.005');

/**
 * Coerce any supported numeric representation into a Decimal.
 * `null`/`undefined` become zero so callers can treat absent balances as nil.
 */
export function toMoney(
  value: Prisma.Decimal | number | string | null | undefined
): Money {
  if (value === null || value === undefined) {
    return new Decimal(0);
  }
  if (value instanceof Decimal) {
    return value;
  }
  return new Decimal(value);
}

/** Round to the storable scale, half-up (the convention lenders expect). */
export function roundMoney(value: Money): Money {
  return value.toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP);
}

/**
 * True when the value is zero for accounting purposes.
 * Use this instead of `=== 0` on any balance.
 */
export function isSettled(value: Money): boolean {
  return value.abs().lt(EPSILON);
}

/** True when a positive balance remains outstanding. */
export function isOutstanding(value: Money): boolean {
  return value.gt(EPSILON);
}

/** Clamp negatives to zero — balances must never go below nil. */
export function atLeastZero(value: Money): Money {
  return value.lt(0) ? new Decimal(0) : value;
}

/** The smaller of two amounts. */
export function minMoney(a: Money, b: Money): Money {
  return a.lt(b) ? a : b;
}

/** Sum a list of amounts. */
export function sumMoney(values: Money[]): Money {
  return values.reduce((acc, v) => acc.add(v), new Decimal(0));
}

/**
 * Convert to a plain number for transport across the API boundary only.
 * Never feed the result back into further monetary arithmetic.
 */
export function moneyToNumber(value: Money | null | undefined): number {
  return toMoney(value).toNumber();
}
