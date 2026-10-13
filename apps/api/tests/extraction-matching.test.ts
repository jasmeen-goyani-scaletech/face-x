import { describe, expect, it } from 'vitest';
import { ageOn, fullNameMatch, nameMatch, parseDate } from '../src/modules/extraction/matching';

describe('comparing extracted values', () => {
  it('compares names ignoring case, accents and how parts are joined', () => {
    expect(nameMatch('MATEIALONA HOWE', 'Mateialona-Howe')).toBe('MATCH');
    expect(nameMatch('José', 'JOSE')).toBe('MATCH');
    expect(nameMatch("O'Neil", 'ONEIL')).toBe('MATCH');
    expect(nameMatch('Howe', 'Mateialona-Howe')).toBe('MISMATCH');
    expect(nameMatch('', '')).toBe('MISMATCH');
  });

  it('calls a one-letter misread of a long name CLOSE, but never of a short one', () => {
    // Both misreads the live model made of the typed birth certificate.
    expect(nameMatch('MATTIALONA-HOWE', 'Mateialona-Howe')).toBe('CLOSE');
    expect(nameMatch('MATRIALONA-HOWE', 'Mateialona-Howe')).toBe('CLOSE');
    expect(nameMatch('Tia', 'Tai')).toBe('MISMATCH');
    expect(nameMatch('Rivers', 'Rivera')).toBe('CLOSE');
    expect(nameMatch('Riviere', 'Rivera')).toBe('MISMATCH');
    expect(nameMatch('Smith', 'Smyth')).toBe('MISMATCH');
  });

  it('accepts a full name that contains every part of the profile name, in any order', () => {
    expect(fullNameMatch('MATEIALONA-HOWE, TAI LANI', 'Tai', 'Mateialona-Howe')).toBe('MATCH');
    expect(fullNameMatch('TAI MATTHEW MATTIALONA-HOWE', 'Tai', 'Mateialona-Howe')).toBe('CLOSE');
    expect(fullNameMatch('Tai Howe', 'Tai', 'Mateialona-Howe')).toBe('MISMATCH');
    expect(fullNameMatch('Tia Mateialona-Howe', 'Tai', 'Mateialona-Howe')).toBe('MISMATCH');
  });

  it('parses the date formats a model may echo, and rejects impossible dates', () => {
    expect(parseDate('2011-08-29')).toBe('2011-08-29');
    expect(parseDate('8/29/2011')).toBe('2011-08-29');
    expect(parseDate('29 Aug 2011')).toBe('2011-08-29');
    expect(parseDate('August 29, 2011')).toBe('2011-08-29');
    for (const bad of ['2011-02-30', '13/01/2011', 'Smarch 1, 2011', 'yesterday', '2011'])
      expect(parseDate(bad), bad).toBeNull();
  });

  it('computes whole years of age at a date', () => {
    expect(ageOn('2011-08-29', '2026-08-28')).toBe(14);
    expect(ageOn('2011-08-29', '2026-08-29')).toBe(15);
    expect(ageOn('2012-02-29', '2026-03-01')).toBe(14);
  });
});
