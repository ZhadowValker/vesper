const VERSION = 'vesper-v17';
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'fonts/bricolage.woff2',
  'fonts/figtree.woff2',
  'img/selah.webp',
  'js/app.js',
  'js/framework.js',
  'js/store.js',
  'js/sample.js',
  'js/guide.js',
  'js/util.js',
  'js/nav.js',
  'js/mindmaps.js',
  'js/views/home.js',
  'js/views/project.js',
  'js/views/deck.js',
  'js/views/slide.js',
  'js/views/parts.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => caches.match('index.html'));
    })
  );
});
