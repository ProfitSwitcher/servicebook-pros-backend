const CACHE_NAME = 'servicebook-cache-v1';
const PRECACHE_URLS = [
  '/',
  'index.html',
  'main.js',
  'styles.css',
  'manifest.json'
];

// Install event: cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS);
    })
  );
});

// Activate event: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Fetch event: network-first for API, cache-first for same-origin resources
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // Treat API requests as network-first
  if (url.origin !== location.origin) {
    event.respondWith(
      fetch(request).catch(() => caches.match(request))
    );
    return;
  }
  // For other requests, use cache-first strategy
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      return (
        cachedResponse || fetch(request).then((response) => {
          // Cache the fetched response for future use
          return caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, response.clone());
            return response;
          });
        })
      );
    })
  );
});