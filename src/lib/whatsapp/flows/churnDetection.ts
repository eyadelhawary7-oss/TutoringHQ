/**
 * Churn detection early warning system — WhatsApp flows
 * Day 3: Inactivity alert to center
 * Day 7: Sales manager alert
 * Day 14: Admin panel flag + sales manager alert
 */

import { createClient } from '@supabase/supabase-js';
import { sendTemplateMessage } from '../client';

const TEMPLATE_DAY3 = 'chq_inactivity_day3';
const TEMPLATE_SALES_ALERT = 'chq_internal_churn_alert';

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface Day3Params {
  centerId: string;
  centerName: string;
  toPhone: string;
  daysInactive: number;
}

/**
 * Send day 3 inactivity alert to center owner.
 * Template chq_inactivity_day3: "مرحباً [center_name]، لاحظنا إنك ما استخدمتش الماسح الضوئي من [X] أيام. في أي مشكلة؟"
 * Buttons: "✅ كل حاجة تمام", "❌ في مشكلة" (defined in Meta template)
 */
export async function sendDay3InactivityAlert(params: Day3Params): Promise<{ success: boolean; error?: string }> {
  const { centerId, centerName, toPhone, daysInactive } = params;
  const variables: Record<string, string> = {
    center_name: centerName,
    days: String(daysInactive),
  };
  const result = await sendTemplateMessage(centerId, toPhone, TEMPLATE_DAY3, variables);
  return { success: result.success, error: result.error };
}

export interface SalesManagerParams {
  centerId: string;
  centerName: string;
  lastScanAt: string | null;
  monthlyFee: number;
  daysInactive: number;
  alertType: 'day7' | 'day14';
}

/**
 * Send churn alert to sales manager.
 * Template chq_internal_churn_alert: center name, last scan, MRR at risk
 */
export async function sendDay7SalesManagerAlert(params: SalesManagerParams): Promise<{ success: boolean; error?: string }> {
  const salesPhone = process.env.SALES_MANAGER_PHONE;
  if (!salesPhone) {
    console.warn('[churnDetection] SALES_MANAGER_PHONE not set, skipping sales manager alert');
    return { success: false, error: 'SALES_MANAGER_PHONE not set' };
  }

  const { centerId, centerName, lastScanAt, monthlyFee, daysInactive, alertType } = params;
  const lastScanStr = lastScanAt
    ? new Date(lastScanAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    : 'لا يوجد';
  const mrrStr = `${Number(monthlyFee).toLocaleString('en-US')} ج.م`;

  const variables: Record<string, string> = {
    center_name: centerName,
    last_scan: lastScanStr,
    mrr_at_risk: mrrStr,
    days_inactive: String(daysInactive),
    alert_type: alertType === 'day14' ? '14+ يوم' : '7-14 يوم',
  };

  const result = await sendTemplateMessage(centerId, salesPhone, TEMPLATE_SALES_ALERT, variables);
  return { success: result.success, error: result.error };
}

export interface FlagDay14Params {
  centerId: string;
  centerName: string;
  lastScanAt: string | null;
  daysInactive: number;
}

/**
 * Insert critical_inactivity alert into admin_alerts for admin panel.
 */
export async function flagDay14InAdminPanel(params: FlagDay14Params): Promise<{ success: boolean; error?: string }> {
  const { centerId, centerName, lastScanAt, daysInactive } = params;
  const lastScanStr = lastScanAt
    ? new Date(lastScanAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    : 'لا يوجد';

  const message = `سنتر "${centerName}" بدون استخدام للماسح منذ ${daysInactive} يوم. آخر مسح: ${lastScanStr}`;

  const admin = getSupabaseAdmin();
  const { error } = await (admin as unknown as {
    from: (t: string) => { insert: (d: object) => Promise<{ error: unknown }> };
  })
    .from('admin_alerts')
    .insert({
      center_id: centerId,
      type: 'critical_inactivity',
      message,
      is_resolved: false,
    });

  if (error) {
    return { success: false, error: String(error) };
  }
  return { success: true };
}
