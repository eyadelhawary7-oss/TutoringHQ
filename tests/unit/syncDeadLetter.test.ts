import { describe, it, expect, vi, beforeEach } from 'vitest';

// Job 3, Part 8 (Eyad's decision: dead-letter, do NOT destroy). A scan the server
// PERMANENTLY rejects (taken while the centre was locked) must be moved to the local
// rejected_scans store and removed from the retry queue, never deleted outright. A
// transient failure (e.g. a 500 with no permanent flag) must be left in the queue to
// retry and never dead-lettered.

const deadLetterScan = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
const deletePendingScanLocal = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
const getUnsyncedScans = vi.fn<(...args: unknown[]) => Promise<unknown[]>>();

vi.mock('@/lib/db', () => ({
  getUnsyncedScans: (...a: unknown[]) => getUnsyncedScans(...a),
  markScanSynced: vi.fn(async () => {}),
  clearSyncedScans: vi.fn(async () => {}),
  deletePendingScanLocal: (...a: unknown[]) => deletePendingScanLocal(...a),
  recordLastSuccessfulSyncNow: vi.fn(async () => {}),
  deadLetterScan: (...a: unknown[]) => deadLetterScan(...a),
}));

const dbInsert = vi.fn();
vi.mock('@/lib/db-proxy', () => ({
  dbInsert: (...a: unknown[]) => dbInsert(...a),
  isPermanentDbError: (e: { permanent?: boolean } | null) => e?.permanent === true,
  isCenterLockedDbError: (e: { locked?: boolean; code?: string } | null) =>
    e?.locked === true || e?.code === 'CENTER_LOCKED_SCAN_REJECTED',
}));

import { syncQueuedScans } from '@/lib/sync';

const scan = {
  localId: 1,
  student_id: 's1',
  center_id: 'c1',
  scanned_by: 'u1',
  scanned_at: '2026-08-30T21:00:00.000Z',
};

describe('syncQueuedScans: permanent rejections are dead-lettered, not destroyed', () => {
  beforeEach(() => {
    deadLetterScan.mockClear();
    deletePendingScanLocal.mockClear();
    dbInsert.mockReset();
    getUnsyncedScans.mockReset();
  });

  it('parks a scan taken while locked and removes it from the retry queue (preserved, not deleted)', async () => {
    getUnsyncedScans.mockResolvedValue([scan]);
    dbInsert.mockResolvedValue({
      error: { permanent: true, locked: true, code: 'CENTER_LOCKED_SCAN_REJECTED', message: 'locked' },
    });
    const res = await syncQueuedScans();
    expect(deadLetterScan).toHaveBeenCalledTimes(1);
    expect(deadLetterScan.mock.calls[0]?.[0]).toBe(scan);
    expect(deletePendingScanLocal).toHaveBeenCalledTimes(1);
    expect(res.deadLettered).toBe(1);
    expect(res.centerLocked).toBe(true);
    expect(res.synced).toBe(0);
  });

  it('leaves a transient failure (a 500 with no permanent flag) in the queue and never dead-letters it', async () => {
    getUnsyncedScans.mockResolvedValue([scan]);
    dbInsert.mockResolvedValue({ error: { message: 'Internal Server Error' } });
    const res = await syncQueuedScans();
    expect(deadLetterScan).not.toHaveBeenCalled();
    expect(deletePendingScanLocal).not.toHaveBeenCalled();
    expect(res.errors).toBe(1);
    expect(res.deadLettered).toBe(0);
    expect(res.centerLocked).toBe(false);
  });
});
