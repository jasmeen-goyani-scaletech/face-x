'use client';

import { useEffect, useState } from 'react';
import type { DocumentSubjectType } from './documentVerification';

/**
 * Admin audit log: who did what to whose registration, and when. There is no backend, so it is kept in this browser's
 * localStorage (newest 500 events). A server would persist the same shape. Registrant-side moments (submitted, uploaded,
 * signed, paid) are not stored here; they come from the timestamps already on the registration (see adminAudit.ts).
 */
export type AdminEventKind =
  | 'document_approved'
  | 'document_rejected'
  | 'access_enabled'
  | 'access_disabled'
  | 'registration_approved'
  | 'registration_rejected';

export interface AdminEvent {
  id: string;
  at: number;
  subjectType: DocumentSubjectType;
  /** The same id the registration's documents are reviewed under (`reg.id ?? entry.id`, or the roster id for sample records). */
  subjectId: string;
  kind: AdminEventKind;
  documentId?: string;
  /** Rejection reason, when there is one. */
  detail?: string;
  adminId: string;
}

const KEY = 'facex-admin-events';
const CHANGED = 'facex-admin-events-changed';
const MAX_EVENTS = 500;

function readAll(): AdminEvent[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as AdminEvent[]) : [];
  } catch {
    return [];
  }
}

export function logAdminEvent(event: Omit<AdminEvent, 'id' | 'at'>) {
  try {
    const all = readAll();
    all.push({ ...event, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, at: Date.now() });
    window.localStorage.setItem(KEY, JSON.stringify(all.slice(-MAX_EVENTS)));
    window.dispatchEvent(new Event(CHANGED));
  } catch {
    // Storage unavailable: the action itself still goes ahead; it just isn't recorded.
  }
}

export function clearAdminEvents() {
  try {
    window.localStorage.removeItem(KEY);
    window.dispatchEvent(new Event(CHANGED));
  } catch {
    // ignore
  }
}

/** Events for one person, kept in sync when something is logged (in this tab or another). Empty until mounted. */
export function useAdminEvents(subjectType: DocumentSubjectType, subjectId: string): AdminEvent[] {
  const [events, setEvents] = useState<AdminEvent[]>([]);
  useEffect(() => {
    const load = () => setEvents(readAll().filter((e) => e.subjectType === subjectType && e.subjectId === subjectId));
    load();
    window.addEventListener(CHANGED, load);
    window.addEventListener('storage', load);
    return () => {
      window.removeEventListener(CHANGED, load);
      window.removeEventListener('storage', load);
    };
  }, [subjectType, subjectId]);
  return events;
}
