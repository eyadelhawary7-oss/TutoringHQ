// Supabase Edge Function: detect-churn
// Invoked by pg_cron at 2am UTC daily
// Queries centers + attendance_scans, determines inactivity tiers, calls Next.js API for WhatsApp/admin actions

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CenterInfo {
  id: string;
  name: string;
  phone: string | null;
  monthly_fee: number;
  last_scan: string | null;
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

  // 1. Fetch active centers with pricing
  const { data: centers, error: centersError } = await supabase
    .from('centers')
    .select('id, name, phone, early_adopter_price, billing_amount, plan')
    .eq('status', 'active')
    .not('phone', 'is', null);

  if (centersError || !centers?.length) {
    return new Response(
      JSON.stringify({ ok: true, processed: 0, message: 'No active centers' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // 2. Get last scan per center (and monthly fee from pricing_plans if available)
  const { data: plans } = await supabase.from('pricing_plans').select('id, monthly_fee');
  const planFees = new Map<string, number>();
  for (const p of plans ?? []) {
    planFees.set((p as { id: string; monthly_fee: number }).id, Number((p as { monthly_fee: number }).monthly_fee));
  }

  const rows: CenterInfo[] = [];
  for (const c of centers as { id: string; name: string; phone: string | null; early_adopter_price: number | null; billing_amount: number | null; plan: string | null }[]) {
    const { data: lastRow } = await supabase
      .from('attendance_scans')
      .select('scanned_at')
      .eq('center_id', c.id)
      .order('scanned_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const lastScan = (lastRow as { scanned_at?: string } | null)?.scanned_at ?? null;
    const monthlyFee =
      c.early_adopter_price != null
        ? Number(c.early_adopter_price)
        : planFees.get(c.plan ?? '') ?? Number(c.billing_amount ?? 0);

    rows.push({
      id: c.id,
      name: c.name ?? '',
      phone: c.phone,
      monthly_fee: monthlyFee,
      last_scan: lastScan,
    });
  }

  // 3. Build actions and insert wa_inactivity_alerts
  const now = new Date().toISOString();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const actions: Array<{ action: 'day3' | 'day7' | 'day14'; centerId: string; centerName: string; phone: string; lastScanAt: string | null; monthlyFee: number; daysInactive: number }> = [];

  for (const r of rows) {
    const lastScanAt = r.last_scan ? new Date(r.last_scan) : null;
    const daysInactive = lastScanAt
      ? Math.floor((Date.now() - lastScanAt.getTime()) / (24 * 60 * 60 * 1000))
      : 999;

    if (daysInactive < 3 || !r.phone) continue;

    if (daysInactive >= 14) {
      const { data: existing } = await supabase
        .from('wa_inactivity_alerts')
        .select('id')
        .eq('center_id', r.id)
        .eq('alert_type', 'day14')
        .is('resolved_at', null)
        .limit(1);

      if (!existing?.length) {
        await supabase.from('wa_inactivity_alerts').insert({
          center_id: r.id,
          alert_type: 'day14',
          triggered_at: now,
          last_scan_at: r.last_scan,
          monthly_fee: r.monthly_fee,
          alert_sent: false,
        });
        actions.push({
          action: 'day14',
          centerId: r.id,
          centerName: r.name,
          phone: r.phone,
          lastScanAt: r.last_scan,
          monthlyFee: r.monthly_fee,
          daysInactive,
        });
      }
    } else if (daysInactive >= 7) {
      const { data: recent } = await supabase
        .from('wa_inactivity_alerts')
        .select('id')
        .eq('center_id', r.id)
        .eq('alert_type', 'day7')
        .gte('triggered_at', weekAgo)
        .limit(1);

      if (!recent?.length) {
        await supabase.from('wa_inactivity_alerts').insert({
          center_id: r.id,
          alert_type: 'day7',
          triggered_at: now,
          last_scan_at: r.last_scan,
          monthly_fee: r.monthly_fee,
          alert_sent: false,
        });
        actions.push({
          action: 'day7',
          centerId: r.id,
          centerName: r.name,
          phone: r.phone,
          lastScanAt: r.last_scan,
          monthlyFee: r.monthly_fee,
          daysInactive,
        });
      }
    } else {
      const { data: recent } = await supabase
        .from('wa_inactivity_alerts')
        .select('id')
        .eq('center_id', r.id)
        .eq('alert_type', 'day3')
        .gte('triggered_at', weekAgo)
        .limit(1);

      if (!recent?.length) {
        await supabase.from('wa_inactivity_alerts').insert({
          center_id: r.id,
          alert_type: 'day3',
          triggered_at: now,
          last_scan_at: r.last_scan,
          monthly_fee: r.monthly_fee,
          alert_sent: false,
        });
        actions.push({
          action: 'day3',
          centerId: r.id,
          centerName: r.name,
          phone: r.phone,
          lastScanAt: r.last_scan,
          monthlyFee: r.monthly_fee,
          daysInactive,
        });
      }
    }
  }

  // 4. Call Next.js API (always — includes chq_inactivity_alert when actions is empty)
  let processed = 0;
  try {
    const res = await fetch(`${appUrl}/api/cron/detect-churn`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({ actions }),
    });

    const data = (await res.json().catch(() => ({}))) as { processed?: number };
    processed = data.processed ?? 0;

    if (res.ok && processed > 0) {
      for (const a of actions) {
        await supabase
          .from('wa_inactivity_alerts')
          .update({ alert_sent: true })
          .eq('center_id', a.centerId)
          .eq('alert_type', a.action)
          .is('resolved_at', null);
      }
    }
  } catch (err) {
    console.error('[detect-churn] API error:', err);
  }

  return new Response(
    JSON.stringify({ ok: true, processed, actions: actions.length }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
