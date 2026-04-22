// LiftLog Service Worker - v4
const CACHE_NAME = 'liftlog-v4';
const urlsToCache = ['/', '/index.html'];

// ── Install - cache resources immediately ──────────────────────────────────
self.addEventListener('install', event => {
  console.log('SW: Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
      .then(() => self.skipWaiting())
  );
});

// ── Activate - clean up old caches ─────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('SW: Activating...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('SW: Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// ── Fetch - cache first for speed, update cache in background ──────────────
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      // Serve from cache immediately for speed
      const fetchPromise = fetch(event.request).then(networkResponse => {
        // Update the cache in the background with the fresh version
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => {
        // Network failed - cached version already being served
        console.log('SW: Network unavailable, serving from cache');
      });

      // Return cache instantly, fetch happens in background
      return cachedResponse || fetchPromise;
    })
  );
});

// ── Background Sync - queue failed saves and retry when back online ─────────
const SYNC_QUEUE_KEY = 'liftlog-sync-queue';

// Listen for sync events (triggered when connection is restored)
self.addEventListener('sync', event => {
  if (event.tag === 'liftlog-sync') {
    console.log('SW: Connection restored, attempting background sync...');
    event.waitUntil(flushSyncQueue());
  }
});

async function flushSyncQueue() {
  const cache = await caches.open(CACHE_NAME);
  const queueResponse = await cache.match(SYNC_QUEUE_KEY);
  if (!queueResponse) return;

  let queue = [];
  try {
    queue = await queueResponse.json();
  } catch {
    return;
  }

  if (!queue.length) return;

  const failed = [];
  for (const item of queue) {
    try {
      const response = await fetch(item.url, {
        method: item.method,
        headers: item.headers,
        body: item.body
      });
      if (!response.ok) throw new Error('Request failed');
      console.log('SW: Synced queued item successfully');
    } catch {
      console.log('SW: Sync failed, keeping in queue');
      failed.push(item);
    }
  }

  // Save remaining failed items back to queue
  const updatedQueue = new Response(JSON.stringify(failed));
  await cache.put(SYNC_QUEUE_KEY, updatedQueue);

  // Notify the app that sync completed
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({
      type: 'SYNC_COMPLETE',
      synced: queue.length - failed.length,
      failed: failed.length
    });
  });
}

// Listen for messages from the app to queue a sync request
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'QUEUE_SYNC') {
    console.log('SW: Queuing sync request for when connection returns');
    queueSyncRequest(event.data.payload);
  }
});

async function queueSyncRequest(payload) {
  const cache = await caches.open(CACHE_NAME);
  const queueResponse = await cache.match(SYNC_QUEUE_KEY);
  let queue = [];

  try {
    if (queueResponse) queue = await queueResponse.json();
  } catch { queue = []; }

  queue.push(payload);
  await cache.put(SYNC_QUEUE_KEY, new Response(JSON.stringify(queue)));

  // Register a background sync so it fires when connection returns
  try {
    await self.registration.sync.register('liftlog-sync');
  } catch {
    // Background sync API not supported, will retry on next load
    console.log('SW: Background sync API not available');
  }
}
