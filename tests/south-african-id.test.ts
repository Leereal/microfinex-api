import {
  enrichFromSouthAfricanId,
  isSouthAfricanContext,
  parseSouthAfricanId,
  southAfricanIdCheckDigit,
  type SouthAfricanIdEnrichable,
} from '../src/utils/south-african-id';

/** An extracted record with everything blank, for the enrichment tests. */
function blankRecord(
  overrides: Partial<SouthAfricanIdEnrichable> = {}
): SouthAfricanIdEnrichable {
  return {
    gender: null,
    date_of_birth: null,
    nationality: null,
    country: null,
    passport_country: null,
    national_id: null,
    id_number: null,
    id_type: null,
    ...overrides,
  };
}

/** Build a valid ID from its parts, computing the Luhn check digit. */
function buildId(
  yymmdd: string,
  genderSequence: string,
  citizenship = '0',
  raceDigit = '8'
): string {
  const first12 = `${yymmdd}${genderSequence}${citizenship}${raceDigit}`;
  return `${first12}${southAfricanIdCheckDigit(first12)}`;
}

describe('parseSouthAfricanId', () => {
  describe('gender', () => {
    it('reads a male ID (sequence 5000-9999)', () => {
      // Widely published sample number: born 1980-01-01, male, citizen.
      const result = parseSouthAfricanId('8001015009087');

      expect(result).not.toBeNull();
      expect(result!.gender).toBe('male');
      expect(result!.dateOfBirth).toBe('1980-01-01');
      expect(result!.citizenship).toBe('citizen');
    });

    it('reads a female ID (sequence 0000-4999)', () => {
      const id = buildId('900215', '0824');
      const result = parseSouthAfricanId(id);

      expect(result).not.toBeNull();
      expect(result!.gender).toBe('female');
      expect(result!.dateOfBirth).toBe('1990-02-15');
    });

    it('treats 4999 as female and 5000 as male at the boundary', () => {
      expect(parseSouthAfricanId(buildId('880707', '4999'))!.gender).toBe(
        'female'
      );
      expect(parseSouthAfricanId(buildId('880707', '5000'))!.gender).toBe(
        'male'
      );
    });
  });

  describe('citizenship', () => {
    it.each([
      ['0', 'citizen'],
      ['1', 'permanent_resident'],
      ['2', 'refugee'],
    ])('maps digit %s to %s', (digit, expected) => {
      const result = parseSouthAfricanId(buildId('950320', '5123', digit));
      expect(result!.citizenship).toBe(expected);
    });

    it('rejects an unknown citizenship digit', () => {
      const first12 = '9503205123' + '5' + '8';
      const id = `${first12}${southAfricanIdCheckDigit(first12)}`;
      expect(parseSouthAfricanId(id)).toBeNull();
    });
  });

  describe('date of birth', () => {
    it('assumes the previous century when the date would be in the future', () => {
      // 99 cannot mean 2099, so it must be 1999.
      const result = parseSouthAfricanId(buildId('991231', '5001'));
      expect(result!.dateOfBirth).toBe('1999-12-31');
    });

    it('accepts a leap day', () => {
      const result = parseSouthAfricanId(buildId('000229', '5001'));
      expect(result!.dateOfBirth).toBe('2000-02-29');
    });

    it('rejects an impossible date', () => {
      // 1997 was not a leap year.
      const first12 = '970229' + '5001' + '0' + '8';
      const id = `${first12}${southAfricanIdCheckDigit(first12)}`;
      expect(parseSouthAfricanId(id)).toBeNull();
    });

    it('rejects an impossible month', () => {
      const first12 = '901320' + '5001' + '0' + '8';
      const id = `${first12}${southAfricanIdCheckDigit(first12)}`;
      expect(parseSouthAfricanId(id)).toBeNull();
    });
  });

  describe('formatting tolerance', () => {
    it('ignores spaces and dashes', () => {
      expect(parseSouthAfricanId('800101 5009 08 7')!.gender).toBe('male');
      expect(parseSouthAfricanId('800101-5009-087')!.gender).toBe('male');
    });
  });

  describe('rejection', () => {
    it('rejects a wrong check digit', () => {
      // Flip the check digit of a known-good number.
      expect(parseSouthAfricanId('8001015009088')).toBeNull();
    });

    it('rejects an adjacent transposition, which is what the checksum is for', () => {
      // 8001015009087 with the "10" at positions 4-5 swapped to "01".
      expect(parseSouthAfricanId('8000115009087')).toBeNull();
    });

    it('does not catch a 09 <-> 90 swap, a known Luhn blind spot', () => {
      // Luhn detects every adjacent transposition except 09 <-> 90, so this
      // one slips through. Documented so the gap is a known limit of the
      // checksum rather than a surprise: treat a parsed ID as strong evidence,
      // not proof.
      expect(parseSouthAfricanId('8001015090087')).not.toBeNull();
    });

    it.each([
      ['empty', ''],
      ['null', null],
      ['undefined', undefined],
      ['too short', '800101500908'],
      ['too long', '80010150090877'],
      ['a Zimbabwean ID', '63-1234567 X 42'],
      ['letters only', 'not-an-id'],
    ])('rejects %s', (_label, value) => {
      expect(parseSouthAfricanId(value as string)).toBeNull();
    });
  });

  describe('southAfricanIdCheckDigit', () => {
    it('reproduces the check digit of a known number', () => {
      expect(southAfricanIdCheckDigit('800101500908')).toBe(7);
    });

    it('throws when not given exactly 12 digits', () => {
      expect(() => southAfricanIdCheckDigit('12345')).toThrow();
    });
  });
});

describe('enrichFromSouthAfricanId', () => {
  const MALE_ID = '8001015009087'; // born 1980-01-01, male, citizen

  it('derives gender when the document did not state it', () => {
    const record = blankRecord({
      national_id: MALE_ID,
      nationality: 'South African',
    });

    enrichFromSouthAfricanId(record);

    expect(record.gender).toBe('male');
  });

  it('derives the date of birth when missing', () => {
    const record = blankRecord({
      national_id: MALE_ID,
      nationality: 'South African',
    });

    enrichFromSouthAfricanId(record);

    expect(record.date_of_birth).toBe('1980-01-01');
  });

  it('reads the number from id_number when national_id is empty', () => {
    const record = blankRecord({ id_number: MALE_ID });

    enrichFromSouthAfricanId(record);

    expect(record.gender).toBe('male');
    expect(record.id_type).toBe('national_id');
  });

  it('never overwrites a gender the document actually stated', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const record = blankRecord({
      national_id: MALE_ID,
      gender: 'female',
    });

    enrichFromSouthAfricanId(record);

    expect(record.gender).toBe('female');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('never overwrites a date of birth the document stated', () => {
    const record = blankRecord({
      national_id: MALE_ID,
      date_of_birth: '1979-12-31',
    });

    enrichFromSouthAfricanId(record);

    expect(record.date_of_birth).toBe('1979-12-31');
  });

  it('does nothing when the document says another country', () => {
    const record = blankRecord({
      national_id: MALE_ID,
      nationality: 'Zimbabwean',
    });

    enrichFromSouthAfricanId(record);

    expect(record.gender).toBeNull();
    expect(record.date_of_birth).toBeNull();
  });

  it('does nothing when the ID number is not a valid SA ID', () => {
    const record = blankRecord({ national_id: '63-1234567 X 42' });

    enrichFromSouthAfricanId(record);

    expect(record.gender).toBeNull();
  });

  it('infers nationality only for citizens', () => {
    const citizen = blankRecord({ national_id: MALE_ID });
    enrichFromSouthAfricanId(citizen);
    expect(citizen.nationality).toBe('South African');

    // Same number shape but citizenship digit 1 (permanent resident).
    const first12 = '800101500918';
    const residentId = `${first12}${southAfricanIdCheckDigit(first12)}`;
    const resident = blankRecord({ national_id: residentId });
    enrichFromSouthAfricanId(resident);
    expect(resident.nationality).toBeNull();
    expect(resident.gender).toBe('male');
  });
});

describe('isSouthAfricanContext', () => {
  it.each([
    ['South African', true],
    ['south africa', true],
    ['South-Africa', true],
    ['RSA', true],
    ['ZA', true],
    ['Zimbabwean', false],
    ['Botswana', false],
  ])('treats nationality %s as %s', (nationality, expected) => {
    expect(
      isSouthAfricanContext({
        nationality,
        country: null,
        passport_country: null,
      })
    ).toBe(expected);
  });

  it('allows an unknown nationality, leaving the decision to the checksum', () => {
    expect(
      isSouthAfricanContext({
        nationality: null,
        country: null,
        passport_country: null,
      })
    ).toBe(true);
  });

  it('accepts when any one field says South Africa', () => {
    expect(
      isSouthAfricanContext({
        nationality: null,
        country: 'South Africa',
        passport_country: null,
      })
    ).toBe(true);
  });
});
