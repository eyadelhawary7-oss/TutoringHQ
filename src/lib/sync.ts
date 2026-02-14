import { dbInsert } from './db-proxy';
import { getUnsyncedScans, markScanSynced, clearSyncedScans } from './db';

export type SyncStatus = 'online' | 'offline' | 'syncing';

export async function syncQueuedScans(): Promise<{ synced: number; errors: number }> {
  const unsyncedScans = await getUnsyncedScans();
  let synced = 0;
  let errors = 0;

  for (const scan of unsyncedScans) {
    try {
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
        if ((scan.payment_action as { group_id?: string }).group_id) {
          scanData.group_id = (scan.payment_action as { group_id?: string }).group_id;
        }
      }
      const { error: attendanceError } = await dbInsert({
        table: 'attendance_scans',
        data: scanData,
        select: false,
      });

      if (attendanceError) throw new Error(attendanceError.message);

      // If there was a payment action, record it (per-session: payments table is source of truth)
      if (scan.payment_action) {
        const isPending = (scan.payment_action as { isPending?: boolean }).isPending ?? false;
        const groupId = (scan.payment_action as { group_id?: string }).group_id;
        const payData: Record<string, unknown> = {
          student_id: scan.student_id,
          center_id: scan.center_id,
          amount: scan.payment_action.amount,
          payment_method: scan.payment_action.method,
          payment_date: scan.scanned_at,
          created_by: scan.scanned_by,
          status: isPending ? 'pending' : 'paid',
          confirmed: !scan.payment_action.isPending,
        };
        if (groupId) payData.group_id = groupId;
        await dbInsert({
          table: 'payments',
          data: payData,
          select: false,
        });
      }

      await markScanSynced(scan.localId);
      synced++;
    } catch {
      errors++;
    }
  }

  // Clean up synced records
  if (synced > 0) {
    await clearSyncedScans();
  }

  return { synced, errors };
}
