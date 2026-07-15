/**
 * Checklist attendance write-path tests.
 *
 * The checklist is a second input method into the SAME attendance pipeline as
 * the QR scanner. These tests pin the contract that keeps that true:
 *
 *   - A tap with NO payment method chosen never reaches the queue
 *     (`buildChecklistScanPayload` → null, `commitChecklistAttendance` →
 *     queueScan NOT called). This is the "not saved until method" rule.
 *   - cash / instapay / exempt each translate to the exact queueScan payload
 *     the scanner produces (payment_action for cash/instapay, admission_kind
 *     for exempt).
 *   - Offline-safe: queueScan still fires offline, but the network steps
 *     (syncQueuedScans / notifyParentScan) do not.
 *   - The "needs method" counter reads in-memory pending state.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  buildChecklistScanPayload,
  commitChecklistAttendance,
  countNeedsMethod,
  checklistNotifyResult,
  type ChecklistCommitDeps,
  type ChecklistCommitInput,
} from '@/lib/checklist';

const BASE: Omit<ChecklistCommitInput, 'method'> = {
  studentId: 'stu-1',
  centerId: 'center-1',
  userId: 'user-1',
  scannedAt: '2026-06-15T10:00:00.000Z',
  fee: 150,
  groupId: 'group-1',
};

function makeDeps(netOnline: boolean): ChecklistCommitDeps & {
  queueScan: ReturnType<typeof vi.fn>;
  markPaidTodayOffline: ReturnType<typeof vi.fn>;
  syncQueuedScans: ReturnType<typeof vi.fn>;
  notifyParentScan: ReturnType<typeof vi.fn>;
} {
  return {
    queueScan: vi.fn(async () => 1),
    markPaidTodayOffline: vi.fn(async () => {}),
    getUnsyncedCount: vi.fn(async () => 0),
    syncQueuedScans: vi.fn(async () => ({ synced: 1, errors: 0 })),
    notifyParentScan: vi.fn(() => {}),
    netOnline,
  };
}

describe('buildChecklistScanPayload', () => {
  it('returns null when no method is chosen (nothing to queue)', () => {
    expect(buildChecklistScanPayload({ ...BASE, method: null })).toBeNull();
  });

  it('maps cash → confirmed payment_action', () => {
    const p = buildChecklistScanPayload({ ...BASE, method: 'cash' });
    expect(p).toEqual({
      student_id: 'stu-1',
      center_id: 'center-1',
      scanned_by: 'user-1',
      scanned_at: '2026-06-15T10:00:00.000Z',
      payment_action: {
        method: 'cash',
        amount: 150,
        isPending: false,
        group_id: 'group-1',
        session_fee: 150,
      },
    });
    expect(p).not.toHaveProperty('admission_kind');
  });

  it('maps instapay → pending payment_action', () => {
    const p = buildChecklistScanPayload({ ...BASE, method: 'instapay' });
    expect(p?.payment_action).toEqual({
      method: 'instapay',
      amount: 150,
      isPending: true,
      group_id: 'group-1',
      session_fee: 150,
    });
  });

  it('maps exempt → fee-exempt admission with no payment_action', () => {
    const p = buildChecklistScanPayload({ ...BASE, method: 'exempt' });
    expect(p).toEqual({
      student_id: 'stu-1',
      center_id: 'center-1',
      scanned_by: 'user-1',
      scanned_at: '2026-06-15T10:00:00.000Z',
      admission_kind: 'fee_exempt',
      group_id: 'group-1',
    });
    expect(p).not.toHaveProperty('payment_action');
  });

  it('omits group_id from payment_action when group is null', () => {
    const p = buildChecklistScanPayload({ ...BASE, groupId: null, method: 'cash' });
    expect(p?.payment_action?.group_id).toBeUndefined();
  });
});

describe('commitChecklistAttendance — not saved until method chosen', () => {
  it('a tap with NO method never calls queueScan', async () => {
    const deps = makeDeps(true);
    const result = await commitChecklistAttendance(deps, { ...BASE, method: null });

    expect(result.queued).toBe(false);
    expect(deps.queueScan).not.toHaveBeenCalled();
    expect(deps.markPaidTodayOffline).not.toHaveBeenCalled();
    expect(deps.syncQueuedScans).not.toHaveBeenCalled();
    expect(deps.notifyParentScan).not.toHaveBeenCalled();
  });
});

describe('commitChecklistAttendance — method chosen', () => {
  it('cash: queues, marks paid-today, syncs, notifies attended (online)', async () => {
    const deps = makeDeps(true);
    const result = await commitChecklistAttendance(deps, { ...BASE, method: 'cash' });

    expect(result.queued).toBe(true);
    expect(deps.queueScan).toHaveBeenCalledTimes(1);
    expect(deps.queueScan).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_action: expect.objectContaining({ method: 'cash', isPending: false }),
      }),
    );
    expect(deps.markPaidTodayOffline).toHaveBeenCalledWith('center-1', 'stu-1');
    expect(deps.syncQueuedScans).toHaveBeenCalledTimes(1);
    expect(deps.notifyParentScan).toHaveBeenCalledWith('stu-1', 'attended', BASE.scannedAt);
  });

  it('instapay: notifies pending_payment', async () => {
    const deps = makeDeps(true);
    await commitChecklistAttendance(deps, { ...BASE, method: 'instapay' });
    expect(deps.notifyParentScan).toHaveBeenCalledWith('stu-1', 'pending_payment', BASE.scannedAt);
  });

  it('exempt: queues but does NOT mark paid-today', async () => {
    const deps = makeDeps(true);
    await commitChecklistAttendance(deps, { ...BASE, method: 'exempt' });

    expect(deps.queueScan).toHaveBeenCalledWith(
      expect.objectContaining({ admission_kind: 'fee_exempt' }),
    );
    expect(deps.markPaidTodayOffline).not.toHaveBeenCalled();
    expect(deps.notifyParentScan).toHaveBeenCalledWith('stu-1', 'attended', BASE.scannedAt);
  });

  it('offline: queues the row but skips sync + parent notify', async () => {
    const deps = makeDeps(false);
    const result = await commitChecklistAttendance(deps, { ...BASE, method: 'cash' });

    expect(result.queued).toBe(true);
    expect(deps.queueScan).toHaveBeenCalledTimes(1);
    expect(deps.markPaidTodayOffline).toHaveBeenCalledTimes(1);
    expect(deps.syncQueuedScans).not.toHaveBeenCalled();
    expect(deps.notifyParentScan).not.toHaveBeenCalled();
  });

  it('online sync failure is swallowed — row stays queued', async () => {
    const deps = makeDeps(true);
    deps.syncQueuedScans.mockRejectedValueOnce(new Error('network'));
    const result = await commitChecklistAttendance(deps, { ...BASE, method: 'cash' });

    expect(result.queued).toBe(true);
    expect(deps.queueScan).toHaveBeenCalledTimes(1);
  });
});

describe('checklistNotifyResult', () => {
  it('cash and exempt are attended; instapay is pending_payment', () => {
    expect(checklistNotifyResult('cash')).toBe('attended');
    expect(checklistNotifyResult('exempt')).toBe('attended');
    expect(checklistNotifyResult('instapay')).toBe('pending_payment');
  });
});

describe('countNeedsMethod', () => {
  it('counts tapped students that are not yet committed', () => {
    expect(countNeedsMethod(['a', 'b', 'c'], new Set(['b']))).toBe(2);
    expect(countNeedsMethod(['a'], new Set(['a']))).toBe(0);
    expect(countNeedsMethod([], new Set())).toBe(0);
  });
});
