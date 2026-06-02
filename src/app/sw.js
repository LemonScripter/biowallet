// BioWallet ServiceWorker — offline cache (Phase C + WC2)
const CACHE = 'biowallet-v50';

const PRECACHE = [
  '/app/',
  '/app/index.html',
  '/app/app.js',
  '/app/manifest.json',
  '/app/icon-192.png',
  '/app/icon-512.png',
  '/app/vault_worker.js',
  '/core/bio_capture.js',
  '/core/i18n.js',
  '/core/causal_chain.js',
  '/core/fuzzy_extractor.js',
  '/core/recovery_formula.js',
  '/core/rpc.js',
  '/core/vault.js',
  '/core/wallet.js',
  '/core/wc2.js',
  '/vendor/face-api.min.js',
  '/vendor/ethers.umd.min.js',
  '/vendor/qrcode.min.js',
  '/vendor/wc2.min.js',
  '/models/tiny_face_detector_model-shard1',
  '/models/tiny_face_detector_model-weights_manifest.json',
  '/models/face_landmark_68_model-shard1',
  '/models/face_landmark_68_model-weights_manifest.json',
  '/models/face_recognition_model-shard1',
  '/models/face_recognition_model-shard2',
  '/models/face_recognition_model-weights_manifest.json',
  '/recovery_tool.html',
  '/app/dapp-guide.html',
  '/app/dapp-guide.js',
  '/core/swap.js',
  '/core/prices.js',
];

// cache: 'reload' — HTTP cache kihagyása, mindig a szerverről tölt
self.addEventListener('install', e =>
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(
        PRECACHE.map(url =>
          fetch(url, { cache: 'reload' }).then(r => c.put(url, r))
        )
      ))
      .then(() => self.skipWaiting())
  )
);

self.addEventListener('activate', e =>
  e.waitUntil(
    caches.keys()
      .then(names => Promise.all(
        names.filter(n => n !== CACHE).map(n => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  )
);

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // Pass through: external RPC calls (Ethereum nodes)
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true })
      .then(r => r || fetch(e.request))
  );
});
