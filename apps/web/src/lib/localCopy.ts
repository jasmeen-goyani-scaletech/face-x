/**
 * The browser keeps small COPIES of server data so the home screen and header know where a person left off (the coach / staff
 * registration status, which pathway is active). They are conveniences, never the source of truth, and they belong to one
 * account: on a shared device the next person must not see the last person's name or status.
 *
 * So the copies are tied to the signed-in user: they are cleared when that user signs out (or the session ends), and when a
 * different user signs in.
 */
const COPY_KEYS = ['facex-coach-registration', 'facex-staff-registration', 'facex-active-role', 'facex-player-started'];
const SESSION_COPY_KEYS = ['facex-player-unsaved', 'facex-admin-event'];
const OWNER_KEY = 'facex-local-owner';

function safe(fn: () => void) {
  try {
    fn();
  } catch {
    // Storage blocked (private mode): there is nothing stored to protect.
  }
}

export function clearLocalCopies() {
  if (typeof window === 'undefined') return;
  safe(() => COPY_KEYS.forEach((k) => window.localStorage.removeItem(k)));
  safe(() => window.localStorage.removeItem(OWNER_KEY));
  safe(() => SESSION_COPY_KEYS.forEach((k) => window.sessionStorage.removeItem(k)));
}

/** Called when a session starts: copies left by a different account are removed, and the copies are claimed for this one. */
export function adoptLocalOwner(userId: string) {
  if (typeof window === 'undefined') return;
  safe(() => {
    const owner = window.localStorage.getItem(OWNER_KEY);
    if (owner !== userId) {
      if (owner !== null || COPY_KEYS.some((k) => window.localStorage.getItem(k) !== null)) clearLocalCopies();
      window.localStorage.setItem(OWNER_KEY, userId);
    }
  });
}

/** Whose copies these are (null when none were claimed: a leftover from before copies were tied to an account). */
export function readLocalOwner(): string | null {
  try {
    return window.localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
}
