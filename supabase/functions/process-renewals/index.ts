// Supabase Edge Function: process-renewals
// Invoked by pg_cron daily at 7am UTC
// For each active center: days_until = renewal_date - today
// Stages: T_MINUS_7, T_MINUS_3, T_ZERO, T_PLUS_3, T_PLUS_7, T_PLUS_9
// Checks renewal_reminders_sent before sending

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CenterRow {
  id: string;
  name: string;
  phone: string | null;
  subscription_renewal_date: string | null;
  subscription_monthly_fee: number | null;
  subscription_billing_period: string | null;
  subscription_status: string | null;
  summer_mode?: boolean;
}

type Stage = 'T_MINUS_7' | 'T_MINUS_3' | 'T_ZERO' | 'T_PLUS_3' | 'T_PLUS_7' | 'T_PLUS_9';

function getStageForDays(daysUntil: number): Stage | null {
  if (daysUntil === 7) return 'T_MINUS_7';
  if (daysUntil === 3) return 'T_MINUS_3';
  if (daysUntil === 0) return 'T_ZERO';
  if (daysUntil === -3) return 'T_PLUS_3';
  if (daysUntil === -7) return 'T_PLUS_7';
  if (daysUntil === -9) return 'T_PLUS_9';
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const appUrl = Deno.env.get('APP_URL') || 'https://center-hq.vercel.app';

  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(
      JSON.stringify({ error: 'Missing Supabase config' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const today = new Date().toISOString().slice(0, 10);
  const sentMonth = today.slice(0, 7) + '-01';

  // 1. Fetch active centers with subscription_renewal_date (exclude cancelled/suspended for reminders)
  const { data: centers, error: centersError } = await supabase
    .from('centers')
    .select('id, name, phone, subscription_renewal_date, subscription_monthly_fee, subscription_billing_period, subscription_status, summer_mode')
    .in('subscription_status', ['active', 'overdue'])
    .not('subscription_renewal_date', 'is', null)
    .not('phone', 'is', null);

  if (centersError || !centers?.length) {
    return new Response(
      JSON.stringify({ ok: true, processed: 0, message: 'No centers to process' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // 2. Get already-sent reminders this month
  const { data: sentRows } = await supabase
    .from('renewal_reminders_sent')
    .select('center_id, stage')
    .eq('sent_month', sentMonth);

  const sentSet = new Set<string>();
  for (const r of sentRows ?? []) {
    sentSet.add(`${(r as { center_id: string }).center_id}:${(r as { stage: string }).stage}`);
  }

  // 3. Build actions
  const actions: Array<{
    centerId: string;
    center: CenterRow;
    stage: Stage;
    updateStatus?: boolean;
    alertSales?: boolean;
  }> = [];

  for (const c of centers as CenterRow[]) {
    const renewalDate = c.subscription_renewal_date;
    if (!renewalDate) continue;

    const renewal = new Date(renewalDate + 'T12:00:00');
    const todayDate = new Date(today + 'T12:00:00');
    const diffMs = renewal.getTime() - todayDate.getTime();
    const daysUntil = Math.round(diffMs / (24 * 60 * 60 * 1000));

    const stage = getStageForDays(daysUntil);
    if (!stage) continue;

    const key = `${c.id}:${stage}`;
    if (sentSet.has(key)) continue;

    actions.push({
      centerId: c.id,
      center: c,
      stage,
      updateStatus: stage === 'T_PLUS_3',
      alertSales: stage === 'T_PLUS_9',
    });
  }

  if (actions.length === 0) {
    return new Response(
      JSON.stringify({ ok: true, processed: 0, actions: 0 }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // 4. Call Next.js API
  let processed = 0;
  try {
    const res = await fetch(`${appUrl}/api/cron/process-renewals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({ actions, sentMonth }),
    });

    const data = (await res.json().catch(() => ({}))) as { processed?: number };
    processed = data.processed ?? 0;
  } catch (err) {
    console.error('[process-renewals] API error:', err);
  }

  return new Response(
    JSON.stringify({ ok: true, processed, actions: actions.length }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
