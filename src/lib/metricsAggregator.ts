import 'server-only';

import { supabaseAdmin } from '@/lib/supabase-admin';

export type MetricEvent = 'scan' | 'login' | 'payment' | 'student_approved';

export interface UpsertMetricsParams {
  centerId: string;
  event: MetricEvent;
  eventAt?: string;
}

export async function upsertDailyMetrics({
  centerId,
  event,
  eventAt,
}: UpsertMetricsParams): Promise<void> {
  try {
    if (!supabaseAdmin) return;

    const now = eventAt ?? new Date().toISOString();
    const today = now.slice(0, 10);

    if (event === 'scan') {
      const { error } = await supabaseAdmin.rpc('upsert_scan_metric', {
        p_center_id: centerId,
        p_scanned_at: now,
        p_metric_date: today,
      });
      if (error) console.error(error);
      return;
    }

    if (event === 'login') {
      const { error } = await supabaseAdmin
        .from('center_metrics_daily')
        .upsert(
          {
            center_id: centerId,
            metric_date: today,
            logins_count: 1,
            last_login_at: now,
            last_upserted_at: now,
          },
          { onConflict: 'center_id,metric_date' },
        );
      if (error) console.error(error);
      return;
    }

    if (event === 'payment') {
      const { error } = await supabaseAdmin
        .from('center_metrics_daily')
        .upsert(
          {
            center_id: centerId,
            metric_date: today,
            payments_recorded: 1,
            last_payment_at: now,
            last_upserted_at: now,
          },
          { onConflict: 'center_id,metric_date' },
        );
      if (error) console.error(error);
      return;
    }

    if (event === 'student_approved') return;
  } catch (e) {
    console.error(e);
  }
}

export async function stampCenterScanTimestamps(
  centerId: string,
  scannedAt: string,
): Promise<void> {
  try {
    if (!supabaseAdmin) return;

    const { data, error } = await supabaseAdmin
      .from('centers')
      .select('first_scan_at')
      .eq('id', centerId)
      .single();

    if (error) {
      console.error(error);
      return;
    }

    const { error: updateError } = await supabaseAdmin
      .from('centers')
      .update({
        last_scan_at: scannedAt,
        first_scan_at: data.first_scan_at ?? scannedAt,
      })
      .eq('id', centerId);

    if (updateError) console.error(updateError);
  } catch (e) {
    console.error(e);
  }
}
