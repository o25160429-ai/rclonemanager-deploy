const CACHE_NAME = 'rclone-oauth-manager-v31';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/main.css?v=20260502-4',
  '/css/tokens.css',
  '/css/reset.css',
  '/css/layout.css?v=20260501-11',
  '/css/components.css?v=20260502-4',
  '/css/typography.css',
  '/css/animations.css',
  '/css/responsive.css?v=20260502-2',
  '/js/api.js?v=20260502-1',
  '/js/theme.js?v=20260430-6',
  '/js/sidebar.js?v=20260501-8',
  '/js/firebase-client.js?v=20260501-1',
  '/js/oauth.js?v=20260502-4',
  '/js/credentials.js?v=20260501-15',
  '/js/tags.js?v=20260502-2',
  '/js/configs.js?v=20260502-2',
  '/js/manager.js?v=20260430-6',
  '/js/rcloneCommands.js?v=20260501-2',
  '/js/main.js?v=20260502-2',
  '/favicon.ico',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  const reply = (payload) => {
    if (event.ports && event.ports[0]) event.ports[0].postMessage(payload);
  };
  const type = event.data && event.data.type;

  if (type === 'SKIP_WAITING') {
    self.skipWaiting();
    reply({ ok: true });
    return;
  }

  if (type === 'CLEAR_CACHES') {
    event.waitUntil(
      caches.keys()
        .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
        .then(() => reply({ ok: true }))
        .catch((err) => reply({ ok: false, error: err.message })),
    );
  }
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/') || url.pathname === '/health') return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});
