// Bump both names whenever a deploy requires invalidating cached pages or static chunks.
const CACHE_PAGES  = 'stripmeta-pages-v1';
const CACHE_STATIC = 'stripmeta-static-v1';
const LIVE_CACHES  = new Set([CACHE_PAGES, CACHE_STATIC]);

self.addEventListener('install', () => { /* wait for user to approve update */ });

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => !LIVE_CACHES.has(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Let the SW file and manifest always go straight to the network.
  if (url.pathname === '/sw.js' || url.pathname === '/manifest.webmanifest') return;

  if (url.pathname.startsWith('/_astro/')) {
    // Content-hashed filenames are immutable: serve from cache, fall back to network.
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (response.ok) caches.open(CACHE_STATIC).then(c => c.put(request, response.clone()));
          return response;
        });
      })
    );
    return;
  }

  if (request.mode === 'navigate') {
    // HTML: try network first so updates are picked up immediately; fall back to cache for offline.
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) caches.open(CACHE_PAGES).then(c => c.put(request, response.clone()));
          return response;
        })
        .catch(() => caches.match(request))
    );
  }
});
