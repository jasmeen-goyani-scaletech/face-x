/**
 * Pure business rules (no I/O), so they are unit-tested directly.
 *
 * ADULT_AGE: the frontend treats a player under 18 as a minor (guardian consent required). 18 is the
 * assumption used here; it is not league-confirmed.
 */
export const ADULT_AGE = 18;

/** The calendar day (`YYYY-MM-DD`) an instant falls on in an IANA time zone. Falls back to UTC for an unknown zone. */
export function localDateInTimeZone(instant: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(instant);
  } catch {
    return instant.toISOString().slice(0, 10);
  }
}

/** Whole years between two `YYYY-MM-DD` dates (birthday not yet reached = one year less). */
export function ageOn(dateOfBirth: string, onDate: string): number {
  const [by, bm, bd] = dateOfBirth.split('-').map(Number) as [number, number, number];
  const [ay, am, ad] = onDate.split('-').map(Number) as [number, number, number];
  let age = ay - by;
  if (am < bm || (am === bm && ad < bd)) age -= 1;
  return age;
}

/** Minor on the event's local start date, using the event's own time zone (never the server's). */
export function isMinorForEvent(
  dateOfBirth: string,
  eventStartsAt: Date,
  eventTimeZone: string,
): boolean {
  return ageOn(dateOfBirth, localDateInTimeZone(eventStartsAt, eventTimeZone)) < ADULT_AGE;
}
