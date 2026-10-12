import { isApiError } from './errors';
import { getSessionUser } from './session';

/** How long an admin list is reused as it is. Short, so another admin's change shows up soon; own changes invalidate it at once. */
const FRESH_MS = 30_000;
/** An expired answer is kept this long, only to stand in when the server can't be reached for the refresh. */
const STALE_OK_MS = 10 * 60_000;

interface Entry {
  at: number;
  has: boolean;
  value?: unknown;
  pending?: Promise<unknown>;
}

const entries = new Map<string, Entry>();
let owner: string | null = null;
let version = 0;

/** No connection, a timeout, or a struggling server: the kind of failure where showing the last good answer beats showing an error. */
const isTransient = (e: unknown) => isApiError(e) && (e.status === 0 || e.status === 408 || e.status === 429 || e.status >= 500);

/**
 * Shares a read between screens: callers asking for the same `key` at the same time get one request, and an answer younger
 * than FRESH_MS is reused instead of asked for again. A failed refresh never throws away a good answer: when the server can't
 * be reached the last one is returned (and asked for again next time); any other failure (signed out, no permission) is
 * raised. The cache belongs to the signed-in user and is dropped when another account signs in.
 */
export function cachedRead<T>(key: string, load: () => Promise<T>): Promise<T> {
  const who = getSessionUser()?.id ?? null;
  if (who !== owner) {
    entries.clear();
    owner = who;
  }
  const hit = entries.get(key);
  if (hit?.pending) return hit.pending as Promise<T>;
  if (hit?.has && Date.now() - hit.at < FRESH_MS) return Promise.resolve(hit.value as T);
  const stale = hit?.has && Date.now() - hit.at < STALE_OK_MS ? hit : undefined;

  const startedAt = version;
  const pending = load().then(
    (value) => {
      // A change made while this was in flight means the answer may already be out of date: hand it over, but don't keep it.
      if (version === startedAt) entries.set(key, { at: Date.now(), has: true, value });
      else entries.delete(key);
      return value;
    },
    (e: unknown) => {
      if (stale && version === startedAt && isTransient(e)) {
        entries.set(key, stale);
        return stale.value as T;
      }
      entries.delete(key);
      throw e;
    }
  );
  entries.set(key, { at: stale?.at ?? 0, has: false, pending });
  return pending;
}

/** Forgets every cached read whose key starts with `prefix`; call after something that changes what it returned. */
export function invalidateReads(prefix: string) {
  version += 1;
  for (const key of [...entries.keys()]) if (key.startsWith(prefix)) entries.delete(key);
}
