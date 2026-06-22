// Supabase Edge Function: process-onboarding
// Invoked by pg_cron every 5 minutes
// Queries pending wa_onboarding_schedule steps, calls Next.js API to send WhatsApp messages

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const appUrl = Deno.env.get('APP_URL') || 'https://tutoringhq.app';

  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(
      JSON.stringify({ error: 'Missing Supabase config' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const now = new Date().toISOString();

  const { data: pending, error: fetchError } = await supabase
    .from('wa_onboarding_schedule')
    .select('id, center_id, to_phone, step')
    .eq('status', 'pending')
    .lte('scheduled_for', now)
    .order('step', { ascending: true });

  if (fetchError) {
    console.error('process-onboarding fetch error:', fetchError);
    return new Response(
      JSON.stringify({ error: fetchError.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const rows = (pending ?? []) as { id: string; center_id: string; to_phone: string; step: number }[];
  const apiUrl = `${appUrl}/api/whatsapp/process-onboarding-step`;
  const processed: string[] = [];

  for (const row of rows) {
    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({
          centerId: row.center_id,
          toPhone: row.to_phone,
          step: row.step,
        }),
      });

      const result = (await res.json().catch(() => ({}))) as { success?: boolean; skipped?: boolean };

      if (result.success) {
        await supabase
          .from('wa_onboarding_schedule')
          .update({
            status: result.skipped ? 'skipped' : 'sent',
            sent_at: result.skipped ? null : new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id);
        processed.push(row.id);
      }
    } catch (err) {
      console.error('[process-onboarding] step error:', row.id, err);
    }
  }

  return new Response(
    JSON.stringify({ ok: true, processed: processed.length, rows: rows.length }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
