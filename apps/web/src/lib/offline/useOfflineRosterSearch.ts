'use client';

import { useEffect, useMemo, useState } from 'react';
import type { RosterEntry } from '../seed';
import { ROSTER_CACHED_EVENT, searchRosterIds } from './rosterCache';

const norm = (s: string | undefined) => (s ?? '').toLowerCase();

/**
 * Live roster search backed by the IndexedDB cache, so it keeps working with no network. Results are the live `roster`
 * entries (current check-in status) filtered to the ids the cache matched. Until the first answer arrives, or if
 * IndexedDB is unavailable, it filters `roster` in memory so the list never flashes empty.
 */
export function useOfflineRosterSearch(query: string, roster: RosterEntry[]): RosterEntry[] {
  const [ids, setIds] = useState<Set<string> | null>(null);
  const [cacheVersion, setCacheVersion] = useState(0);

  useEffect(() => {
    const bump = () => setCacheVersion((v) => v + 1);
    window.addEventListener(ROSTER_CACHED_EVENT, bump);
    return () => window.removeEventListener(ROSTER_CACHED_EVENT, bump);
  }, []);

  useEffect(() => {
    let cancelled = false;
    searchRosterIds(query).then((found) => {
      if (!cancelled) setIds(found);
    });
    return () => {
      cancelled = true;
    };
  }, [query, cacheVersion]);

  return useMemo(() => {
    if (ids) return roster.filter((r) => ids.has(r.id));
    const q = norm(query).trim();
    if (!q) return roster;
    return roster.filter((r) => [`${r.firstName} ${r.lastName}`, r.email, r.id, r.schoolId, r.teamName].some((f) => norm(f).includes(q)));
  }, [ids, roster, query]);
}
