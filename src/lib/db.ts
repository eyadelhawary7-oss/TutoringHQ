import { openDB, type IDBPDatabase } from 'idb';
import { normalizeStudentNumber } from '@/lib/scanner/normalize';

const DB_NAME = 'centerhq-offline';
const DB_VERSION = 3;

let dbPromise: Promise<IDBPDatabase> | null = null;

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Students store: keyPath 'id' for uuid from QR, index on student_number for manual lookup
        if (!db.objectStoreNames.contains('students')) {
          const studentStore = db.createObjectStore('students', { keyPath: 'id' });
          studentStore.createIndex('by_student_number', 'student_number', { unique: false });
        }

        // Sync queue for offline scan events (synced when back online)
        if (!db.objectStoreNames.contains('syncQueue')) {
          db.createObjectStore('syncQueue', { keyPath: 'localId', autoIncrement: true });
        }

        // pending_scans alias for SW compatibility
        if (!db.objectStoreNames.contains('pending_scans')) {
          db.createObjectStore('pending_scans', { keyPath: 'localId', autoIncrement: true });
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

// Sync all students for a center into IndexedDB (full object: id, name, phone, groups, balance_due, qr_code, student_number)
export async function syncStudentsToLocal(
  students: (Record<string, unknown> & { id: string; student_number?: string | null })[],
) {
  const db = await getDB();
  const tx = db.transaction('students', 'readwrite');
  await tx.store.clear();
  for (const s of students) {
    const toStore = { ...s };
    if (!toStore.student_number && toStore.id) {
      toStore.student_number = null;
    }
    await tx.store.put(toStore);
  }
  await tx.done;
}

// Get a student from IndexedDB by id (uuid) or student_number (STU-XXXXX)
export async function getStudentOffline(idOrStudentNumber: string): Promise<Record<string, unknown> | undefined> {
  const db = await getDB();

  // Try by id (uuid from QR code)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(idOrStudentNumber.trim())) {
    const byId = await db.get('students', idOrStudentNumber.trim());
    if (byId) return byId as Record<string, unknown>;
  }

  // Try by student_number (STU-00001)
  const normalized = normalizeStudentNumber(idOrStudentNumber);
  try {
    const byNum = await db.getFromIndex('students', 'by_student_number', normalized);
    if (byNum) return byNum as Record<string, unknown>;
  } catch {
    // Index may not exist in older DB versions
  }

  // Fallback: getAll and find by student_number (case-insensitive)
  const all = await db.getAll('students');
  return all.find((s: Record<string, unknown>) => {
    const sn = s.student_number as string | undefined;
    if (!sn) return false;
    return sn === normalized || sn.toUpperCase() === normalized.toUpperCase();
  }) as Record<string, unknown> | undefined;
}

export async function getAllStudentsOffline() {
  const db = await getDB();
  return await db.getAll('students');
}

/** Pending scan — written to `pending_scans` first (offline source of truth). */
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
  /** Offline late-entry path — synced by `syncQueuedScans` */
  scan_kind?: 'late_entry';
  late_fee?: number;
  late_group_id?: string | null;
}): Promise<number> {
  const db = await getDB();
  const localId = await db.add('pending_scans', {
    ...scanData,
    timestamp: Date.now(),
  });
  return localId as number;
}

export async function deletePendingScanLocal(localId: number) {
  const db = await getDB();
  await db.delete('pending_scans', localId);
}

export async function getUnsyncedScans() {
  const db = await getDB();
  const pending = await db.getAll('pending_scans');
  const legacy = (await db.getAll('syncQueue')).filter((item: Record<string, unknown>) => !item.synced);
  return [...pending, ...legacy];
}

export async function markScanSynced(localId: number) {
  const db = await getDB();
  const tx = db.transaction('syncQueue', 'readwrite');
  const scan = await tx.store.get(localId);
  if (scan) {
    (scan as Record<string, unknown>).synced = true;
    await tx.store.put(scan);
  }
  await tx.done;
}

export async function getUnsyncedCount(): Promise<number> {
  const db = await getDB();
  const pending = await db.getAll('pending_scans');
  const legacy = await db.getAll('syncQueue');
  const legacyUnsynced = legacy.filter((item: Record<string, unknown>) => !item.synced);
  return pending.length + legacyUnsynced.length;
}

export async function markPaidTodayOffline(centerId: string, studentId: string) {
  const today = new Date().toISOString().split('T')[0];
  const key = `${centerId}:${studentId}:${today}`;
  const db = await getDB();
  await db.put('todayPayments', { key, studentId, centerId, paidAt: Date.now() });
}

export async function hasPaidTodayOffline(centerId: string, studentId: string): Promise<boolean> {
  const today = new Date().toISOString().split('T')[0];
  const key = `${centerId}:${studentId}:${today}`;
  const db = await getDB();
  const rec = await db.get('todayPayments', key);
  return !!rec;
}

export async function clearSyncedScans() {
  const db = await getDB();
  const tx = db.transaction('syncQueue', 'readwrite');
  const all = await tx.store.getAll();
  const syncedKeys = all
    .filter((item: Record<string, unknown>) => item.synced)
    .map((item: Record<string, unknown>) => (item as { localId?: number }).localId as IDBValidKey)
    .filter(Boolean);
  await Promise.all(syncedKeys.map((key) => tx.store.delete(key)));
  await tx.done;
}
