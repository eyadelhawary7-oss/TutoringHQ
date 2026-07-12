/**
 * TutoringHQ service worker — precache minimal scanner shell; runtime StaleWhileRevalidate via Workbox CDN.
 *
 * Bump SW_VERSION on every release that changes precached assets or branding.
 * A new version takes over immediately (skipWaiting + clientsClaim) and the
 * activate handler purges every cache from previous versions, so the first
 * normal page load after a deploy is served fresh (no stale branding) while
 * offline support keeps working off the freshly-populated current-version caches.
 */
importScripts('/workbox/workbox-v7.0.0/workbox-sw.js');

if (globalThis.workbox) {
  globalThis.workbox.setConfig({ modulePathPrefix: '/workbox/workbox-v7.0.0/' });
}

const WB = globalThis.workbox;
const SW_VERSION = 'v13';
const PRECACHE_NAME = `centerhq-precache-${SW_VERSION}`;
const RUNTIME_NAME = `centerhq-${SW_VERSION}-runtime`;
// Cache-Storage names belonging to the CURRENT version — everything else under
// the `centerhq-` prefix is treated as stale and deleted on activate.
const KEEP_CACHES = [PRECACHE_NAME, RUNTIME_NAME];

const PRECACHE_ENTRIES = [
  { url: '/manifest.webmanifest', revision: null },
  { url: '/icons/icon.svg', revision: null },
  { url: '/icons/icon-192.png', revision: null },
  { url: '/ar/scan', revision: null },
  { url: '/en/scan', revision: null },
  { url: '/ar/login', revision: null },
  { url: '/en/login', revision: null },
];

if (WB) {
  WB.core.setCacheNameDetails({
    prefix: 'centerhq',
    suffix: SW_VERSION,
    precache: 'precache',
    runtime: 'runtime',
  });

  WB.core.clientsClaim();
  WB.precaching.cleanupOutdatedCaches();
  WB.precaching.precacheAndRoute(PRECACHE_ENTRIES);

  WB.routing.registerRoute(
    ({ request, url }) =>
      request.method === 'GET' &&
      url.origin === self.location.origin &&
      url.pathname.startsWith('/api/'),
    new WB.strategies.NetworkOnly({
      plugins: [
        {
          handlerDidError: async () =>
            new Response(JSON.stringify({ error: 'offline' }), {
              status: 503,
              headers: { 'Content-Type': 'application/json' },
            }),
        },
      ],
    }),
  );

  WB.routing.registerRoute(
    ({ request }) =>
      request.destination === 'font' ||
      (typeof request.url === 'string' &&
        (request.url.includes('fonts.googleapis.com') || request.url.includes('fonts.gstatic.com'))),
    new WB.strategies.NetworkOnly(),
  );

  const runtimeSWR = new WB.strategies.StaleWhileRevalidate({
    cacheName: RUNTIME_NAME,
  });

  WB.routing.registerRoute(
    ({ request, url }) =>
      request.method === 'GET' &&
      url.origin === self.location.origin &&
      !url.pathname.startsWith('/api/'),
    runtimeSWR,
  );

  WB.routing.setCatchHandler(async ({ event }) => {
    if (event.request.mode === 'navigate') {
      try {
        const path = new URL(event.request.url).pathname;
        const localePrefix = path.startsWith('/en') ? '/en' : '/ar';
        const offlinePage = await caches.match(`${localePrefix}/offline`);
        if (offlinePage) return offlinePage;
        const arScan = await caches.match('/ar/scan');
        if (arScan) return arScan;
        const enScan = await caches.match('/en/scan');
        if (enScan) return enScan;
      } catch {
        //
      }
      return new Response(
        `<html><body><h2 style="font-family:sans-serif;text-align:center;margin-top:40px">افتح التطبيق مرة واحدة وأنت متصل بالإنترنت لتفعيل وضع عدم الاتصال</h2></body></html>`,
        { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
      );
    }
    return Response.error();
  });

  self.addEventListener('install', (event) => {
    event.waitUntil(WB.core.skipWaiting());
  });
} else {
  console.warn('[SW] Workbox unavailable — skipping advanced caching');
}

self.addEventListener('activate', (event) => {
  // Purge every Cache-Storage entry from previous SW versions so a new deploy
  // can never serve old precached/runtime assets (e.g. stale branding).
  // Only Cache Storage is touched; the offline scan IndexedDB is left intact.
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith('centerhq-') && !KEEP_CACHES.includes(k))
          .map((k) => caches.delete(k)),
      ),
    ),
  );
});

// IndexedDB for offline scan queue (legacy SW message channel)
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
      }),
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
