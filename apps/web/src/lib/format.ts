// Locale is pinned to 'en-US' (not `undefined`) deliberately: the Node.js server process and
// the browser can resolve `undefined` to different default locales, which produces different
// formatted strings for the same Date and triggers a React hydration mismatch. Pinning it keeps
// server- and client-rendered text identical, which also fits the target market (California, USA).
const LOCALE = 'en-US';

export function formatDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(LOCALE, { month: 'long', day: 'numeric', year: 'numeric' });
}

export function formatTime(ts: number | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit' });
}

/** How someone was checked in; and, while that is only saved on this device and not yet acknowledged by the server, that it is waiting to sync. */
export function checkInVia(e: { checkedInMethod: string | null; pendingSync?: boolean }): string {
  return `${e.checkedInMethod ?? ''}${e.pendingSync ? ' · saved on this device, waiting to sync' : ''}`;
}

export function formatDateTime(ts: number | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${d.toLocaleDateString(LOCALE, { month: 'short', day: 'numeric' })}, ${formatTime(ts)}`;
}

/**
 * When something happened, for the event-day screens. Today: just the time ("3:03 PM"), which is what a door needs. Any other
 * day: the date too ("Oct 8, 4:41 PM", and the year when it is not this year), so a check-in from another day can never be
 * mistaken for one from today. Display only: nothing here changes a stored timestamp.
 */
export function formatWhen(ts: number | null, now: number = Date.now()): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const n = new Date(now);
  if (d.toDateString() === n.toDateString()) return formatTime(ts);
  const date = d.toLocaleDateString(LOCALE, d.getFullYear() === n.getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
  return `${date}, ${formatTime(ts)}`;
}

/** The complete date and time with seconds ("Thu, Oct 8, 2026, 4:41:05 PM"), for tooltips and audit-style detail. */
export function formatFullDateTime(ts: number | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString(LOCALE, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

export function initialsOf(first: string, last: string): string {
  return ((first || '').charAt(0) + (last || '').charAt(0)).toUpperCase() || '?';
}

const AVATAR_VARS = ['--primary', '--info', '--gold', '--primary-strong', '--success'];
export function avatarVar(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_VARS[h % AVATAR_VARS.length];
}

export function genId(prefix: string): string {
  return `${prefix}-${Math.floor(1000 + Math.random() * 9000)}`;
}

/** An instant shown as the event's own local date and time (e.g. "Nov 14, 2026, 5:30 PM"), whatever the viewer's time zone. */
export function formatEventStart(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return d.toLocaleString(LOCALE, { timeZone, month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return d.toLocaleString(LOCALE, { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
}

/** The calendar date of an instant in the event's own time zone (e.g. "November 14, 2026"): 5:30 PM Pacific is still the 14th. */
export function formatEventDate(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return d.toLocaleDateString(LOCALE, { timeZone, month: 'long', day: 'numeric', year: 'numeric' });
  } catch {
    return d.toLocaleDateString(LOCALE, { month: 'long', day: 'numeric', year: 'numeric' });
  }
}
