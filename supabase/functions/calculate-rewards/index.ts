// Supabase Edge Function: calculate-rewards
// Invoked by pg_cron on 1st of month
// Calls Next.js API to calculate and release referral rewards

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
  // Prefer the dedicated cron secret (the route's correct caller token). Falls
  // back to the service-role key only until CRON_SECRET is added to this
  // function's env and it is redeployed. Set CRON_SECRET in the Edge Function
  // env (Supabase dashboard) to retire the master-key-as-token path.
  const cronSecret = Deno.env.get('CRON_SECRET');
  const appUrl = Deno.env.get('APP_URL') || 'https://tutoringhq.app';
  const bearer = cronSecret || supabaseServiceKey;

  if (!bearer) {
    return new Response(
      JSON.stringify({ error: 'Missing config' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const res = await fetch(`${appUrl}/api/referrals/calculate-rewards`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify({}),
    });

    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; processed?: number; released?: number };
    return new Response(
      JSON.stringify({
        ok: data.ok ?? true,
        processed: data.processed ?? 0,
        released: data.released ?? 0,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('[calculate-rewards] API error:', err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
