/**
 * The rules of offline event-day work, kept free of IndexedDB, React and the network so they can be tested on their own.
 */

/** A cached roster older than this is not used (and is replaced the next time the device is online): people's details are not kept on a device indefinitely. */
export const ROSTER_MAX_AGE_MS = 48 * 60 * 60 * 1000;

/** Whose roster, for which event: a cached roster is only ever used for exactly this pair. */
export interface RosterScope {
  eventId: string;
  ownerId: string;
}

export interface RosterMeta extends RosterScope {
  /** When the server last answered with this roster (ms epoch): the "last updated" the admin sees. */
  fetchedAt: number;
  count: number;
}

/**
 * Whether a cached roster's stamp allows it to be used now: it must be well formed, belong to THIS admin account and THIS
 * event, and not be too old or from the future (a device clock set wrong must not make an old copy look fresh).
 */
export function isUsableRosterMeta(meta: unknown, want: RosterScope, now: number): meta is RosterMeta {
  if (!meta || typeof meta !== 'object') return false;
  const m = meta as Partial<RosterMeta>;
  if (typeof m.eventId !== 'string' || typeof m.ownerId !== 'string') return false;
  if (typeof m.fetchedAt !== 'number' || !Number.isFinite(m.fetchedAt) || typeof m.count !== 'number') return false;
  if (m.eventId !== want.eventId || m.ownerId !== want.ownerId) return false;
  const age = now - m.fetchedAt;
  return age >= -5 * 60 * 1000 && age <= ROSTER_MAX_AGE_MS;
}

/** A failure that says nothing about the request itself (no connection, a timeout, a struggling server): worth another try. */
export const isTransientStatus = (status: number): boolean => status === 0 || status === 408 || status === 429 || status >= 500;

const BACKOFF_FIRST_MS = 2_000;
const BACKOFF_MAX_MS = 60_000;

/**
 * How long to wait before the next try after `failures` unsuccessful passes in a row: 2 s, 4 s, 8 s ... up to a minute, with up to
 * 20% either way so a room full of devices that lost the connection together does not come back as one wave.
 */
export function retryDelayMs(failures: number, random: () => number = Math.random): number {
  const n = Math.max(1, Math.floor(failures));
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_FIRST_MS * 2 ** (n - 1));
  return Math.round(base * (0.8 + random() * 0.4));
}

/**
 * Whether a queued check-in may be sent by the signed-in account. The server records WHO checked someone in, so a check-in made
 * by one admin must never be sent under another admin's login: it waits for its own admin to sign in again. An item queued by an
 * older build, which did not record who made it, is sent by whoever is signed in rather than being stranded.
 */
export const ownedBy = (item: { ownerId?: string }, userId: string): boolean => !item.ownerId || item.ownerId === userId;

const REFUSAL_REASONS: Record<string, string> = {
  REGISTRATION_NOT_FOUND: 'This registration was not found for this event.',
  EVENT_NOT_OPEN: 'The event is not open for check-in.',
  REGISTRATION_NOT_READY: 'The registration is not ready for the event (it is still being reviewed, or it was changed).',
  EVENT_ACCESS_DISABLED: 'Event-day access was switched off for this person.',
  PAYMENT_NOT_COMPLETED: 'Payment is not complete.',
  DOCUMENTS_NOT_APPROVED: 'Documents are not all approved.',
  PHOTO_REJECTED: 'FLAGGED: staff rejected this person’s profile photo. They must upload a new photo before checking in.',
  CONSENT_NOT_ACCEPTED: 'The consent has not been accepted.',
  FACE_PROFILE_NOT_ACTIVE: 'There is no active face profile.'
};

/**
 * Why the server refused a check-in, in the admin's words: the server's own reason codes (one or several) turned into sentences, or
 * its general message when it gave none we know. Shown next to the person so the admin knows what to put right.
 */
export function describeRefusal(message: string, details: { path: string; message: string }[] = []): string {
  const reasons = details.filter((d) => d.path === 'reason').map((d) => REFUSAL_REASONS[d.message] ?? d.message);
  return reasons.length > 0 ? reasons.join(' ') : message;
}

/** A check-in made on this device that the server has not acknowledged yet. */
export interface LocalCheckIn {
  personId: string;
  /** When it happened on this device (ms epoch). */
  checkedInAt: number;
  method: string;
  override: boolean;
}

interface Checkable {
  id: string;
  checkedInAt: number | null;
  checkedInMethod: string | null;
  checkedInOverride: boolean;
}

/**
 * Lays this device's unsent check-ins over a roster just read from the server. The server is the truth: whoever it shows as
 * checked in stays exactly as the server says (this device's attempt will then be answered "already checked in" when it is
 * sent). But someone the server does not yet show as checked in, whom THIS device has checked in, stays checked in on screen
 * until the server has the record: a read of the server must not silently undo a check-in that is still waiting to be sent,
 * or the same person would be checked in again by a second tap.
 */
export function mergePending<T extends Checkable>(roster: T[], pending: LocalCheckIn[]): T[] {
  if (pending.length === 0) return roster;
  const mine = new Map(pending.map((p) => [p.personId, p]));
  return roster.map((r) => {
    const p = mine.get(r.id);
    if (!p || r.checkedInAt) return r;
    return { ...r, checkedInAt: p.checkedInAt, checkedInMethod: p.method, checkedInOverride: p.override };
  });
}
