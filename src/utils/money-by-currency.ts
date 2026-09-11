/**
 * Totals that never lose their currency.
 *
 * Companion to `money.ts`, which is about precision within one currency. This
 * file is about the other half of the problem: every total in this system is
 * denominated, and adding USD to ZiG produces a number with no meaning.
 * $570,720 + ZiG 4,350 is not $575,070, and a dashboard that shows it is
 * quietly misleading whoever is deciding from it.
 *
 * There is no organization-wide base currency here and no rate is applied at
 * read time, so a single scalar total is never the right answer. The shapes
 * below are how an amount should leave the API: a list of per-currency
 * figures. Counts are different - a loan is a loan regardless of denomination -
 * so those stay plain numbers.
 */

export interface MoneyAmount {
  currency: string;
  amount: number;
}

/** A per-currency total with the number of records behind it. */
export interface MoneyTotal extends MoneyAmount {
  count: number;
}

/** Prisma groupBy rows, whose sums arrive as Decimal. */
interface GroupedRow {
  currency?: string | null;
  _sum?: Record<string, unknown>;
  _count?: number | Record<string, number>;
}

const toNumber = (value: unknown): number =>
  value === null || value === undefined ? 0 : Number(value);

const countOf = (row: GroupedRow): number =>
  typeof row._count === 'number' ? row._count : 0;

/**
 * Turn a `groupBy(['currency'])` result into per-currency totals.
 * `field` is the summed column, e.g. 'amount' or 'outstandingBalance'.
 */
export function toMoneyTotals(
  rows: GroupedRow[],
  field: string,
  fallbackCurrency = 'USD'
): MoneyTotal[] {
  return rows
    .map(row => ({
      currency: row.currency || fallbackCurrency,
      amount: toNumber(row._sum?.[field]),
      count: countOf(row),
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

/**
 * Combine several per-currency series into one row per currency.
 *
 * For a screen showing disbursed, outstanding and collected side by side: each
 * currency gets one row carrying all three, and a currency present in any
 * series appears with zeros for the rest rather than being dropped.
 */
export function combineByCurrency<K extends string>(
  series: Record<K, MoneyTotal[]>
): Array<{ currency: string } & Record<K, MoneyTotal>> {
  const keys = Object.keys(series) as K[];
  const currencies = new Set<string>();

  for (const key of keys) {
    for (const total of series[key]) currencies.add(total.currency);
  }

  return Array.from(currencies)
    .sort((a, b) => a.localeCompare(b))
    .map(currency => {
      // Built as a plain record then asserted once: indexing a mapped type by
      // a generic key is not something TypeScript can narrow per assignment.
      const row: Record<string, unknown> = { currency };
      for (const key of keys) {
        row[key] = series[key].find(total => total.currency === currency) ?? {
          currency,
          amount: 0,
          count: 0,
        };
      }
      return row as { currency: string } & Record<K, MoneyTotal>;
    });
}

/**
 * Subtract one per-currency series from another, currency by currency.
 * Used for net positions - income less expenses, cash in less cash out.
 */
export function netByCurrency(
  positive: MoneyTotal[],
  negative: MoneyTotal[]
): MoneyAmount[] {
  const currencies = new Set([
    ...positive.map(total => total.currency),
    ...negative.map(total => total.currency),
  ]);

  return Array.from(currencies)
    .sort((a, b) => a.localeCompare(b))
    .map(currency => ({
      currency,
      amount:
        (positive.find(total => total.currency === currency)?.amount ?? 0) -
        (negative.find(total => total.currency === currency)?.amount ?? 0),
    }));
}

/**
 * Group rows carrying both a key and a currency into per-key, per-currency
 * totals - one query for every key instead of one query per key.
 */
export function groupByKeyAndCurrency<T extends string>(
  rows: Array<GroupedRow & Record<string, unknown>>,
  keyField: string,
  sumField: string
): Map<T, MoneyTotal[]> {
  const grouped = new Map<T, MoneyTotal[]>();

  for (const row of rows) {
    const key = String(row[keyField] ?? '') as T;
    const totals = grouped.get(key) ?? [];
    totals.push({
      currency: row.currency || 'USD',
      amount: toNumber(row._sum?.[sumField]),
      count: countOf(row),
    });
    grouped.set(key, totals);
  }

  for (const totals of grouped.values()) {
    totals.sort((a, b) => a.currency.localeCompare(b.currency));
  }

  return grouped;
}

/** Total records across every currency. Counts add; amounts do not. */
export function countAcross(totals: MoneyTotal[]): number {
  return totals.reduce((sum, total) => sum + total.count, 0);
}
