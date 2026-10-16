'use client';

import { useEffect } from 'react';

export default function ServiceWorkerRegister() {
  useEffect(() => {
    // Registered in production only: in dev, the cache-first fetch strategy silently serves
    // stale JS chunks after every code change, which is confusing during local development and
    // has no upside there (there's nothing worth caching offline until it's actually deployed).
    // NEXT_PUBLIC_REGISTER_SW=true turns it on in dev too, to try push notifications locally: the worker never caches /_next files
    // on localhost, so code changes still show up.
    const enabled = process.env.NODE_ENV === 'production' || process.env.NEXT_PUBLIC_REGISTER_SW === 'true';
    if (enabled && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Offline support degrades gracefully if registration fails (e.g. unsupported browser).
      });
    }
  }, []);
  return null;
}
