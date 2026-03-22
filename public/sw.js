const CACHE_NAME = 'centerhq-v4';

const PRECACHE_URLS = [
  '/ar/dashboard',
  '/en/dashboard',
  '/ar/scan',
  '/en/scan',
  '/ar/scanner',
  '/en/scanner',
  '/ar/offline',
  '/en/offline',
  '/manifest.json',
  '/icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        PRECACHE_URLS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[SW] Failed to precache:', url, err);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// IndexedDB for offline scan queue
const DB_NAME = 'centerhq-offline';
const STORE_NAME = 'pending-scans';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function savePendingScan(scanData) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).add({ ...scanData, timestamp: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function getAllPendingScans() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function deletePendingScan(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') return;
  if (!url.protocol.startsWith('http')) return;

  // Skip font requests entirely — fonts are self-hosted
  if (
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com') ||
    event.request.destination === 'font'
  ) {
    return;
  }

  // API: network only, return error JSON when offline
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: 'offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    return;
  }

  // Next.js static chunks: cache first
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  // Pages: stale-while-revalidate (with offline navigation fallback)
  event.respondWith(
    (async function () {
      if (event.request.mode === 'navigate') {
        try {
          return await fetch(event.request);
        } catch {
          try {
            const cache = await caches.open(CACHE_NAME);
            const path = new URL(event.request.url).pathname;
            const localePrefix = path.startsWith('/en') ? '/en' : '/ar';
            const offlinePage = await cache.match(`${localePrefix}/offline`);
            if (offlinePage) return offlinePage;
            const arScan = await cache.match('/ar/scan');
            if (arScan) return arScan;
            const enScan = await cache.match('/en/scan');
            if (enScan) return enScan;
          } catch {
            // caches.open or cache.match failed — fall through to HTML fallback
          }
          return new Response(
            `<html><body><h2 style="font-family:sans-serif;text-align:center;margin-top:40px">افتح التطبيق مرة واحدة وأنت متصل بالإنترنت لتفعيل وضع عدم الاتصال</h2></body></html>`,
            { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        }
      }
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(event.request);

      const networkPromise = fetch(event.request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            cache.put(event.request, clone);
          }
          return res;
        })
        .catch(() => null);

      if (cached) {
        networkPromise.catch(() => {});
        return cached;
      }

      const networkRes = await networkPromise;
      if (networkRes) return networkRes;

      // Fallback for scan routes when fully offline
      if (url.pathname.includes('/scan')) {
        const fallback =
          (await cache.match('/ar/scan')) ||
          (await cache.match('/en/scan'));
        if (fallback) return fallback;
      }

      return new Response('Offline', { status: 503 });
    })()
  );
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-scans') {
    event.waitUntil(
      getAllPendingScans().then(async (scans) => {
        for (const scan of scans) {
          try {
            const res = await fetch('/api/scans', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(scan),
            });
            if (res.ok) await deletePendingScan(scan.id);
          } catch (e) {
            console.warn('[SW] Sync failed:', e);
          }
        }
      })
    );
  }
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'QUEUE_SCAN') {
    savePendingScan(event.data.scan).then(() => {
      event.ports[0]?.postMessage({ success: true });
    });
  }
});
