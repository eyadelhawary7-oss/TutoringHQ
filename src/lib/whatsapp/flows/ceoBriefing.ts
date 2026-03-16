/**
 * CEO daily briefing — 7am UTC (9am Cairo)
 * Template: chq_ceo_briefing
 * Variables: 1=date, 2=activeCenters, 3=mrr, 4=newYesterday, 5=churned, 6=atRisk, 7=renewalsThisWeek
 */

import { createClient } from '@supabase/supabase-js';
import { sendTemplateMessage } from '../client';

const TEMPLATE = 'chq_ceo_briefing';

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function formatDateArabic(): string {
  const now = new Date();
  return now.toLocaleDateString('ar-EG', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export interface CeoBriefingData {
  activeCenters: number;
  mrr: number;
  newYesterday: number;
  churned: number;
  atRisk: number;
  renewalsThisWeek: number;
}

export async function sendCeoBriefing(data: CeoBriefingData): Promise<{ success: boolean; error?: string }> {
  const ceoPhone = process.env.CEO_PHONE;
  if (!ceoPhone) {
    return { success: false, error: 'CEO_PHONE not set' };
  }

  const supabase = getSupabaseAdmin();
  const { data: firstCenter } = await supabase.from('centers').select('id').limit(1).maybeSingle();
  const centerId = (firstCenter as { id: string } | null)?.id;
  if (!centerId) {
    return { success: false, error: 'No center found for logging' };
  }

  const variables: Record<string, string> = {
    '1': formatDateArabic(),
    '2': String(data.activeCenters),
    '3': data.mrr.toLocaleString('en-US'),
    '4': String(data.newYesterday),
    '5': String(data.churned),
    '6': String(data.atRisk),
    '7': String(data.renewalsThisWeek),
  };

  const result = await sendTemplateMessage(centerId, ceoPhone, TEMPLATE, variables);
  return result;
}

export async function fetchCeoBriefingData(): Promise<CeoBriefingData> {
  const supabase = getSupabaseAdmin();
  const now = new Date();
  const yesterdayStart = new Date(now);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  yesterdayStart.setHours(0, 0, 0, 0);
  const yesterdayEnd = new Date(yesterdayStart);
  yesterdayEnd.setHours(23, 59, 59, 999);

  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekStartStr = weekStart.toISOString().slice(0, 10);
  const weekEndStr = weekEnd.toISOString().slice(0, 10);

  const [
    activeRes,
    newYesterdayRes,
    churnedRes,
    atRiskRes,
    renewalsRes,
    mrrRes,
  ] = await Promise.all([
    supabase.from('centers').select('id', { count: 'exact', head: true }).in('subscription_status', ['active', 'overdue']).eq('status', 'active'),
    supabase.from('centers').select('id').eq('status', 'active').gte('created_at', yesterdayStart.toISOString()).lte('created_at', yesterdayEnd.toISOString()),
    supabase.from('centers').select('id').in('subscription_status', ['suspended', 'cancelled']).gte('updated_at', yesterdayStart.toISOString()),
    supabase.from('centers').select('id').eq('status', 'active').in('health_score_band', ['At Risk', 'Critical']),
    supabase.from('centers').select('id').in('subscription_status', ['active', 'overdue']).eq('status', 'active').gte('subscription_renewal_date', weekStartStr).lte('subscription_renewal_date', weekEndStr),
    supabase.from('mrr_snapshots').select('mrr').order('date', { ascending: false }).limit(1).maybeSingle(),
  ]);

  const planPrices: Partial<Record<string, number>> = {
    nano: 1200, nascent: 1200, starter: 2000, pro: 4500, business: 6500, enterprise: 9000, top_centers: 12000,
  };

  let mrr = (mrrRes.data as { mrr?: number } | null)?.mrr ?? 0;
  if (mrr === 0) {
    const { data: centers } = await supabase
      .from('centers')
      .select('subscription_monthly_fee, early_adopter_price, billing_amount, plan')
      .in('subscription_status', ['active', 'overdue'])
      .eq('status', 'active');
    mrr = (centers ?? []).reduce((s: number, c: { subscription_monthly_fee?: number; early_adopter_price?: number; billing_amount?: number; plan?: string }) => {
      const fee = c.subscription_monthly_fee ?? c.early_adopter_price ?? (c.billing_amount != null ? c.billing_amount / 3 : undefined) ?? planPrices[c.plan ?? 'starter'] ?? 2000;
      return s + Number(fee);
    }, 0);
  }

  return {
    activeCenters: activeRes.count ?? 0,
    mrr,
    newYesterday: (newYesterdayRes.data ?? []).length,
    churned: (churnedRes.data ?? []).length,
    atRisk: (atRiskRes.data ?? []).length,
    renewalsThisWeek: (renewalsRes.data ?? []).length,
  };
}
