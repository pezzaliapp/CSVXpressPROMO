// service-worker.js
// CSVXpressPROMO — Service Worker
// Versione: bumpare SEMPRE quando cambiano asset
const CACHE_VERSION = 'v1.3.1';
const CACHE_NAME = `csvxpresspromo-${CACHE_VERSION}`;

// Asset locali da cacheare (app shell)
const APP_SHELL = [
  './',
  './index.html',
  './admin.html',
  './style.css',
  './style.mobile.cards.rev.v3.css',
  './promo.css',
  './admin-styles.css',
  './disclaimer.css',
  './app.js',
  './loaders-extra.js',
  './promo.js',
  './admin.js',
  './disclaimer.js',
  './manifest.json',
  './icon/CSVXpressSmart-192.png',
  './icon/CSVXpressSmart-512.png',
  './icon/CSVXpressSmart-1024.png'
];

// CDN (cache opportunistica)
const CDN_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.3.2/papaparse.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js'
];

/* ========================= INSTALL ========================= */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

/* ========================= ACTIVATE ========================= */
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter(name => name.startsWith('csvxpresspromo-') && name !== CACHE_NAME)
        .map(name => caches.delete(name))
    );
    if ('navigationPreload' in self.registration) {
      try { await self.registration.navigationPreload.enable(); } catch (e) {}
    }
    await self.clients.claim();
  })());
});

/* ========================= FETCH ========================= */
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // promo.json e version.json: MAI cachati (bypass diretto rete)
  if (url.origin === self.location.origin &&
      (/\/promo\/promo\.json$/.test(url.pathname) || /\/version\.json$/.test(url.pathname))) {
    event.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  // NAVIGAZIONI / HTML: network-first
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(networkFirst(req, './index.html'));
    return;
  }

  // CDN: network-first
  if (CDN_ASSETS.some(cdn => req.url.startsWith(cdn))) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Binari promo (PDF/immagini): network-first (fallback cache)
  if (url.origin === self.location.origin && /\/promo\//.test(url.pathname)) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Same-origin asset: cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(req));
    return;
  }

  event.respondWith(fetch(req).catch(() => caches.match('./index.html')));
});

/* ========================= STRATEGIE ========================= */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  const cache = await caches.open(CACHE_NAME);
  cache.put(request, response.clone());
  return response;
}

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (fallbackUrl) {
      const fb = await caches.match(fallbackUrl);
      if (fb) return fb;
    }
    throw err;
  }
}

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
