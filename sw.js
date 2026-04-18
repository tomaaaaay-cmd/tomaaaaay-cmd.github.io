self.addEventListener('install', e => {
  e.waitUntil(
    caches.open('liftlog-cache').then(cache =>
      cache.addAll(['index.html','liftlog_synced.html'])
    )
  );
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});