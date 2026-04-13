/**
 * Parent communication suite — WhatsApp flows
 * Scan notifications, weekly summaries, absence alerts, balance alerts
 */

import { createClient } from '@supabase/supabase-js';
import { formatNumber } from '@/lib/formatNumber';
import { sendTemplateMessage, normalizePhone } from '../client';

const TEMPLATE_SCAN = 'chq_scan_notification';
const TEMPLATE_ABSENCE = 'chq_absence_alert';
const TEMPLATE_BALANCE = 'chq_balance_alert';

const STATUS_AR: Record<string, string> = {
  attended: 'حضر ✅',
  absent: 'غائب ❌',
  pending_payment: 'حضر — في انتظار تأكيد الدفع 💛',
};

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
}

/**
 * Send scan notification to parent.
 * Template chq_scan_notification: student name, status (حضر ✅ / غائب ❌ / حضر — في انتظار تأكيد الدفع 💛)
 */
export async function sendScanNotification(
  params: SendScanNotificationParams
): Promise<{ success: boolean; error?: string }> {
  const admin = getSupabaseAdmin();
  const { data: student } = await admin
    .from('students')
    .select('id, name, parent_phone, parent_consent_given, notify_on_scan, center_id')
    .eq('id', params.studentId)
    .single();

  const s = student as {
    parent_phone?: string | null;
    parent_consent_given?: boolean;
    notify_on_scan?: boolean;
    name?: string | null;
    center_id?: string;
  } | null;

  if (!s?.parent_phone || !s.parent_consent_given || s.notify_on_scan === false) {
    return { success: false, error: 'Parent not consented or notifications disabled' };
  }

  const variables: Record<string, string> = {
    '1': s.name ?? '',
    '2': STATUS_AR[params.result] ?? params.result,
  };

  const result = await sendTemplateMessage(s.center_id!, s.parent_phone, TEMPLATE_SCAN, variables);
  return { success: result.success, error: result.error };
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

export interface SendAbsenceAlertParams {
  studentId: string;
  sessionTime: string;
}

/**
 * Send absence alert to parent with center phone for callback.
 */
export async function sendAbsenceAlert(
  params: SendAbsenceAlertParams
): Promise<{ success: boolean; error?: string }> {
  const admin = getSupabaseAdmin();
  const { data: row } = await admin
    .from('students')
    .select('id, name, parent_phone, parent_consent_given, notify_on_absence, center_id')
    .eq('id', params.studentId)
    .single();

  const s = row as {
    parent_phone?: string | null;
    parent_consent_given?: boolean;
    notify_on_absence?: boolean;
    name?: string | null;
    center_id?: string;
  } | null;

  if (!s?.parent_phone || !s.parent_consent_given || s.notify_on_absence === false) {
    return { success: false, error: 'Parent not consented or absence notifications disabled' };
  }

  const { data: center } = await admin
    .from('centers')
    .select('phone')
    .eq('id', s.center_id)
    .single();

  const centerPhone = (center as { phone?: string | null } | null)?.phone ?? '';

  const variables: Record<string, string> = {
    '1': s.name ?? '',
    '2': params.sessionTime,
    '3': centerPhone,
  };

  const result = await sendTemplateMessage(s.center_id!, s.parent_phone, TEMPLATE_ABSENCE, variables);
  return { success: result.success, error: result.error };
}

export interface SendBalanceAlertParams {
  studentId: string;
  balanceDue: number;
}

/**
 * Send balance alert only if balance > threshold.
 */
export async function sendBalanceAlert(
  params: SendBalanceAlertParams
): Promise<{ success: boolean; error?: string }> {
  const admin = getSupabaseAdmin();
  const { data: student } = await admin
    .from('students')
    .select('id, name, parent_phone, parent_consent_given, notify_on_balance, balance_alert_threshold, center_id')
    .eq('id', params.studentId)
    .single();

  const s = student as {
    parent_phone?: string | null;
    parent_consent_given?: boolean;
    notify_on_balance?: boolean;
    balance_alert_threshold?: number | null;
    name?: string | null;
    center_id?: string;
  } | null;

  if (!s?.parent_phone || !s.parent_consent_given || s.notify_on_balance === false) {
    return { success: false, error: 'Parent not consented or balance notifications disabled' };
  }

  const threshold = Number(s.balance_alert_threshold ?? 100);
  if (params.balanceDue <= threshold) {
    return { success: false, error: 'Balance below threshold' };
  }

  const variables: Record<string, string> = {
    '1': s.name ?? '',
    '2': formatNumber(params.balanceDue, 'ar'),
  };

  const result = await sendTemplateMessage(s.center_id!, s.parent_phone, TEMPLATE_BALANCE, variables);
  return { success: result.success, error: result.error };
}
