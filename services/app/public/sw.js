const APP_ASSET_VERSION = 'ASSET_VERSION';
const CACHE_PREFIX = 'rclone-oauth-manager-';
const CACHE_NAME = `${CACHE_PREFIX}${APP_ASSET_VERSION}`;

function versioned(path) {
  return `${path}?v=${encodeURIComponent(APP_ASSET_VERSION)}`;
}

const STATIC_ASSETS = [
  versioned('/manifest.json'),
  versioned('/css/tokens.css'),
  versioned('/css/reset.css'),
  versioned('/css/typography.css'),
  versioned('/css/layout.css'),
  versioned('/css/components.css'),
  versioned('/css/animations.css'),
  versioned('/css/responsive.css'),
  versioned('/css/main.css'),
  versioned('/js/api.js'),
  versioned('/js/theme.js'),
  versioned('/js/sidebar.js'),
  versioned('/js/firebase-client.js'),
  versioned('/js/oauth.js'),
  versioned('/js/credentials.js'),
  versioned('/js/tags.js'),
  versioned('/js/configs.js'),
  versioned('/js/manager.js'),
  versioned('/js/rcloneCommands.js'),
  versioned('/js/main.js'),
  versioned('/favicon.ico'),
  versioned('/icons/icon-192.png'),
  versioned('/icons/icon-512.png'),
];

async function deleteOldAppCaches() {
  const keys = await caches.keys();
  await Promise.all(keys
    .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
    .map((key) => caches.delete(key)));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .catch(() => null),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(deleteOldAppCaches().then(() => caches.open(CACHE_NAME)));
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
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/health' || url.pathname === '/sw.js') return;

  // HTML/navigation must always go to network so the app receives the newest
  // ASSET_VERSION from .env. Do not serve stale index.html from service worker.
  if (event.request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});
