'use client';

import { useEffect, useState } from 'react';
import { readLocalOwner } from './localCopy';

/**
 * Which registration pathway the visitor is on, so the header logo can take them back to it instead of
 * the landing / role-picker screens. The role is remembered once a registration exists (draft or
 * submitted) and is forgotten automatically if that registration is cleared.
 */
export type RegistrationRole = 'player' | 'coach' | 'staff';

export const ACTIVE_ROLE_KEY = 'facex-active-role';

const REGISTRATION_KEYS: Record<RegistrationRole, string> = {
  player: 'facex-player-registration',
  coach: 'facex-coach-registration',
  staff: 'facex-staff-registration'
};
const ROLES = Object.keys(REGISTRATION_KEYS) as RegistrationRole[];

/**
 * A player's registration lives on the server, not in this browser, so `facex-player-registration` is no longer written.
 * This flag only remembers that the player pathway is under way, so the header logo can lead back to it. It is a
 * convenience, never the source of truth.
 */
export const PLAYER_STARTED_KEY = 'facex-player-started';

export function setPlayerStarted(started: boolean) {
  try {
    if (started) window.localStorage.setItem(PLAYER_STARTED_KEY, '1');
    else window.localStorage.removeItem(PLAYER_STARTED_KEY);
  } catch {
    // Storage blocked: the logo just falls back to the landing page.
  }
}

function isStarted(role: RegistrationRole): boolean {
  // Only an account's own copies count (see localCopy.ts).
  if (!readLocalOwner()) return false;
  try {
    if (role === 'player') return window.localStorage.getItem(PLAYER_STARTED_KEY) === '1';
    const raw = window.localStorage.getItem(REGISTRATION_KEYS[role]);
    if (!raw) return false;
    const status = (JSON.parse(raw) as { status?: string }).status;
    return status === 'draft' || status === 'submitted';
  } catch {
    return false;
  }
}

export function setActiveRole(role: RegistrationRole) {
  try {
    window.localStorage.setItem(ACTIVE_ROLE_KEY, role);
  } catch {
    // Storage blocked: the logo just falls back to the landing page.
  }
}

/** The remembered role, provided its registration still exists; otherwise the only started one, else null. */
export function readActiveRole(): RegistrationRole | null {
  try {
    const stored = window.localStorage.getItem(ACTIVE_ROLE_KEY) as RegistrationRole | null;
    if (stored && ROLES.includes(stored) && isStarted(stored)) return stored;
  } catch {
    // fall through to the derived answer
  }
  const started = ROLES.filter(isStarted);
  return started.length === 1 ? started[0] : null;
}

/** Where the header logo should go: the role's registration page once one is started, else the landing page. */
export function logoHrefFor(role: RegistrationRole | null): string {
  return role ? `/register/${role}` : '/';
}

/** Header logo target. Renders `/` on the server and first paint, then switches once storage can be read. */
export function useLogoHref(): string {
  const [role, setRole] = useState<RegistrationRole | null>(null);
  useEffect(() => {
    setRole(readActiveRole());
    const onStorage = () => setRole(readActiveRole());
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  return logoHrefFor(role);
}

/** Call from a registration wizard: remembers `role` as soon as its registration is a draft or submitted. */
export function useRememberActiveRole(role: RegistrationRole, status: string, hydrated: boolean) {
  useEffect(() => {
    if (hydrated && (status === 'draft' || status === 'submitted')) setActiveRole(role);
  }, [role, status, hydrated]);
}
