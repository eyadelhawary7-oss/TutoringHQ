/**
 * Parent communication suite — WhatsApp flows
 * Scan notifications, weekly summaries
 */

import { createClient } from '@supabase/supabase-js';
import { formatNumber, formatTime } from '@/lib/formatNumber';
import { cairoYmdParts } from '@/lib/packBilling';
import { sendTemplateMessage } from '../client';

const TEMPLATE_SCAN = 'chq_scan_notification';

const CAIRO_TZ = 'Africa/Cairo';

function cairoCalendarDate(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: CAIRO_TZ });
}

/** First UTC instant when Africa/Cairo local calendar date is `ymd` (YYYY-MM-DD). */
function cairoStartOfDayUtcIso(ymd: string): string {
  const [y, mo, d] = ymd.split('-').map((x) => parseInt(x, 10)) as [number, number, number];
  let lo = Date.UTC(y, mo - 1, d - 1, 0, 0, 0);
  let hi = Date.UTC(y, mo - 1, d + 1, 0, 0, 0);
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const cm = cairoCalendarDate(new Date(mid));
    if (cm < ymd) lo = mid + 1;
    else hi = mid;
  }
  return new Date(lo).toISOString();
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type ScanResult = 'attended' | 'absent' | 'pending_payment';

export interface SendScanNotificationParams {
  studentId: string;
  result: ScanResult;
  /** ISO timestamp of this scan (for once-per-day dedupe and template time). */
  scannedAt: string;
  /** Authenticated center; must match the student's center. */
  centerId: string;
}

/**
 * Send scan notification to parent (Parent Pack only).
 * Template chq_scan_notification: name, center, time (القاهرة), monthly scan count.
 */
export async function sendScanNotification(
  params: SendScanNotificationParams,
): Promise<{ sent: boolean; reason?: string }> {
  const admin = getSupabaseAdmin();
  const { data: student } = await admin
    .from('students')
    .select(
      'id, name, parent_phone, parent_consent_given, notify_on_scan, center_id, parent_pack_opted_in',
    )
    .eq('id', params.studentId)
    .single();

  const s = student as {
    parent_phone?: string | null;
    parent_consent_given?: boolean;
    notify_on_scan?: boolean;
    name?: string | null;
    center_id?: string;
    parent_pack_opted_in?: boolean | null;
  } | null;

  if (!s?.center_id || s.center_id !== params.centerId) {
    return { sent: false, reason: 'wrong_center' };
  }

  if (!s.parent_phone || !s.parent_consent_given || s.notify_on_scan === false) {
    return { sent: false, reason: 'parent_not_notifiable' };
  }

  const { data: centerRow } = await admin
    .from('centers')
    .select('name, parent_pack_enabled')
    .eq('id', s.center_id)
    .single();

  const center = centerRow as {
    name?: string | null;
    parent_pack_enabled?: boolean | null;
  } | null;

  const packActive =
    center?.parent_pack_enabled === true && s.parent_pack_opted_in === true;
  if (!packActive) {
    return { sent: false, reason: 'not_pack_member' };
  }

  const todayCairo = new Date().toLocaleDateString('en-CA', { timeZone: CAIRO_TZ });
  const startTodayIso = cairoStartOfDayUtcIso(todayCairo);
  const scannedAtMs = new Date(params.scannedAt).getTime();
  if (!Number.isFinite(scannedAtMs)) {
    return { sent: false, reason: 'invalid_scanned_at' };
  }

  const { data: priorToday } = await admin
    .from('attendance_scans')
    .select('id')
    .eq('student_id', params.studentId)
    .gte('scanned_at', startTodayIso)
    .lt('scanned_at', params.scannedAt)
    .limit(1);

  if ((priorToday ?? []).length > 0) {
    return { sent: false, reason: 'already_notified_today' };
  }

  const { y, m } = cairoYmdParts();
  const monthFirstYmd = `${y}-${String(m).padStart(2, '0')}-01`;
  const monthStartIso = cairoStartOfDayUtcIso(monthFirstYmd);

  const { count: monthScanCount, error: countErr } = await admin
    .from('attendance_scans')
    .select('*', { count: 'exact', head: true })
    .eq('student_id', params.studentId)
    .gte('scanned_at', monthStartIso);

  if (countErr) {
    console.error('[sendScanNotification] attendance_scans count', countErr);
    return { sent: false, reason: 'count_failed' };
  }

  const scanTime = formatTime(new Date(params.scannedAt), 'ar');
  const monthTotal = formatNumber(Number(monthScanCount ?? 0), 'ar', {
    useGrouping: false,
    maximumFractionDigits: 0,
  });

  const variables: Record<string, string> = {
    '1': s.name ?? '',
    '2': center?.name?.trim() ? String(center.name) : '',
    '3': scanTime,
    '4': monthTotal,
  };

  const sendResult = await sendTemplateMessage(s.center_id, s.parent_phone, TEMPLATE_SCAN, variables);
  if (sendResult.success) return { sent: true };
  return { sent: false, reason: sendResult.error ?? 'send_failed' };
}

export interface SendWeeklyAttendanceSummaryParams {
  centerId: string;
}

/**
 * Send weekly attendance summary to all consented parents.
 * For each student: 7-day attendance %
 */
export async function sendWeeklyAttendanceSummary(
  params: SendWeeklyAttendanceSummaryParams
): Promise<{ sent: number; errors: string[] }> {
  const admin = getSupabaseAdmin();
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const { data: students } = await admin
    .from('students')
    .select('id, name, parent_phone, parent_consent_given')
    .eq('center_id', params.centerId)
    .eq('parent_consent_given', true)
    .not('parent_phone', 'is', null);

  const list = (students ?? []) as { id: string; name?: string | null; parent_phone?: string | null }[];
  const errors: string[] = [];
  let sent = 0;

  for (const st of list) {
    if (!st.parent_phone) continue;

    const { data: scans } = await admin
      .from('attendance_scans')
      .select('scanned_at')
      .eq('student_id', st.id)
      .gte('scanned_at', weekAgo.toISOString());

    const scanDates = new Set(
      (scans ?? []).map((r: { scanned_at: string }) => (r.scanned_at as string).slice(0, 10))
    );
    const pct = Math.min(100, Math.round((scanDates.size / 7) * 100));

    const variables: Record<string, string> = {
      '1': st.name ?? '',
      '2': String(pct),
    };

    const result = await sendTemplateMessage(params.centerId, st.parent_phone, 'chq_weekly_summary', variables);
    if (result.success) sent++;
    else errors.push(`${st.id}: ${result.error}`);
  }

  return { sent, errors };
}
