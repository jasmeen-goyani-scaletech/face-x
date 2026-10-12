'use client';

import { useMemo } from 'react';
import type { RosterEntry } from '../seed';

/**
 * The text a person is searched by: name, email, registration id and number, team. Lower-cased once per roster, not on every keystroke.
 */
const searchKey = (r: RosterEntry) => [`${r.firstName} ${r.lastName}`, r.email, r.id, r.schoolId, r.teamName].join('\n').toLowerCase();

/**
 * Searches the roster on this device. The roster on screen IS the device's copy (read from the server and saved, or, with no
 * connection, read back from what was saved), so searching it needs no request and works offline; and it is instant even for a
 * roster of thousands, which scanning the database on every keystroke was not. A substring match (so "smith" finds "John Smith");
 * an empty query matches everyone. Results are the live entries, so their check-in state is always current.
 */
export function useOfflineRosterSearch(query: string, roster: RosterEntry[]): RosterEntry[] {
  const keys = useMemo(() => roster.map(searchKey), [roster]);
  return useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return roster;
    return roster.filter((_, i) => keys[i]!.includes(q));
  }, [query, roster, keys]);
}
