const DB_NAME = 'centerhq-offline';
const DB_VERSION = 2;
const STORES = {
  ROSTER_CACHE: 'roster_cache',
  SCAN_OUTBOX: 'scan_outbox',
} as const;

export interface RosterEntry {
  studentId: string;
  studentNumber: string;
  name: string;
  groupIds: string[];
  isActive: boolean;
  cachedAt: string;
}

export interface ScanOutboxEntry {
  id: string;
  studentId: string;
  centerId: string;
  scannedAt: string;
  syncStatus: 'pending' | 'synced' | 'failed';
  retryCount: number;
  scanType: 'real' | 'simulation';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.ROSTER_CACHE)) {
        const rosterStore = db.createObjectStore(STORES.ROSTER_CACHE, {
          keyPath: 'studentId',
        });
        rosterStore.createIndex('by_student_number', 'studentNumber', {
          unique: false,
        });
      }
      if (!db.objectStoreNames.contains(STORES.SCAN_OUTBOX)) {
        const outboxStore = db.createObjectStore(STORES.SCAN_OUTBOX, {
          keyPath: 'id',
        });
        outboxStore.createIndex('by_sync_status', 'syncStatus', {
          unique: false,
        });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function setRosterCache(entries: RosterEntry[]): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.ROSTER_CACHE, 'readwrite');
    const store = tx.objectStore(STORES.ROSTER_CACHE);
    store.clear();
    for (const entry of entries) {
      store.put(entry);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getRosterCache(): Promise<RosterEntry[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.ROSTER_CACHE, 'readonly');
    const store = tx.objectStore(STORES.ROSTER_CACHE);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result as RosterEntry[]);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getRosterEntryByStudentNumber(
  studentNumber: string,
): Promise<RosterEntry | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.ROSTER_CACHE, 'readonly');
    const store = tx.objectStore(STORES.ROSTER_CACHE);
    const index = store.index('by_student_number');
    const req = index.get(studentNumber);
    req.onsuccess = () =>
      resolve((req.result as RosterEntry | undefined) ?? null);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

export async function isRosterCacheFresh(): Promise<boolean> {
  const entries = await getRosterCache();
  if (entries.length === 0) return false;
  const latest = entries.reduce((max, e) =>
    e.cachedAt > max ? e.cachedAt : max,
  entries[0].cachedAt);
  return Date.now() - new Date(latest).getTime() < 8 * 60 * 60 * 1000;
}

export async function addScanToOutbox(
  entry: Omit<ScanOutboxEntry, 'id' | 'retryCount' | 'syncStatus'>,
): Promise<string> {
  const id = crypto.randomUUID();
  const row: ScanOutboxEntry = {
    ...entry,
    id,
    syncStatus: 'pending',
    retryCount: 0,
  };
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.SCAN_OUTBOX, 'readwrite');
    const store = tx.objectStore(STORES.SCAN_OUTBOX);
    store.put(row);
    tx.oncomplete = () => resolve(id);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPendingScans(): Promise<ScanOutboxEntry[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.SCAN_OUTBOX, 'readonly');
    const store = tx.objectStore(STORES.SCAN_OUTBOX);
    const index = store.index('by_sync_status');
    const req = index.getAll('pending');
    req.onsuccess = () => resolve(req.result as ScanOutboxEntry[]);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

export async function markScanSynced(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.SCAN_OUTBOX, 'readwrite');
    const store = tx.objectStore(STORES.SCAN_OUTBOX);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const entry = getReq.result as ScanOutboxEntry | undefined;
      if (entry) {
        entry.syncStatus = 'synced';
        store.put(entry);
      }
    };
    getReq.onerror = () => reject(getReq.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function markScanFailed(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.SCAN_OUTBOX, 'readwrite');
    const store = tx.objectStore(STORES.SCAN_OUTBOX);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const entry = getReq.result as ScanOutboxEntry | undefined;
      if (entry) {
        entry.retryCount += 1;
        entry.syncStatus = entry.retryCount >= 3 ? 'failed' : 'pending';
        store.put(entry);
      }
    };
    getReq.onerror = () => reject(getReq.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function flushScanOutbox(
  centerId: string,
): Promise<{ synced: number; failed: number }> {
  const scans = (await getPendingScans()).filter((s) => s.centerId === centerId);
  let synced = 0;
  let failed = 0;
  await Promise.all(
    scans.map(async (scan) => {
      try {
        const res = await fetch('/api/scan/record', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            studentId: scan.studentId,
            centerId: scan.centerId,
            scannedAt: scan.scannedAt,
            offlineId: scan.id,
            scanType: scan.scanType,
          }),
        });
        if (res.ok) {
          await markScanSynced(scan.id);
          synced += 1;
        } else {
          await markScanFailed(scan.id);
          failed += 1;
        }
      } catch {
        await markScanFailed(scan.id);
        failed += 1;
      }
    }),
  );
  return { synced, failed };
}

export async function checkStoragePersisted(): Promise<boolean> {
  return navigator.storage?.persisted?.() ?? Promise.resolve(false);
}

export async function requestPersistentStorage(): Promise<boolean> {
  return navigator.storage?.persist?.() ?? Promise.resolve(false);
}
