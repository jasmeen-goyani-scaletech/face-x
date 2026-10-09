/**
 * The admin's tournament form speaks in a calendar date and clock times; the API stores instants (with the event's own time
 * zone kept beside them). These helpers convert between the two without a date library.
 */

export const EVENT_TIME_ZONES: { value: string; label: string }[] = [
  { value: 'America/Los_Angeles', label: 'Pacific (Los Angeles)' },
  { value: 'America/Denver', label: 'Mountain (Denver)' },
  { value: 'America/Phoenix', label: 'Arizona (Phoenix)' },
  { value: 'America/Chicago', label: 'Central (Chicago)' },
  { value: 'America/New_York', label: 'Eastern (New York)' },
  { value: 'America/Anchorage', label: 'Alaska (Anchorage)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (Honolulu)' }
];

export const DEFAULT_EVENT_TIME_ZONE = 'America/Los_Angeles';

/** A zone's offset from UTC at an instant, in minutes (positive east of Greenwich). */
function offsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** The instant at which the wall clock in `timeZone` reads `date` (`YYYY-MM-DD`) `time` (`HH:mm`), as an ISO string. */
export function zonedToIso(date: string, time: string, timeZone: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  // The offset depends on the instant, which depends on the offset: two passes settle it (also across a daylight-saving change).
  let instant = wall - offsetMinutes(new Date(wall), timeZone) * 60000;
  instant = wall - offsetMinutes(new Date(instant), timeZone) * 60000;
  return new Date(instant).toISOString();
}

/** The calendar date (`YYYY-MM-DD`) and clock time (`HH:mm`) an instant shows on the wall in `timeZone`. */
export function isoToZoned(iso: string, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

/** "5:30 PM – 8:00 PM" for an event's start and end, on its own clock. */
export function formatEventTimes(startsAt: string, endsAt: string, timeZone: string): string {
  const fmt = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });
  return `${fmt(startsAt)} – ${fmt(endsAt)}`;
}

/** US dollars as the form types them ("95", "95.50") to whole cents, or null when it is not a valid amount. */
export function dollarsToCents(input: string): number | null {
  const v = input.trim();
  if (v === '') return 0;
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(v)) return null;
  return Math.round(Number(v) * 100);
}

export const centsToDollars = (cents: number): string => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2));
