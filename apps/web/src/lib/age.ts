import type { Division } from './types';

export const MIN_PLAYER_AGE = 4;
export const MAX_PLAYER_AGE = 100;

/** Exact age in years as of today, for display and the "is a minor" consent check. */
export function calcAge(dob: string): number | null {
  if (!dob) return null;
  const birth = new Date(dob + 'T00:00:00');
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

function toInputDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Today minus `years`, local time; Feb 29 clamps to Feb 28 in non-leap years. */
function yearsAgo(years: number): string {
  const now = new Date();
  const y = now.getFullYear() - years;
  const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
  return toInputDate(new Date(y, now.getMonth(), Math.min(now.getDate(), lastDay)));
}

/** `min`/`max` for the DOB `<input type="date">` — latest = just turned MIN age today. */
export function dobBounds(): { min: string; max: string } {
  return { min: yearsAgo(MAX_PLAYER_AGE), max: yearsAgo(MIN_PLAYER_AGE) };
}

export const INVALID_DOB_MESSAGE = 'Please select a valid past date of birth.';

/**
 * What a typed or picked date of birth amounts to:
 *  - empty:   nothing chosen yet;
 *  - invalid: not a real date, in the future, or older than any plausible player (MAX_PLAYER_AGE);
 *  - ok:      a real past date, with the exact age in whole years (birthday not yet reached this year counts one less).
 * "ok" includes players younger than the minimum age: that is a registration rule (see dobError), not a bad date.
 */
export type DobAge = { state: 'empty' } | { state: 'invalid' } | { state: 'ok'; age: number };

export function dobAge(dob: string): DobAge {
  if (!dob) return { state: 'empty' };
  const birth = new Date(dob + 'T00:00:00');
  if (Number.isNaN(birth.getTime()) || birth.getTime() > Date.now()) return { state: 'invalid' };
  const age = calcAge(dob);
  if (age === null || age > MAX_PLAYER_AGE) return { state: 'invalid' };
  return { state: 'ok', age };
}

/** Error message for a DOB string, or null if it is empty or eligible. Empty is handled by "Required". */
export function dobError(dob: string): string | null {
  const result = dobAge(dob);
  if (result.state === 'invalid') return INVALID_DOB_MESSAGE;
  if (result.state === 'ok' && result.age < MIN_PLAYER_AGE) return `Player must be at least ${MIN_PLAYER_AGE} years old to register.`;
  return null;
}

/**
 * Division uses the birth-year method most California youth leagues follow
 * (the same convention US Soccer adopted in 2016): a player's "soccer age"
 * for a season is (season year − birth year), where the season year rolls
 * over on Aug 1. That age is then bucketed into the nearest standard
 * division. This is a reasonable default, not a league-confirmed rule —
 * swap the cutoff/buckets here if Tuli's actual league uses a different one.
 */
export function calcDivision(dob: string): Division | null {
  if (!dob || dobError(dob)) return null;
  const birth = new Date(dob + 'T00:00:00');
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  const seasonYear = today.getMonth() >= 7 ? today.getFullYear() + 1 : today.getFullYear();
  const soccerAge = seasonYear - birth.getFullYear();
  if (soccerAge <= 10) return 'U10';
  if (soccerAge <= 12) return 'U12';
  if (soccerAge <= 14) return 'U14';
  if (soccerAge <= 16) return 'U16';
  return 'U18';
}
