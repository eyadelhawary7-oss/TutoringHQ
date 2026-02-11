import { supabase } from './supabase';
import { getUnsyncedScans, markScanSynced, clearSyncedScans } from './db';

export type SyncStatus = 'online' | 'offline' | 'syncing';

export async function syncQueuedScans(): Promise<{ synced: number; errors: number }> {
  const unsyncedScans = await getUnsyncedScans();
  let synced = 0;
  let errors = 0;

  for (const scan of unsyncedScans) {
    try {
      // Insert attendance record
      const { error: attendanceError } = await supabase
        .from('attendance_scans')
        .insert({
          student_id: scan.student_id,
          center_id: scan.center_id,
          scanned_by: scan.scanned_by,
          scanned_at: scan.scanned_at,
        });

      if (attendanceError) throw attendanceError;

      // If there was a payment action, process it
      if (scan.payment_action) {
        // Update student payment status
        await supabase
          .from('students')
          .update({
            payment_status: 'paid',
            last_paid_date: scan.scanned_at,
          })
          .eq('id', scan.student_id);

        // Create payment record
        await supabase.from('payments').insert({
          student_id: scan.student_id,
          center_id: scan.center_id,
          amount: scan.payment_action.amount,
          payment_method: scan.payment_action.method,
          payment_date: scan.scanned_at,
          created_by: scan.scanned_by,
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
