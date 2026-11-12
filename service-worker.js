const CACHE_NAME = 'campus-connect-v13';
const APP_SHELL = [
  './',
  './index.html',
  './auth.html',
  './student/dashboard.html',
  './student/dashboard.css',
  './student/dashboard.js',
  './admin/dashboard.html',
  './admin/dashboard.css',
  './admin/dashboard.js',
  './manifest.webmanifest',
  './src/css/styles.css',
  './src/css/auth.css',
  './src/js/app.js',
  './src/js/theme.js',
  './src/js/auth.js',
  './src/js/supabase-config.js',
  './src/js/supabase-client.js',
  './assets/icons/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(APP_SHELL.map(async (path) => {
      try {
        const url = new URL(path, self.registration.scope);
        const response = await fetch(url);
        if (response.ok) await cache.put(url, response);
      } catch {
        // Retry on a later request if the network is unavailable during install.
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  const url = new URL(request.url);
  if (/\.(?:css|js)$/i.test(url.pathname)) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
        return response;
      } catch {
        const cached = await caches.match(request);
        if (cached) return cached;
        return new Response('Asset unavailable while offline.', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    return fetch(request);
  })());
});
