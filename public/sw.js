// Bump both names whenever a deploy requires invalidating cached pages or static chunks.
const CACHE_PAGES  = 'stripmeta-pages-v2';
const CACHE_STATIC = 'stripmeta-static-v1';
const LIVE_CACHES  = new Set([CACHE_PAGES, CACHE_STATIC]);

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_PAGES).then(cache => cache.addAll(['/', '/how-it-works']))
  );
});

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

// Only cache responses that are safe to clone and store.
function cacheable(r) {
  return r.ok && r.type !== 'opaqueredirect' && r.type !== 'error';
}

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
          if (cacheable(response)) { const c = response.clone(); caches.open(CACHE_STATIC).then(s => s.put(request, c)); }
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
          if (cacheable(response)) { const c = response.clone(); caches.open(CACHE_PAGES).then(s => s.put(request, c)); }
          return response;
        })
        .catch(() => caches.match(request))
    );
  }
});
