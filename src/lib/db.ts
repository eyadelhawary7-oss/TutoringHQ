import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'revenueguard';
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase> | null = null;

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Students store for offline lookup
        if (!db.objectStoreNames.contains('students')) {
          db.createObjectStore('students', { keyPath: 'id' });
        }

        // Sync queue for offline scan events
        if (!db.objectStoreNames.contains('syncQueue')) {
          db.createObjectStore('syncQueue', { keyPath: 'localId', autoIncrement: true });
        }

        // Today's payments for offline scan check (per-session payment cycle)
        if (!db.objectStoreNames.contains('todayPayments')) {
          db.createObjectStore('todayPayments', { keyPath: 'key' });
        }
      },
    });
  }
  return dbPromise;
}

// Sync all students for a center into IndexedDB
export async function syncStudentsToLocal(students: Record<string, unknown>[]) {
  const db = await getDB();
  const tx = db.transaction('students', 'readwrite');
  // Clear old data first
  await tx.store.clear();
  await Promise.all(students.map(s => tx.store.put(s)));
  await tx.done;
}

// Get a student from IndexedDB (offline lookup by id or student_number)
export async function getStudentOffline(idOrStudentNumber: string): Promise<Record<string, unknown> | undefined> {
  const db = await getDB();
  const byId = await db.get('students', idOrStudentNumber);
  if (byId) return byId as Record<string, unknown>;
  const normalized = normalizeStudentNumberInput(idOrStudentNumber);
  const all = await db.getAll('students');
  return all.find((s: Record<string, unknown>) => {
    const sn = s.student_number as string | undefined;
    if (!sn) return false;
    return sn === normalized || sn.toUpperCase() === normalized.toUpperCase();
  }) as Record<string, unknown> | undefined;
}

function normalizeStudentNumberInput(input: string): string {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return 'STU-' + trimmed.padStart(5, '0');
  if (trimmed.toUpperCase().startsWith('STU-')) return trimmed.toUpperCase();
  return trimmed;
}

// Get all students from IndexedDB
export async function getAllStudentsOffline() {
  const db = await getDB();
  return await db.getAll('students');
}

// Queue a scan event for later sync
export async function queueScan(scanData: {
  student_id: string;
  center_id: string;
  scanned_by: string;
  scanned_at: string;
  payment_action?: {
    method: string;
    amount: number;
    isPending?: boolean;
    group_id?: string;
  };
}) {
  const db = await getDB();
  await db.add('syncQueue', {
    ...scanData,
    synced: false,
    timestamp: Date.now(),
  });
}

// Get all unsynced scan events
export async function getUnsyncedScans() {
  const db = await getDB();
  const all = await db.getAll('syncQueue');
  return all.filter((item: Record<string, unknown>) => !item.synced);
}

// Mark a scan as synced
export async function markScanSynced(localId: number) {
  const db = await getDB();
  const tx = db.transaction('syncQueue', 'readwrite');
  const scan = await tx.store.get(localId);
  if (scan) {
    scan.synced = true;
    await tx.store.put(scan);
  }
  await tx.done;
}

// Get count of unsynced scans
export async function getUnsyncedCount(): Promise<number> {
  const db = await getDB();
  const all = await db.getAll('syncQueue');
  return all.filter((item: Record<string, unknown>) => !item.synced).length;
}

// Mark student as paid today (offline cache for per-session flow)
export async function markPaidTodayOffline(centerId: string, studentId: string) {
  const today = new Date().toISOString().split('T')[0];
  const key = `${centerId}:${studentId}:${today}`;
  const db = await getDB();
  await db.put('todayPayments', { key, studentId, centerId, paidAt: Date.now() });
}

// Check if student paid today (offline - used when navigator.onLine is false)
export async function hasPaidTodayOffline(centerId: string, studentId: string): Promise<boolean> {
  const today = new Date().toISOString().split('T')[0];
  const key = `${centerId}:${studentId}:${today}`;
  const db = await getDB();
  const rec = await db.get('todayPayments', key);
  return !!rec;
}

// Clear all synced scans
export async function clearSyncedScans() {
  const db = await getDB();
  const tx = db.transaction('syncQueue', 'readwrite');
  const all = await tx.store.getAll();
  const syncedKeys = all
    .filter((item: Record<string, unknown>) => item.synced)
    .map((item: Record<string, unknown>) => item.localId as IDBValidKey);
  await Promise.all(syncedKeys.map(key => tx.store.delete(key)));
  await tx.done;
}
