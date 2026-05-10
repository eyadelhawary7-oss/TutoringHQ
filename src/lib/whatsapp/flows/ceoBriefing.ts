/**
 * CEO daily briefing — 7am UTC (9am Cairo)
 * Template: chq_ceo_briefing
 * Variables: 1=date, 2=activeCenters, 3=mrr, 4=newYesterday, 5=churned, 6=atRisk, 7=renewalsThisWeek
 */

import { createClient } from '@supabase/supabase-js';
import { isTemplateApproved } from '@/lib/centerNotify';
import { formatDate, formatNumber } from '@/lib/formatNumber';
import { sendTemplateMessage } from '../client';
import { getImpliedMonthlyMrr, normalizeBillingPeriod, PLANS, type PlanKey } from '@/lib/pricing';

const WA_AR = 'ar';

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
  return formatDate(new Date(), WA_AR, {
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

  if (!(await isTemplateApproved(TEMPLATE, supabase))) {
    return { success: true };
  }

  const variables: Record<string, string> = {
    '1': formatDateArabic(),
    '2': formatNumber(data.activeCenters, WA_AR),
    '3': formatNumber(data.mrr, WA_AR),
    '4': formatNumber(data.newYesterday, WA_AR),
    '5': formatNumber(data.churned, WA_AR),
    '6': formatNumber(data.atRisk, WA_AR),
    '7': formatNumber(data.renewalsThisWeek, WA_AR),
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
    supabase.from('mrr_snapshots').select('total_mrr').order('snapshot_date', { ascending: false }).limit(1).maybeSingle(),
  ]);

  let mrr = Number((mrrRes.data as { total_mrr?: number } | null)?.total_mrr ?? 0);
  if (mrr === 0) {
    const { data: centers } = await supabase
      .from('centers')
      .select('subscription_monthly_fee, early_adopter_price, billing_amount, billing_period, all_in_price, plan')
      .in('subscription_status', ['active', 'overdue'])
      .eq('status', 'active');
    mrr = (centers ?? []).reduce(
      (
        s: number,
        c: {
          subscription_monthly_fee?: number;
          early_adopter_price?: number;
          billing_amount?: number;
          billing_period?: string | null;
          all_in_price?: number | null;
          plan?: string;
        },
      ) => {
        const pk = (String(c.plan || 'starter').toLowerCase() in PLANS ? String(c.plan || 'starter').toLowerCase() : 'starter') as PlanKey;
        let baseQ = 0;
        if (c.all_in_price != null && Number(c.all_in_price) > 0) {
          baseQ = Number(c.all_in_price);
        } else if (c.billing_amount != null && Number(c.billing_amount) > 0) {
          baseQ = Math.round(Number(c.billing_amount) / 3);
        } else if (typeof c.subscription_monthly_fee === 'number' && c.subscription_monthly_fee > 0) {
          baseQ = c.subscription_monthly_fee;
        } else {
          baseQ = PLANS[pk].quarterlyAllIn;
        }
        const fee = getImpliedMonthlyMrr(baseQ, normalizeBillingPeriod(c.billing_period), pk);
        return s + Number(fee);
      },
      0,
    );
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
