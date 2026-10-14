const CACHE_NAME = 'bin-iso-ultimate-v2';
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
];

// Install - pre-cache app shell
self.addEventListener('install', (event) => {
  console.log('[SW] Install');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // cache.addAll bisa gagal jika satu file 404, jadi pakai individual
      return Promise.allSettled(
        PRECACHE_URLS.map(url => cache.add(url).catch(err => console.warn('[SW] gagal cache', url, err)))
      );
    }).then(() => self.skipWaiting())
  );
});

// Activate - hapus cache lama
self.addEventListener('activate', (event) => {
  console.log('[SW] Activate');
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] hapus cache lama', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch strategy:
// - Navigation: network-first -> cache -> index.html
// - CDN jszip: cache-first -> network
// - Lainnya (same-origin): cache-first -> network -> cache update
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Hanya handle GET
  if (req.method !== 'GET') return;

  // Abaikan chrome-extension, dll
  if (!url.protocol.startsWith('http')) return;

  // 1. Navigation request (HTML)
  if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // update cache dengan versi terbaru
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, clone));
          return res;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);
          const cached = await cache.match(req);
          if (cached) return cached;
          // fallback ke index.html / root
          const index = await cache.match('./index.html') || await cache.match('./');
          return index || Response.error();
        })
    );
    return;
  }

  // 2. CDN JSZip - cache first, biar offline tetap bisa ZIP
  if (url.href.includes('jszip')) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(req, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  // 3. Same-origin assets: cache first
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          // jangan cache file BIN/ISO yang besar hasil upload (POST udah di-filter)
          // hanya cache asset statis
          if (res.ok && req.url.match(/\.(png|json|html|js|css|svg|webp)$/)) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(req, clone));
          }
          return res;
        }).catch(() => {
          // kalau gagal dan itu image, bisa return placeholder transparan
          if (req.destination === 'image') {
            return new Response('', { status: 204 });
          }
        });
      })
    );
  }
});

// Optional: pesan dari client untuk update SW
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'CLEAR_CACHE') {
    caches.delete(CACHE_NAME).then(() => console.log('[SW] cache cleared'));
  }
});
