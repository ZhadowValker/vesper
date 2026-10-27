const VERSION = 'vesper-v32';
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
  'js/ai/settings.js',
  'js/ai/client.js',
  'js/ai/prompts.js',
  'js/ai/ui.js',
  'js/ai/agent.js',
  'js/ai/questions.js',
  'js/ai/interview.js',
  'js/ai/chatstate.js',
  'js/ai/panel.js',
  'js/ai/apply.js',
  'js/ai/steps.js',
  'js/merge.js',
  'js/sync.js',
  'js/export.js',
  'js/connect-ui.js',
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
  // Network first so a new version shows up straight away; the cache keeps it working offline.
  event.respondWith(
    fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(VERSION).then((cache) => cache.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match('index.html')))
  );
});
