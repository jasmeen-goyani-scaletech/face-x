import { API_BASE_URL } from './config';
import { ApiError } from './errors';
import { clearSession, getFreshAccessToken, hasSession, refreshSession } from './session';
import type { ApiErrorBody, ApiSuccessBody } from './types';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Serialised as JSON. */
  body?: unknown;
  /** Sent as the whole request body, with the image's own content type (the face scan). Instead of `body`. */
  image?: Blob;
  /** Query string values; `undefined` entries are dropped. */
  query?: Record<string, string | undefined>;
  /** false for the few endpoints that need no signed-in user (login, register). Default true. */
  auth?: boolean;
  signal?: AbortSignal;
}

function url(path: string, query?: RequestOptions['query']): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) qs.set(k, v);
  const s = qs.toString();
  return `${API_BASE_URL}${path}${s ? `?${s}` : ''}`;
}

/** A request that gets no answer in this long is given up on, so a screen shows its error and retry instead of loading forever. */
export const REQUEST_TIMEOUT_MS = 30_000;

async function send(path: string, opts: RequestOptions, token: string | null): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.image) headers['Content-Type'] = opts.image.type;
  else if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  // The caller's own signal (a screen going away) and the timeout both cancel the request.
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout.signal]) : timeout.signal;
  try {
    return await fetch(url(path, opts.query), {
      method: opts.method ?? 'GET',
      headers,
      body: opts.image ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
      // The refresh cookie only rides on the auth endpoints, but login/logout must be able to set and clear it.
      credentials: 'include',
      cache: 'no-store',
      signal
    });
  } catch (e) {
    if (opts.signal?.aborted) throw e; // the caller cancelled: not an error to report
    if (timeout.signal.aborted) throw new ApiError(0, 'REQUEST_TIMEOUT', 'The server took too long to answer');
    throw new ApiError(0, 'NETWORK_ERROR', 'The server could not be reached');
  } finally {
    clearTimeout(timer);
  }
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as ApiSuccessBody<T> | ApiErrorBody | null;
  if (res.ok && body && body.success) return body.data;
  if (body && body.success === false) throw new ApiError(res.status, body.error.code, body.error.message, body.error.details ?? []);
  throw new ApiError(res.status, 'UNEXPECTED_RESPONSE', `Unexpected response (${res.status})`);
}

/**
 * Calls the API and returns the `data` of its envelope, or throws an ApiError.
 *
 * Protected calls (the default) are never sent without a session: with no usable token the client first tries the
 * refresh cookie, and if that yields nothing it throws NOT_AUTHENTICATED WITHOUT making the request. A 401 on a call that
 * had a token triggers exactly one refresh and one retry; if that fails too the session is cleared and the 401 surfaces.
 */
export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  if (opts.auth === false) return parse<T>(await send(path, opts, null));

  let token = getFreshAccessToken();
  if (!token) {
    await refreshSession();
    token = getFreshAccessToken();
  }
  if (!token) throw new ApiError(401, 'NOT_AUTHENTICATED', 'Sign in to continue');

  let res = await send(path, opts, token);
  if (res.status === 401) {
    const refreshed = await refreshSession();
    const retryToken = refreshed ? getFreshAccessToken() : null;
    if (!retryToken) {
      if (hasSession()) clearSession();
      return parse<T>(res);
    }
    res = await send(path, opts, retryToken);
  }
  return parse<T>(res);
}
