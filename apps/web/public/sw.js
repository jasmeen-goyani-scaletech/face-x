// Face-X service worker — app-shell precache + runtime caching so the
// registration flow keeps working (and previously-visited screens keep
// rendering) when connectivity drops mid-registration.
const CACHE_VERSION = 'face-x-v1';
const APP_SHELL = ['/', '/register', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

// Background Sync: when connectivity returns (even if the tab was backgrounded), tell any open app window to flush its
// offline check-in queue. The queue lives in IndexedDB and is sent by the page, which also covers browsers without this event.
self.addEventListener('sync', (event) => {
  if (event.tag !== 'facex-sync-checkins') return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      clients.forEach((c) => c.postMessage({ type: 'facex-sync-checkins' }));
    })
  );
});

// --- Web Push -------------------------------------------------------------------------------------------------
// The API sends JSON: { type, title, body, url, tag, data }. It is shown as a system notification; clicking it opens `url`.
const DEFAULT_PUSH_URL = '/';

// Only ever open a path on this site: a payload must not be able to send someone to another origin.
function safeNotificationUrl(raw) {
  try {
    const target = new URL(typeof raw === 'string' ? raw : DEFAULT_PUSH_URL, self.location.origin);
    return target.origin === self.location.origin ? target.pathname + target.search + target.hash : DEFAULT_PUSH_URL;
  } catch (e) {
    return DEFAULT_PUSH_URL;
  }
}

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = {};
  }
  const title = typeof payload.title === 'string' && payload.title ? payload.title : 'Face-X';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof payload.body === 'string' ? payload.body : '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      // The same tag replaces the older notification about the same thing instead of stacking.
      tag: typeof payload.tag === 'string' ? payload.tag : undefined,
      renotify: typeof payload.tag === 'string',
      data: { url: safeNotificationUrl(payload.url), type: payload.type, details: payload.data || {} }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = safeNotificationUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      // Reuse an open window of the app (navigating it to the right page) instead of opening another one.
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin && 'navigate' in client) {
          return client
            .navigate(url)
            .then((navigated) => (navigated || client).focus())
            .catch(() => self.clients.openWindow(url));
        }
      }
      return self.clients.openWindow(url);
    })
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // API responses are live data (e.g. the Admin sync reconcile), never cache-first.
  if (url.pathname.startsWith('/api/')) return;

  // Navigations: network-first so users get fresh screens online, with an
  // offline fallback to whatever shell page is cached.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/')))
    );
    return;
  }

  // Everything else (static assets, icons, build chunks): cache-first,
  // filling the cache as new assets are requested.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(() => cached);
    })
  );
});
