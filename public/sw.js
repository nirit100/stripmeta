// @version __SW_VERSION__ (replaced at build time — makes the file byte-unique per deploy)
// Cache names are tied to the build version so `activate` purges every prior
// deploy's entries — a navigate-fallback page can never reference asset
// hashes older than the current deploy.
const SW_VERSION    = '__SW_VERSION__';
const CACHE_PAGES  = `stripmeta-pages-${SW_VERSION}`;
const CACHE_STATIC = `stripmeta-static-${SW_VERSION}`;
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

// Storage can fail in ways the network cannot: blocked site data, an exceeded
// quota, or a cache being deleted by `activate` while a page is still asking
// for assets. Firefox surfaces those as a rejection and then fails the whole
// request — a blank site — so cache access here never rejects: it degrades to
// the network instead. Looking in one named cache rather than across all of
// them also keeps a lookup clear of whatever `activate` is busy deleting.
async function cacheMatch(cacheName, request) {
  try {
    const cache = await caches.open(cacheName);
    return await cache.match(request);
  } catch {
    return undefined;
  }
}

/** Fire-and-forget: a copy that fails to store is not worth failing a load over. */
async function cachePut(cacheName, request, response) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response);
  } catch { /* blocked, evicted or over quota */ }
}

/** Content-hashed filenames are immutable: serve from cache, fall back to network. */
async function assetFirstFromCache(request) {
  const cached = await cacheMatch(CACHE_STATIC, request);
  if (cached) return cached;
  const response = await fetch(request);
  if (cacheable(response)) cachePut(CACHE_STATIC, request, response.clone());
  return response;
}

/** HTML: network first so updates are picked up immediately, cache for offline. */
async function pageFirstFromNetwork(request) {
  try {
    const response = await fetch(request);
    if (cacheable(response)) cachePut(CACHE_PAGES, request, response.clone());
    return response;
  } catch (offline) {
    // A miss here would resolve to undefined, which is itself a failed request.
    const cached = await cacheMatch(CACHE_PAGES, request);
    if (cached) return cached;
    throw offline;
  }
}

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Let the SW file and manifest always go straight to the network.
  if (url.pathname === '/sw.js' || url.pathname === '/manifest.webmanifest') return;

  if (url.pathname.startsWith('/_astro/')) {
    event.respondWith(assetFirstFromCache(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(pageFirstFromNetwork(request));
  }
});
