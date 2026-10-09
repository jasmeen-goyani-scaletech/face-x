'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Persists state to localStorage under `key`, hydrating from any saved value
 * on mount. SSR-safe: renders `initialValue` until the client-side hydration
 * effect runs, since localStorage doesn't exist on the server.
 */
export function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T | ((prev: T) => T)) => void, boolean] {
  const [value, setValue] = useState<T>(initialValue);
  const [hydrated, setHydrated] = useState(false);
  const initialRef = useRef(initialValue);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw != null) setValue(JSON.parse(raw) as T);
    } catch {
      // Corrupt or inaccessible storage (private browsing, quota): fall back to initial value.
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (prev: T) => T)(prev) : next;
        try {
          window.localStorage.setItem(key, JSON.stringify(resolved));
        } catch {
          // Storage full or blocked: state still updates in memory for this session.
        }
        return resolved;
      });
    },
    [key]
  );

  return [hydrated ? value : initialRef.current, set, hydrated];
}

export function clearLocalStorage(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}
