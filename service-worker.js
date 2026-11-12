const CACHE_NAME = 'campus-connect-v9';
const APP_SHELL = [
  './',
  './index.html',
  './auth.html',
  './student/dashboard.html',
  './student/dashboard.css',
  './student/dashboard.js',
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
    // Cache the shell opportunistically so a single missing optional asset cannot
    // prevent the updated worker from installing.
    await Promise.all(APP_SHELL.map(async (path) => {
      try {
        const response = await fetch(path);
        if (response.ok) await cache.put(path, response);
      } catch {
        // Network may be unavailable during installation; the next request can retry.
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

  const pathname = new URL(request.url).pathname;
  const isCssOrJs = /\.(?:css|js)$/i.test(pathname);

  if (isCssOrJs) {
    // Always try the latest styles and scripts first. Use the cache only when
    // offline, and refresh the cached copy after a successful network response.
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
