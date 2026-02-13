import { dbInsert, dbUpdate } from './db-proxy';
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
      }
      const { error: attendanceError } = await dbInsert({
        table: 'attendance_scans',
        data: scanData,
        select: false,
      });

      if (attendanceError) throw new Error(attendanceError.message);

      // If there was a payment action, process it
      if (scan.payment_action) {
        const isPending = (scan.payment_action as { isPending?: boolean }).isPending ?? false;
        const paymentStatus = isPending ? 'pending' : 'paid';

        await dbUpdate({
          table: 'students',
          data: {
            payment_status: paymentStatus,
            ...(paymentStatus === 'paid' ? { last_paid_date: scan.scanned_at } : {}),
          },
          filters: [{ column: 'id', op: 'eq', value: scan.student_id }],
        });

        await dbInsert({
          table: 'payments',
          data: {
            student_id: scan.student_id,
            center_id: scan.center_id,
            amount: scan.payment_action.amount,
            payment_method: scan.payment_action.method,
            payment_date: scan.scanned_at,
            created_by: scan.scanned_by,
            status: paymentStatus,
            confirmed: !scan.payment_action.isPending,
          },
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
