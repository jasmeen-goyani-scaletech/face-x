'use client';

import { useEffect, useRef } from 'react';

/**
 * Calls `refresh` when the admin comes back to this tab after being away for `awayMs` or more, so a list left open while
 * someone else made changes catches up on return. Coming back sooner does nothing, and there is no timer: an untouched tab
 * that stays in front makes no requests at all. `refresh` should be quiet (keep what is on screen if it fails).
 */
export function useRevalidateOnFocus(refresh: () => void, awayMs = 30_000) {
  const latest = useRef(refresh);
  latest.current = refresh;

  useEffect(() => {
    let leftAt: number | null = document.visibilityState === 'hidden' ? Date.now() : null;
    const leave = () => {
      if (leftAt === null) leftAt = Date.now();
    };
    const back = () => {
      if (leftAt !== null && Date.now() - leftAt >= awayMs) latest.current();
      leftAt = null;
    };
    const onVisibility = () => (document.visibilityState === 'hidden' ? leave() : back());
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', leave);
    window.addEventListener('focus', back);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', leave);
      window.removeEventListener('focus', back);
    };
  }, [awayMs]);
}
