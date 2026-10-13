import type { CompareTo, FieldSpec } from './fields';
import type { ExtractedFieldDto, FieldMatch } from './types';

/** What a document is compared with. Dates are YYYY-MM-DD. */
export interface ProfileOnRecord {
  firstName: string;
  lastName: string;
  /** Players only. */
  dateOfBirth: string | null;
  /** The event's start date in the event's own time zone. */
  eventDate: string;
}

/** Lower case, accents removed: "Mateo" and "MATÉO" read the same. */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** The letters and digits of each part of a name; hyphens, apostrophes, dots and spaces only separate parts. */
const nameParts = (s: string) =>
  fold(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** Levenshtein distance: single-letter insertions, deletions and substitutions. */
function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j]! + 1,
        row[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length]!;
}

/**
 * Letters that may differ for a CLOSE result: one per six letters of the name on record, so names under six letters must
 * match exactly ("Tia" is not "Tai") while a one-letter misread of a long name ("MATTIALONA-HOWE") is CLOSE, not MISMATCH.
 */
const allowedEdits = (onRecord: string) => Math.floor(onRecord.length / 6);

const closeTo = (read: string, onRecord: string) =>
  editDistance(read, onRecord) <= allowedEdits(onRecord);

/**
 * MATCH: the same name, ignoring case, accents and how the parts are joined ("Mateialona-Howe" = "MATEIALONA HOWE").
 * CLOSE: off by a letter or so, typically a misread of small or typed print; the reviewer checks it by eye.
 */
export function nameMatch(read: string, onRecord: string): FieldMatch {
  const x = nameParts(read).join('');
  const y = nameParts(onRecord).join('');
  if (x === '' || y === '') return 'MISMATCH';
  if (x === y) return 'MATCH';
  return closeTo(x, y) ? 'CLOSE' : 'MISMATCH';
}

/**
 * Every part of the profile's first and last name appears in the printed full name, in any order (it may add middle
 * names): MATCH. Every part appears or has a CLOSE counterpart: CLOSE. A part with neither: MISMATCH.
 */
export function fullNameMatch(printed: string, first: string, last: string): FieldMatch {
  const have = nameParts(printed);
  const need = [...nameParts(first), ...nameParts(last)];
  if (need.length === 0) return 'MISMATCH';
  let result: FieldMatch = 'MATCH';
  for (const part of need) {
    if (have.includes(part)) continue;
    if (!have.some((h) => closeTo(h, part))) return 'MISMATCH';
    result = 'CLOSE';
  }
  return result;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const iso = (y: number, m: number, d: number): string | null => {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d)
    return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

/**
 * The model is asked for YYYY-MM-DD, but a printed date sometimes comes back as printed. Also accepted: US-style
 * M/D/YYYY (these are US documents) and "29 Aug 2011" / "August 29, 2011". Anything else is null (not a date).
 */
export function parseDate(value: string): string | null {
  const v = value.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  if (m) return iso(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
  if (m) return iso(+m[3]!, +m[1]!, +m[2]!);
  m = /^(\d{1,2})\s+([A-Za-z]+)\.?,?\s+(\d{4})$/.exec(v);
  if (m) {
    const month = MONTHS.indexOf(m[2]!.slice(0, 3).toLowerCase());
    return month < 0 ? null : iso(+m[3]!, month + 1, +m[1]!);
  }
  m = /^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(v);
  if (m) {
    const month = MONTHS.indexOf(m[1]!.slice(0, 3).toLowerCase());
    return month < 0 ? null : iso(+m[3]!, month + 1, +m[2]!);
  }
  return null;
}

/** Whole years from `birth` to `on` (both YYYY-MM-DD). */
export function ageOn(birth: string, on: string): number {
  const [by, bm, bd] = birth.split('-').map(Number) as [number, number, number];
  const [y, m, d] = on.split('-').map(Number) as [number, number, number];
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

function compare(compareTo: CompareTo, value: string, profile: ProfileOnRecord): FieldMatch {
  switch (compareTo) {
    case 'firstName':
      return nameMatch(value, profile.firstName);
    case 'lastName':
      return nameMatch(value, profile.lastName);
    case 'fullName':
      return fullNameMatch(value, profile.firstName, profile.lastName);
    case 'dateOfBirth':
      // Nothing on record to compare (a coach or staff member): the value is shown, not judged.
      if (!profile.dateOfBirth) return 'NOT_FOUND';
      return value === profile.dateOfBirth ? 'MATCH' : 'MISMATCH';
    case 'notExpired':
      // ISO dates compare correctly as strings.
      return value >= profile.eventDate ? 'MATCH' : 'MISMATCH';
  }
}

/**
 * Normalizes each extracted value (trimmed; dates to YYYY-MM-DD where they parse) and checks it against the profile.
 * `match` is null for a field that is only reported (e.g. issuer), NOT_FOUND when the document did not give a usable value.
 */
export function compareWithProfile(
  specs: readonly FieldSpec[],
  raw: Record<string, string | null>,
  profile: ProfileOnRecord,
): { fields: Record<string, ExtractedFieldDto>; derived: { age?: number } } {
  const fields: Record<string, ExtractedFieldDto> = {};
  for (const spec of specs) {
    const trimmed = raw[spec.key]?.trim() || null;
    const parsedDate = spec.kind === 'date' && trimmed ? parseDate(trimmed) : null;
    const value = spec.kind === 'date' ? (parsedDate ?? trimmed) : trimmed;
    // A date that does not parse cannot be compared: it is shown as read, but not judged.
    const usable = spec.kind === 'date' ? parsedDate : trimmed;
    const match: FieldMatch | null = !spec.compareTo
      ? null
      : usable === null
        ? 'NOT_FOUND'
        : compare(spec.compareTo, usable, profile);
    fields[spec.key] = { value, match };
  }
  const dob = fields.dateOfBirth?.value ? parseDate(fields.dateOfBirth.value) : null;
  return { fields, derived: dob ? { age: ageOn(dob, profile.eventDate) } : {} };
}
