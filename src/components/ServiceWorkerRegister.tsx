'use client';

import { useEffect } from 'react';

export default function ServiceWorkerRegister() {
  useEffect(() => {
    // Registered in production only: in dev, the cache-first fetch strategy silently serves
    // stale JS chunks after every code change, which is confusing during local development and
    // has no upside there (there's nothing worth caching offline until it's actually deployed).
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Offline support degrades gracefully if registration fails (e.g. unsupported browser).
      });
    }
  }, []);
  return null;
}
