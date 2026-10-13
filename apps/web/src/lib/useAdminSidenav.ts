'use client';

import { useCallback, useEffect, useState } from 'react';

const KEY = 'facex-admin-sidenav';
const DESKTOP_QUERY = '(min-width: 1280px)';

function readPref(): 'collapsed' | 'expanded' | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'collapsed' || v === 'expanded' ? v : null;
  } catch {
    return null;
  }
}

/**
 * Collapsed/expanded state for the admin side navigation. Until the user toggles it, it follows the viewport: icon-only
 * rail below 1280px (iPad and smaller), full sidebar from 1280px up. Once toggled, the choice is saved and wins.
 */
export function useAdminSidenav() {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const pref = readPref();
    setCollapsed(pref ? pref === 'collapsed' : !mq.matches);
    const onChange = () => {
      if (!readPref()) setCollapsed(!mq.matches);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const toggle = useCallback(() => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      window.localStorage.setItem(KEY, next ? 'collapsed' : 'expanded');
    } catch {
      // ignore
    }
  }, [collapsed]);

  return { collapsed, toggle };
}
