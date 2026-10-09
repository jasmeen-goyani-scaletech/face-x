'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import * as authApi from '@/lib/api/auth';
import { detachPushFromThisDevice } from '@/lib/push';
import { getSessionUser, refreshSession, subscribeSession } from '@/lib/api/session';
import type { ApiUser } from '@/lib/api/types';

/**
 * `loading`   we don't know yet whether a session exists (restoring from the refresh cookie)
 * `idle`      nothing has asked yet; no request has been made
 * `signedOut` no session
 * `signedIn`  `user` is set
 */
export type AuthStatus = 'idle' | 'loading' | 'signedOut' | 'signedIn';

interface AuthContextValue {
  status: AuthStatus;
  user: ApiUser | null;
  /** Looks for an existing session (via the refresh cookie) once. Cheap to call again; resolves to whether one exists. */
  restore: () => Promise<boolean>;
  login: (email: string, password: string) => Promise<ApiUser>;
  /** Creates the account, then signs in. */
  signup: (input: { email: string; password: string; fullName?: string }) => Promise<ApiUser>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const subscribe = subscribeSession;
const getSnapshot = getSessionUser;
const getServerSnapshot = () => null;

/**
 * Exposes the in-memory session (lib/api/session) to React. It never reaches for the API on its own: a page that needs a
 * signed-in user mounts <RequireAuth>, which calls restore(). Public pages therefore make no auth requests.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const user = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [restoreState, setRestoreState] = useState<'idle' | 'loading' | 'done'>('idle');
  const restoring = useRef<Promise<boolean> | null>(null);

  const restore = useCallback(async () => {
    if (getSessionUser()) return true;
    if (!restoring.current) {
      setRestoreState('loading');
      restoring.current = refreshSession().finally(() => {
        restoring.current = null;
        setRestoreState('done');
      });
    }
    return restoring.current;
  }, []);

  const login = useCallback((email: string, password: string) => authApi.login({ email, password }), []);

  const signup = useCallback(async (input: { email: string; password: string; fullName?: string }) => {
    await authApi.register(input);
    return authApi.login({ email: input.email, password: input.password });
  }, []);

  const logout = useCallback(async () => {
    await detachPushFromThisDevice(); // while the session can still authorize removing this device's subscription
    await authApi.logout();
  }, []);

  const status: AuthStatus = user ? 'signedIn' : restoreState === 'loading' ? 'loading' : restoreState === 'done' ? 'signedOut' : 'idle';

  const value = useMemo<AuthContextValue>(() => ({ status, user, restore, login, signup, logout }), [status, user, restore, login, signup, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
