/**
 * Checklist attendance — write helpers.
 *
 * The checklist screen is a SECOND input method into the existing attendance
 * pipeline, NOT a new system. A tapped-then-method-chosen row is translated
 * here into the SAME `queueScan` payload the QR scanner produces
 * (src/app/[locale]/scan/page.tsx), so it inherits offline-safety, the parent
 * WhatsApp notification, and analytics for free.
 *
 * Core rule (enforced here AND in the screen's in-memory state): nothing is
 * queued until a payment method is chosen. A bare tap with no method maps to a
 * null payload and never calls `queueScan` — online or offline.
 */

export type ChecklistMethod = 'cash' | 'instapay' | 'exempt';

/** Payload shape accepted by `queueScan` (src/lib/db.ts). */
export interface ChecklistScanPayload {
  student_id: string;
  center_id: string;
  scanned_by: string;
  scanned_at: string;
  payment_action?: {
    method: string;
    amount: number;
    isPending?: boolean;
    group_id?: string;
    /** Session fee (group fee_per_class) snapshotted into charged_fee at commit. */
    session_fee?: number;
  };
  admission_kind?: 'fee_exempt';
  group_id?: string | null;
}

export interface ChecklistCommitInput {
  studentId: string;
  centerId: string;
  userId: string;
  /** ISO timestamp captured at the moment the method is chosen. */
  scannedAt: string;
  /** null = tapped but no method chosen yet → nothing is queued. */
  method: ChecklistMethod | null;
  /** Per-session fee for the selected group (ignored for 'exempt'). */
  fee: number;
  groupId: string | null;
}

/**
 * Translate a chosen method into the exact `queueScan` payload, mirroring
 * scan/page.tsx:
 *   - 'cash'     → payment_action { method:'cash',     isPending:false } (confirmed)
 *   - 'instapay' → payment_action { method:'instapay', isPending:true  } (pending)
 *   - 'exempt'   → admission_kind:'fee_exempt' (fee-exempt admission, no payment row)
 *
 * Returns `null` when no method is chosen — the caller MUST NOT queue anything.
 */
export function buildChecklistScanPayload(
  input: ChecklistCommitInput,
): ChecklistScanPayload | null {
  if (!input.method) return null;

  const base = {
    student_id: input.studentId,
    center_id: input.centerId,
    scanned_by: input.userId,
    scanned_at: input.scannedAt,
  };

  if (input.method === 'exempt') {
    return { ...base, admission_kind: 'fee_exempt', group_id: input.groupId };
  }

  const isCash = input.method === 'cash';
  return {
    ...base,
    payment_action: {
      method: input.method,
      amount: input.fee,
      isPending: !isCash,
      group_id: input.groupId ?? undefined,
      // Charge snapshot = the session fee (here the checklist always charges the
      // full group fee, so amount === session_fee), frozen at commit time.
      session_fee: input.fee,
    },
  };
}

/**
 * Parent-notify result string, mirroring scan/page.tsx:
 * cash/exempt → 'attended', instapay (unconfirmed) → 'pending_payment'.
 */
export function checklistNotifyResult(
  method: ChecklistMethod,
): 'attended' | 'pending_payment' {
  return method === 'instapay' ? 'pending_payment' : 'attended';
}

export interface ChecklistCommitDeps {
  queueScan: (arg: ChecklistScanPayload) => Promise<number>;
  markPaidTodayOffline: (centerId: string, studentId: string) => Promise<void>;
  getUnsyncedCount: () => Promise<number>;
  syncQueuedScans: () => Promise<{ synced: number; errors: number }>;
  notifyParentScan: (
    studentId: string,
    result: 'attended' | 'absent' | 'pending_payment',
    scannedAt: string,
  ) => void;
  netOnline: boolean;
}

export interface ChecklistCommitResult {
  queued: boolean;
  pendingCount: number | null;
}

/**
 * Commit one checklist row through the shared offline pipeline. Mirrors
 * scan/page.tsx (handlePaymentSelect + fee-exempt path):
 *   1. No method → return { queued:false } WITHOUT touching the queue.
 *   2. queueScan → IndexedDB first (offline-safe).
 *   3. markPaidTodayOffline for paid methods (cash/instapay), NOT for exempt.
 *   4. When online: drain the queue + fire-and-forget parent notify. Sync
 *      failures are swallowed — the row is already queued and retries later.
 */
export async function commitChecklistAttendance(
  deps: ChecklistCommitDeps,
  input: ChecklistCommitInput,
): Promise<ChecklistCommitResult> {
  const payload = buildChecklistScanPayload(input);
  if (!payload || !input.method) {
    // Not saved until a method is chosen — never enters the queue.
    return { queued: false, pendingCount: null };
  }

  await deps.queueScan(payload);

  if (input.method !== 'exempt') {
    await deps.markPaidTodayOffline(input.centerId, input.studentId);
  }

  let pendingCount = await deps.getUnsyncedCount();

  if (deps.netOnline) {
    try {
      await deps.syncQueuedScans();
      deps.notifyParentScan(
        input.studentId,
        checklistNotifyResult(input.method),
        input.scannedAt,
      );
    } catch {
      // Offline-safe: the row is already queued; sync retries on the next drain.
    }
    pendingCount = await deps.getUnsyncedCount();
  }

  return { queued: true, pendingCount };
}

/**
 * Count students tapped present but still missing a payment method — drives the
 * live "N students need a payment method" counter. Reads the screen's in-memory
 * pending set, not the queue.
 */
export function countNeedsMethod(
  pendingIds: Iterable<string>,
  committedIds: ReadonlySet<string>,
): number {
  let n = 0;
  for (const id of pendingIds) {
    if (!committedIds.has(id)) n++;
  }
  return n;
}
