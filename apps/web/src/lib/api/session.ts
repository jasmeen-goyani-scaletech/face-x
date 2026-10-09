import { adoptLocalOwner, clearLocalCopies } from '../localCopy';
import { API_BASE_URL } from './config';
import type { ApiSuccessBody, ApiUser, SessionResponse } from './types';

/**
 * The signed-in session, held in memory only.
 *
 *  - The 15-minute access token lives in a module variable: it is never written to localStorage / sessionStorage.
 *  - The refresh token lives in an HttpOnly cookie the browser manages; JavaScript can't read it.
 *  - Refresh tokens ROTATE, and the API revokes the whole session if an already-rotated token is presented again. So
 *    two refreshes must never run at once with the same cookie, in this tab or across tabs:
 *      · in one tab, concurrent callers share a single in-flight request;
 *      · across tabs, the Web Locks API serialises refreshes, and the tab that refreshed broadcasts the new token so the
 *        tabs waiting on the lock use it instead of replaying the old cookie.
 */

/** Refresh this long before the token expires, so a request never leaves with a token about to die. */
const SKEW_MS = 30_000;
const LOCK_NAME = 'facex-auth-refresh';
const CHANNEL_NAME = 'facex-auth';

interface Session {
  accessToken: string;
  expiresAtMs: number;
  user: ApiUser;
  /** When this session was stored locally (used to spot a refresh done by another tab while we waited). */
  storedAtMs: number;
}

type BroadcastMessage =
  | { type: 'session'; accessToken: string; expiresAtMs: number; user: ApiUser }
  | { type: 'signed-out' };

let session: Session | null = null;
let refreshInFlight: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

const channel: BroadcastChannel | null = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME);

function notify() {
  listeners.forEach((l) => l());
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSessionUser(): ApiUser | null {
  return session?.user ?? null;
}

/** The current token if it is still good for a while; otherwise null (the caller should refresh). */
export function getFreshAccessToken(): string | null {
  return session && session.expiresAtMs - Date.now() > SKEW_MS ? session.accessToken : null;
}

/** Any token we hold, even a stale one (a 401 retry decides whether it is dead). */
export function hasSession(): boolean {
  return session !== null;
}

function store(accessToken: string, expiresAtMs: number, user: ApiUser) {
  adoptLocalOwner(user.id);
  session = { accessToken, expiresAtMs, user, storedAtMs: Date.now() };
  notify();
}

/** Called with the body of a successful login or refresh. */
export function setSession(data: SessionResponse, broadcast = true) {
  const expiresAtMs = Date.now() + data.expiresIn * 1000;
  store(data.accessToken, expiresAtMs, data.user);
  if (broadcast) channel?.postMessage({ type: 'session', accessToken: data.accessToken, expiresAtMs, user: data.user } satisfies BroadcastMessage);
}

/** Keeps the signed-in user's roles current after the API changes them (e.g. the account picks PARENT). */
export function setSessionRoles(roles: ApiUser['roles']) {
  if (!session) return;
  session = { ...session, user: { ...session.user, roles } };
  notify();
}

/** Forgets the session here (and in other tabs). It does not call the API: logout() does that. */
export function clearSession(broadcast = true) {
  const had = session !== null;
  session = null;
  clearLocalCopies();
  if (had) notify();
  if (broadcast) channel?.postMessage({ type: 'signed-out' } satisfies BroadcastMessage);
}

if (channel) {
  channel.onmessage = (event: MessageEvent<BroadcastMessage>) => {
    const msg = event.data;
    if (msg.type === 'session') store(msg.accessToken, msg.expiresAtMs, msg.user);
    else if (msg.type === 'signed-out') clearSession(false);
  };
}

async function callRefresh(): Promise<boolean> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/auth/refresh`, { method: 'POST', credentials: 'include', headers: { Accept: 'application/json' } });
  } catch {
    return false; // offline / server down: keep whatever we have, the caller reports the failure
  }
  if (res.ok) {
    const body = (await res.json().catch(() => null)) as ApiSuccessBody<SessionResponse> | null;
    if (body?.success) {
      setSession(body.data);
      return true;
    }
    return false;
  }
  if (res.status === 401 || res.status === 403) {
    // The refresh token is missing, expired or revoked: this browser is signed out.
    clearSession();
  }
  return false;
}

/**
 * Gets a fresh access token using the refresh cookie. Resolves true when a usable session exists afterwards.
 * Safe to call from anywhere, any number of times: concurrent calls share one request.
 */
export function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    const startedAt = Date.now();
    const run = async (): Promise<boolean> => {
      // Another tab may have refreshed while we waited for the lock: use its token, don't replay the old cookie.
      if (session && session.storedAtMs >= startedAt && getFreshAccessToken()) return true;
      return callRefresh();
    };
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
    const attempt: Promise<boolean> = locks ? (locks.request(LOCK_NAME, run) as Promise<unknown>).then((r) => r === true) : run();
    const shared: Promise<boolean> = attempt.finally(() => {
      refreshInFlight = null;
    });
    refreshInFlight = shared;
    return shared;
  }
  return refreshInFlight;
}
