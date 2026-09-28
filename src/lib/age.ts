import type { Division } from './types';

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

/**
 * Division uses the birth-year method most California youth leagues follow
 * (the same convention US Soccer adopted in 2016): a player's "soccer age"
 * for a season is (season year − birth year), where the season year rolls
 * over on Aug 1. That age is then bucketed into the nearest standard
 * division. This is a reasonable default, not a league-confirmed rule —
 * swap the cutoff/buckets here if Tuli's actual league uses a different one.
 */
export function calcDivision(dob: string): Division | null {
  if (!dob) return null;
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
