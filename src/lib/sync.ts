import { dbInsert } from './db-proxy';
import {
  getUnsyncedScans,
  markScanSynced,
  clearSyncedScans,
  deletePendingScanLocal,
  recordLastSuccessfulSyncNow,
} from './db';
import { cairoDateKey } from '@/lib/cairo/day';

export type SyncStatus = 'online' | 'offline' | 'syncing';

export async function syncQueuedScans(): Promise<{ synced: number; errors: number }> {
  const unsyncedScans = await getUnsyncedScans();
  let synced = 0;
  let errors = 0;

  for (const scan of unsyncedScans) {
    try {
      const row = scan as Record<string, unknown>;
      if (row.admission_kind === 'fee_exempt') {
        const scanned_at = String(row.scanned_at);
        const sessionDate = cairoDateKey(new Date(scanned_at));
        const groupId = (row.group_id as string | null | undefined) ?? null;

        const scanData: Record<string, unknown> = {
          student_id: row.student_id,
          center_id: row.center_id,
          scanned_by: row.scanned_by,
          scanned_at,
          payment_status_at_scan: 'admitted',
          session_date: sessionDate,
          payment_recorded: false,
          // Fee-exempt admission: nothing is charged. Snapshot 0 so the balance
          // helper (which SUMS charged_fee) never bills this attendance.
          charged_fee: 0,
        };
        if (groupId) scanData.group_id = groupId;

        const { error: attendanceError } = await dbInsert({
          table: 'attendance_scans',
          data: scanData,
          select: false,
        });
        if (attendanceError) throw new Error(attendanceError.message);

        const isLegacySyncQueue = Object.prototype.hasOwnProperty.call(scan, 'synced');
        if (isLegacySyncQueue) {
          await markScanSynced((scan as { localId: number }).localId);
        } else {
          await deletePendingScanLocal((scan as { localId: number }).localId);
        }
        synced++;
        continue;
      }

      if (row.scan_kind === 'late_entry') {
        const scanned_at = String(row.scanned_at);
        const sessionDate = scanned_at.split('T')[0];
        const fee = Number(row.late_fee ?? 0);
        const groupId = (row.late_group_id as string | null | undefined) ?? null;

        const { error: scanErrLate } = await dbInsert({
          table: 'attendance_scans',
          data: {
            student_id: row.student_id,
            center_id: row.center_id,
            scanned_by: row.scanned_by,
            scanned_at,
            payment_status_at_scan: 'unpaid',
            session_date: sessionDate,
            payment_recorded: false,
            group_id: groupId,
            // Late entry owes the session fee. Snapshot it as the charge; the
            // paired 'late' payments row is an assessment, not a collection, so
            // it is excluded from PAID_PAYMENT_STATUSES and does not offset this.
            charged_fee: fee,
          },
          select: false,
        });
        if (scanErrLate) throw new Error(scanErrLate.message);

        const { error: payLateErr } = await dbInsert({
          table: 'payments',
          data: {
            student_id: row.student_id,
            center_id: row.center_id,
            amount: fee,
            method: 'late_entry',
            recorded_by: row.scanned_by,
            paid_at: scanned_at,
            status: 'late',
            confirmed: false,
            group_id: groupId,
          },
          select: false,
        });
        if (payLateErr) throw new Error(payLateErr.message);

        const isLegacySyncQueue = Object.prototype.hasOwnProperty.call(scan, 'synced');
        if (isLegacySyncQueue) {
          await markScanSynced((scan as { localId: number }).localId);
        } else {
          await deletePendingScanLocal((scan as { localId: number }).localId);
        }
        synced++;
        continue;
      }

      // Insert attendance record
      const scanData: Record<string, unknown> = {
        student_id: scan.student_id,
        center_id: scan.center_id,
        scanned_by: scan.scanned_by,
        scanned_at: scan.scanned_at,
      };
      if (scan.payment_action) {
        scanData.payment_status_at_scan = 'unpaid';
        scanData.payment_method = scan.payment_action.method;
        scanData.session_date = new Date(scan.scanned_at).toISOString().split('T')[0];
        scanData.payment_recorded = true;
        if ((scan.payment_action as { group_id?: string }).group_id) {
          scanData.group_id = (scan.payment_action as { group_id?: string }).group_id;
        }
        // Snapshot the SESSION FEE (group fee_per_class at scan time), NOT the
        // payment amount — a partial payment must still leave a balance, an
        // overpayment a credit. The payment amount is recorded on the payments
        // row below; the charge is frozen here so later group price edits /
        // deletion never rewrite this session's cost.
        scanData.charged_fee = Number((scan.payment_action as { session_fee?: number }).session_fee ?? 0);
      }
      const { error: attendanceError } = await dbInsert({
        table: 'attendance_scans',
        data: scanData,
        select: false,
      });

      if (attendanceError) throw new Error(attendanceError.message);

      // If there was a payment action, record it (per-session: payments table is source of truth)
      if (scan.payment_action) {
        const method = String((scan.payment_action as { method?: string }).method ?? '').toLowerCase();
        const isCash = method === 'cash' || method === 'نقدي';
        const isPending = isCash ? false : ((scan.payment_action as { isPending?: boolean }).isPending ?? false);
        const groupId = (scan.payment_action as { group_id?: string }).group_id;
        const payData: Record<string, unknown> = {
          student_id: scan.student_id,
          center_id: scan.center_id,
          amount: scan.payment_action.amount,
          method: method === 'نقدي' ? 'cash' : scan.payment_action.method,
          recorded_by: scan.scanned_by,
          paid_at: scan.scanned_at,
          status: isCash ? 'confirmed' : (isPending ? 'pending' : 'confirmed'),
          confirmed: isCash || !(scan.payment_action as { isPending?: boolean }).isPending,
          confirmed_at: isCash ? scan.scanned_at : undefined,
        };
        if (groupId) payData.group_id = groupId;
        await dbInsert({
          table: 'payments',
          data: payData,
          select: false,
        });
      }

      const isLegacySyncQueue = Object.prototype.hasOwnProperty.call(scan, 'synced');

      if (isLegacySyncQueue) {
        await markScanSynced((scan as { localId: number }).localId);
      } else {
        await deletePendingScanLocal((scan as { localId: number }).localId);
      }
      synced++;
    } catch {
      errors++;
    }
  }

  // Clean up synced records
  if (synced > 0) {
    await clearSyncedScans();
    await recordLastSuccessfulSyncNow();
  }

  return { synced, errors };
}
