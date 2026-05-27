// BioWallet ServiceWorker — offline cache
// Scope: /app/ (a fájl /app/sw.js-ből regisztrálódik)
const CACHE    = 'biowallet-v1';
const PRECACHE = [
  '/app/',
  '/app/index.html',
  '/app/app.js',
  '/app/manifest.json',
  '/core/causal_chain.js',
  '/core/vault.js',
  '/core/fuzzy_extractor.js',
  '/core/bio_capture.js',
];

self.addEventListener('install', e =>
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  )
);

self.addEventListener('activate', e =>
  e.waitUntil(self.clients.claim())
);

self.addEventListener('fetch', e =>
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  )
);
