const CACHE_NAME = 'family-finance-v192';
const DATA_CACHE = 'family-finance-data-v1';
const STATIC_ASSETS = [
  '.', '/index.html', '/css/style.css', '/js/app.js', '/js/storage.js',
  '/js/parser.js', '/js/insurance-data.js', '/js/stock-data.js',
  '/js/rsu-data.js', '/js/fund-data.js', '/js/loan-data.js',
  '/js/annuity-data.js', '/js/history-data.js', '/js/import-insurance.js',
  '/manifest.json', '/data/stock-prices.json', '/data/stock-history.json',
  '/data/macro-trends.json'
];

// 需要绕过 GitHub Pages CDN 缓存的核心资源
const NO_CACHE_PATHS = ['/', '/index.html', '/css/style.css', '/js/app.js', '/js/storage.js'];

self.addEventListener('install', e => {
  e.waitUntil(self.skipWaiting());
  e.waitUntil(
    caches.open(CACHE_NAME).then(c =>
      c.addAll(STATIC_ASSETS).catch(err => console.warn('[SW] 缓存部分资源失败:', err))
    )
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME && k !== DATA_CACHE).map(k => caches.delete(k))
      )
    )
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('/api/')) return fetch(event.request);

  const url = new URL(event.request.url);
  const isNoCache = NO_CACHE_PATHS.includes(url.pathname);
  const request = isNoCache
    ? new Request(event.request, {
        headers: Object.assign({}, event.request.headers, { 'Cache-Control': 'no-cache' })
      })
    : event.request;

  event.respondWith(
    caches.match(event.request).then(cached => {
      return fetch(request)
        .then(networkResponse => {
          if (networkResponse && networkResponse.ok) {
            caches.open(CACHE_NAME).then(c => c.put(event.request, networkResponse.clone()));
          }
          return networkResponse;
        })
        .catch(() => cached || new Response('', { status: 408, statusText: 'Offline' }));
    })
  );
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
