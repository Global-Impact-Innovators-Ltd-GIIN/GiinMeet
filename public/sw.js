// Phase C1 (32), GiinMeet service worker (installable PWA shell).
//
// What it does:
//   * Caches the app shell (home page, logo, icons, manifest) so the app
//     opens from the home screen and survives a flaky connection.
//   * Navigations are network-first with a cached fallback to the home
//     page, so a dropped connection shows the app, not a browser error.
//   * Same-origin static assets are cache-first.
// What it never does:
//   * It never caches API responses (/api/*), auth, or meeting media:
//     those are always live, so a stale cache can never show an old
//     meeting state or another user's data.
// Bump CACHE_NAME when the shell changes, so old caches are dropped.
const CACHE_NAME = 'giinmeet-v1';
const SHELL_URLS = [
  '/',
  '/favicon.ico',
  '/logo.png',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)).catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Only same-origin GETs; everything else (API, LiveKit, Supabase)
  // goes straight to the network, untouched.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Navigations: network first, cached home page as the offline fallback.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('/', copy)).catch(() => undefined);
          return response;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }

  // Static assets: cache first, network fills the cache.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => undefined);
        }
        return response;
      });
    }),
  );
});
