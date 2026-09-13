import { Prisma } from '@prisma/client';
import { toMoney, roundMoney, moneyToNumber, type Money } from '../../utils/money';

/**
 * Totals that cannot accidentally add two currencies together.
 *
 * Every report in this system had the same defect in a different place: a
 * `reduce` over loans that summed `outstandingBalance` regardless of
 * denomination, so a book holding USD 570,720 and ZiG 4,350 reported a single
 * figure of 575,070 - a number that is not true in any currency and that nobody
 * can act on.
 *
 * The fix is structural rather than careful: there is no method here that
 * returns one number across currencies. Adding requires naming the currency, so
 * the mistake is not available to make. Arithmetic is Prisma's Decimal
 * throughout; accumulating money in JavaScript floats drifts by a cent per few
 * thousand additions, which is exactly enough for a report to stop reconciling
 * with the rows beneath it.
 */

/** One measure, held per currency. */
export class CurrencyBook<Field extends string> {
  private readonly totals = new Map<string, Map<Field, Money>>();
  private readonly counts = new Map<string, number>();

  constructor(private readonly fields: readonly Field[]) {}

  private bucket(currency: string): Map<Field, Money> {
    let bucket = this.totals.get(currency);
    if (!bucket) {
      bucket = new Map<Field, Money>();
      for (const field of this.fields) {
        bucket.set(field, new Prisma.Decimal(0));
      }
      this.totals.set(currency, bucket);
      this.counts.set(currency, 0);
    }
    return bucket;
  }

  /** Add to one measure of one currency. */
  add(
    currency: string,
    field: Field,
    value: Money | number | string | null | undefined
  ): this {
    const bucket = this.bucket(currency);
    bucket.set(field, bucket.get(field)!.add(toMoney(value)));
    return this;
  }

  /** Add to several measures of one currency at once. */
  addMany(
    currency: string,
    values: Partial<Record<Field, Money | number | string | null | undefined>>
  ): this {
    for (const [field, value] of Object.entries(values)) {
      this.add(currency, field as Field, value as Money | number);
    }
    return this;
  }

  /** Count a record against a currency, separately from its amounts. */
  count(currency: string, by = 1): this {
    this.bucket(currency);
    this.counts.set(currency, (this.counts.get(currency) ?? 0) + by);
    return this;
  }

  /** One measure of one currency, as a Decimal. */
  get(currency: string, field: Field): Money {
    return this.totals.get(currency)?.get(field) ?? new Prisma.Decimal(0);
  }

  countOf(currency: string): number {
    return this.counts.get(currency) ?? 0;
  }

  currencies(): string[] {
    return [...this.totals.keys()].sort();
  }

  isEmpty(): boolean {
    return this.totals.size === 0;
  }

  /**
   * The book as plain rows, one per currency, rounded to the cent.
   *
   * Rounding happens once here rather than on each addition, so a total is the
   * rounded sum rather than a sum of rounded parts - the two differ, and the
   * second is what makes a summary disagree with its own detail rows.
   */
  toRows(): Array<{ currency: string; count: number } & Record<Field, number>> {
    return this.currencies().map(currency => {
      const row: Record<string, number | string> = {
        currency,
        count: this.countOf(currency),
      };
      for (const field of this.fields) {
        row[field] = moneyToNumber(roundMoney(this.get(currency, field)));
      }
      return row as { currency: string; count: number } & Record<Field, number>;
    });
  }
}

/**
 * The same measures, held per currency *and* per grouping key.
 *
 * For "by branch", "by product", "by officer" and the rest: each group keeps
 * its own currency split, because a branch lending in two currencies has two
 * totals and no single one.
 */
export class GroupedCurrencyBook<Field extends string> {
  private readonly groups = new Map<
    string,
    { label: string; book: CurrencyBook<Field> }
  >();

  constructor(private readonly fields: readonly Field[]) {}

  private group(key: string, label: string): CurrencyBook<Field> {
    let group = this.groups.get(key);
    if (!group) {
      group = { label, book: new CurrencyBook<Field>(this.fields) };
      this.groups.set(key, group);
    }
    return group.book;
  }

  add(
    key: string,
    label: string,
    currency: string,
    values: Partial<Record<Field, Money | number | string | null | undefined>>,
    count = 1
  ): this {
    const book = this.group(key, label);
    book.addMany(currency, values);
    book.count(currency, count);
    return this;
  }

  /** Groups as rows, each carrying its own per-currency totals. */
  toRows(): Array<{
    key: string;
    label: string;
    byCurrency: Array<{ currency: string; count: number } & Record<Field, number>>;
  }> {
    return [...this.groups.entries()]
      .map(([key, group]) => ({
        key,
        label: group.label,
        byCurrency: group.book.toRows(),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }
}

/** Percentage of `part` in `whole`, to two places; 0 when there is no whole. */
export function percentOf(part: Money, whole: Money): number {
  if (whole.isZero() || whole.isNegative()) return 0;
  return Number(part.div(whole).mul(100).toDecimalPlaces(2));
}

export { toMoney, roundMoney, moneyToNumber };
export type { Money };
