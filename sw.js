// ─────────────────────────────────────────────────────────────────────────────
// Family Finance Tracker — Service Worker
// Strategy: Cache-first for app shell, network-first for API calls
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_NAME  = 'family-finance-v1';
const API_DOMAIN  = 'script.google.com';

// App shell files to cache on install
const SHELL_FILES = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

// ── Install: pre-cache app shell ──────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        // Cache what we can; ignore missing icons gracefully
        return Promise.allSettled(
          SHELL_FILES.map(url =>
            cache.add(url).catch(() => console.log('SW: skipped caching', url))
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

// ── Activate: clean up old caches ─────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('SW: deleting old cache', key);
            return caches.delete(key);
          })
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: smart routing ──────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. Google Apps Script API calls → network-only (never cache)
  if (url.hostname.includes(API_DOMAIN)) {
    event.respondWith(
      fetch(event.request)
        .catch(() => new Response(
          JSON.stringify({ ok: false, error: 'You are offline. Entry saved locally.' }),
          { headers: { 'Content-Type': 'application/json' } }
        ))
    );
    return;
  }

  // 2. App shell (HTML, manifest, icons) → cache-first, fallback to network
  if (event.request.method === 'GET') {
    event.respondWith(
      caches.match(event.request)
        .then(cached => {
          if (cached) return cached;

          // Not in cache — fetch from network and cache it
          return fetch(event.request)
            .then(response => {
              if (response && response.status === 200 && response.type === 'basic') {
                const toCache = response.clone();
                caches.open(CACHE_NAME)
                  .then(cache => cache.put(event.request, toCache));
              }
              return response;
            })
            .catch(() => {
              // Offline and not cached — return the cached index.html as fallback
              if (event.request.destination === 'document') {
                return caches.match('./index.html');
              }
            });
        })
    );
    return;
  }
});

// ── Background sync for offline queue (optional enhancement) ─────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-expenses') {
    event.waitUntil(syncOfflineQueue());
  }
});

async function syncOfflineQueue() {
  // Notify all open clients to flush their offline queue
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({ type: 'SYNC_QUEUE' });
  });
}
