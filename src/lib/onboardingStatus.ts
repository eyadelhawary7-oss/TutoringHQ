import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Derives onboarding progress from live data (stall cron uses this vs stored step).
 * Uses `student_groups` and `attendance_scans` (app schema; not `groups` / `attendance_records`).
 */
export async function getOnboardingStep(
  centerId: string,
  supabase: SupabaseClient,
): Promise<number> {
  const { count: studentCount, error: e1 } = await supabase
    .from('students')
    .select('id', { count: 'exact', head: true })
    .eq('center_id', centerId);
  if (e1) throw e1;
  if (!studentCount || studentCount === 0) return 1;

  const { count: groupCount, error: e2 } = await supabase
    .from('student_groups')
    .select('id', { count: 'exact', head: true })
    .eq('center_id', centerId);
  if (e2) throw e2;
  if (!groupCount || groupCount === 0) return 2;

  const { data: center, error: e3 } = await supabase
    .from('centers')
    .select('wa_notifications_enabled, individual_alerts_enabled')
    .eq('id', centerId)
    .maybeSingle();
  if (e3) throw e3;

  const row = center as {
    wa_notifications_enabled?: boolean | null;
    individual_alerts_enabled?: boolean | null;
  } | null;
  const waOn =
    row?.wa_notifications_enabled === true || row?.individual_alerts_enabled === true;
  if (!waOn) return 3;

  const { count: scanCount, error: e4 } = await supabase
    .from('attendance_scans')
    .select('id', { count: 'exact', head: true })
    .eq('center_id', centerId);
  if (e4) throw e4;
  if (!scanCount || scanCount === 0) return 4;

  return 5;
}
