/**
 * South African ID number parsing.
 *
 * A South African ID number is 13 digits laid out as YYMMDDSSSSCAZ:
 *
 *   1-6   YYMMDD  date of birth
 *   7-10  SSSS    gender sequence: 0000-4999 female, 5000-9999 male
 *   11    C       citizenship: 0 = citizen, 1 = permanent resident, 2 = refugee
 *   12    A       formerly race classification, obsolete since 1991 (now 8 or 9)
 *   13    Z       Luhn check digit
 *
 * Reference: https://www.saidchecker.co.za/guides/sa-id-number-explained
 *
 * This lets us recover a client's gender and date of birth from the ID number
 * alone when OCR fails to read the printed "Sex" / "Date of Birth" fields,
 * which is common on worn cards and low-resolution phone photos.
 */

export interface SouthAfricanIdInfo {
  /** Normalised 13-digit number. */
  idNumber: string;
  gender: 'male' | 'female';
  /** Date of birth as YYYY-MM-DD. */
  dateOfBirth: string;
  citizenship: 'citizen' | 'permanent_resident' | 'refugee';
}

/**
 * Luhn checksum, as used for the 13th digit of a South African ID.
 * Returns true when the number (including its check digit) is self-consistent.
 */
function passesLuhn(digits: string): boolean {
  let sum = 0;
  let double = false;

  // Walk right to left, doubling every second digit.
  for (let i = digits.length - 1; i >= 0; i--) {
    let value = digits.charCodeAt(i) - 48;

    if (double) {
      value *= 2;
      if (value > 9) {
        value -= 9;
      }
    }

    sum += value;
    double = !double;
  }

  return sum % 10 === 0;
}

/**
 * Resolve the two-digit year to a full year.
 *
 * The ID number carries no century, so we assume the person is alive: a
 * two-digit year that would place the birth date in the future must belong to
 * the previous century. This mis-reads people aged over ~100, which is not a
 * realistic case for a lending client.
 */
function resolveYear(twoDigitYear: number, month: number, day: number): number {
  const candidate = 2000 + twoDigitYear;
  const now = new Date();
  const asDate = new Date(Date.UTC(candidate, month - 1, day));

  return asDate.getTime() > now.getTime() ? 1900 + twoDigitYear : candidate;
}

/** True when year/month/day describe a real calendar date. */
function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * Parse a South African ID number, returning null when the value is not a
 * valid one. Validation is deliberately strict — a real date, a known
 * citizenship digit and a correct Luhn check digit — so that a 13-digit
 * number from another country is very unlikely to be misread as South African.
 */
export function parseSouthAfricanId(
  raw: string | null | undefined
): SouthAfricanIdInfo | null {
  if (!raw) {
    return null;
  }

  // IDs are often written with spaces or dashes.
  const digits = String(raw).replace(/\D/g, '');

  if (digits.length !== 13) {
    return null;
  }

  const year = Number(digits.slice(0, 2));
  const month = Number(digits.slice(2, 4));
  const day = Number(digits.slice(4, 6));

  const fullYear = resolveYear(year, month, day);
  if (!isRealDate(fullYear, month, day)) {
    return null;
  }

  const citizenshipDigit = digits[10];
  const citizenship =
    citizenshipDigit === '0'
      ? 'citizen'
      : citizenshipDigit === '1'
        ? 'permanent_resident'
        : citizenshipDigit === '2'
          ? 'refugee'
          : null;

  if (!citizenship) {
    return null;
  }

  if (!passesLuhn(digits)) {
    return null;
  }

  // Digit 7 alone decides gender: 0-4 female, 5-9 male.
  const gender = Number(digits[6]) >= 5 ? 'male' : 'female';

  const pad = (value: number) => String(value).padStart(2, '0');

  return {
    idNumber: digits,
    gender,
    dateOfBirth: `${fullYear}-${pad(month)}-${pad(day)}`,
    citizenship,
  };
}

/** The subset of extracted client fields this enrichment reads and writes. */
export interface SouthAfricanIdEnrichable {
  gender: string | null;
  date_of_birth: string | null;
  nationality: string | null;
  country: string | null;
  passport_country: string | null;
  national_id: string | null;
  id_number: string | null;
  id_type: string | null;
}

/**
 * Whether an extracted record looks South African.
 *
 * True when a field says so, and also when nationality/country are simply
 * absent — there the strict ID validation (real date, known citizenship digit,
 * Luhn check) carries the decision alone. False only when the document
 * positively indicates another country.
 */
export function isSouthAfricanContext(
  data: Pick<
    SouthAfricanIdEnrichable,
    'nationality' | 'country' | 'passport_country'
  >
): boolean {
  const stated = [
    data.nationality,
    data.country,
    data.passport_country,
  ].filter((value): value is string => !!value && value.trim() !== '');

  if (stated.length === 0) {
    return true;
  }

  return stated.some(value =>
    /south[\s-]?africa|^\s*(rsa|za|zaf)\s*$/i.test(value.trim())
  );
}

/**
 * Fill in gender, date of birth and nationality from a South African ID
 * number when the document itself did not yield them.
 *
 * Only fills blanks — a value the model actually read off the document is
 * never overwritten, so a genuine discrepancy stays visible to the officer
 * rather than being silently "corrected". Mutates and returns `data`.
 */
export function enrichFromSouthAfricanId<T extends SouthAfricanIdEnrichable>(
  data: T
): T {
  // Nothing to gain if both derivable fields are already populated.
  if (data.gender && data.date_of_birth) {
    return data;
  }

  if (!isSouthAfricanContext(data)) {
    return data;
  }

  // The number may land in either field depending on the document.
  const candidates = [data.national_id, data.id_number].filter(
    (value): value is string => !!value
  );

  for (const candidate of candidates) {
    const parsed = parseSouthAfricanId(candidate);
    if (!parsed) {
      continue;
    }

    if (!data.gender) {
      data.gender = parsed.gender;
    } else if (data.gender !== parsed.gender) {
      console.warn(
        `[ai] Document states gender "${data.gender}" but the South African ` +
          `ID number implies "${parsed.gender}". Keeping the document value.`
      );
    }

    if (!data.date_of_birth) {
      data.date_of_birth = parsed.dateOfBirth;
    }

    // A valid, checksum-verified SA ID is itself evidence of nationality.
    if (!data.nationality && parsed.citizenship === 'citizen') {
      data.nationality = 'South African';
    }

    if (!data.id_type) {
      data.id_type = 'national_id';
    }

    return data;
  }

  return data;
}

/**
 * Compute the Luhn check digit for the first 12 digits of an ID number.
 * Exposed for tests and for generating sample data.
 */
export function southAfricanIdCheckDigit(first12Digits: string): number {
  if (!/^\d{12}$/.test(first12Digits)) {
    throw new Error('Expected exactly 12 digits');
  }

  for (let candidate = 0; candidate <= 9; candidate++) {
    if (passesLuhn(`${first12Digits}${candidate}`)) {
      return candidate;
    }
  }

  // Unreachable: exactly one candidate always satisfies the checksum.
  throw new Error('No valid check digit found');
}
