const CACHE_NAME = 'campus-connect-v20';
const APP_SHELL = [
  './', './index.html', './auth.html', './reset-password.html',
  './student/dashboard.html', './student/dashboard.css', './student/dashboard.js',
  './student/voice.html', './student/voice.css', './student/voice.js',
  './student/voice-new.html', './student/voice-new.css', './student/voice-new.js',
  './student/voice-post.html', './student/voice-post.css', './student/voice-post.js',
  './student/lost-found.html', './student/lost-found.css', './student/lost-found.js',
  './student/lost-found-new.html', './student/lost-found-new.css', './student/lost-found-new.js',
  './student/lost-found-item.html', './student/lost-found-item.css', './student/lost-found-item.js',
  './admin/dashboard.html', './admin/dashboard.css', './admin/dashboard.js', './admin/dashboard-notice.js',
  './admin/voice-admin.css', './admin/voice-admin.js', './admin/lost-found-actions.js',
  './manifest.webmanifest', './src/css/styles.css', './src/css/auth.css',
  './src/js/app.js', './src/js/theme.js', './src/js/auth.js',
  './src/js/supabase-config.js', './src/js/supabase-client.js', './assets/icons/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(APP_SHELL.map(async (path) => {
      try {
        const url = new URL(path, self.registration.scope);
        const response = await fetch(url, { cache: 'reload' });
        if (response.ok) await cache.put(url, response);
      } catch {
        // Missing files are skipped; they are cached when first visited.
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

// Network-first for everything: always load the newest files when online,
// and fall back to the cache only when offline.
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request, { cache: 'no-cache' });
      if (response.ok && response.status === 200) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    } catch {
      const cached = await caches.match(request, { ignoreSearch: true });
      if (cached) return cached;
      if (request.mode === 'navigate') {
        const fallback = await caches.match(new URL('./index.html', self.registration.scope));
        if (fallback) return fallback;
      }
      return new Response('You are offline.', {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
  })());
});
