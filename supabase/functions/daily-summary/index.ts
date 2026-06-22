// Supabase Edge Function: daily-summary
// Invoked by pg_cron at 5:55am UTC daily
// Calls Next.js API to process and send daily summaries

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const appUrl = Deno.env.get('APP_URL') || 'https://tutoringhq.app';

  if (!supabaseServiceKey) {
    return new Response(
      JSON.stringify({ error: 'Missing config' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const res = await fetch(`${appUrl}/api/cron/daily-summary`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({}),
    });

    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; processed?: number };
    return new Response(
      JSON.stringify({ ok: data.ok ?? true, processed: data.processed ?? 0 }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('[daily-summary] API error:', err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
