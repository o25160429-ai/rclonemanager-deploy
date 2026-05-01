const CACHE_NAME = 'rclone-oauth-manager-v15';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/main.css',
  '/css/tokens.css',
  '/css/reset.css',
  '/css/layout.css',
  '/css/components.css',
  '/css/typography.css',
  '/css/animations.css',
  '/css/responsive.css',
  '/js/api.js?v=20260501-3',
  '/js/theme.js?v=20260430-6',
  '/js/sidebar.js?v=20260430-6',
  '/js/firebase-client.js?v=20260501-1',
  '/js/oauth.js?v=20260501-6',
  '/js/credentials.js?v=20260430-6',
  '/js/configs.js?v=20260501-1',
  '/js/manager.js?v=20260430-6',
  '/js/rcloneCommands.js?v=20260501-1',
  '/js/main.js?v=20260501-7',
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
