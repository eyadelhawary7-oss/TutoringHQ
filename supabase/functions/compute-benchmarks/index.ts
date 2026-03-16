// Supabase Edge Function: compute-benchmarks
// Invoked by pg_cron at 1am UTC daily
// Calls compute_benchmark_snapshots RPC — aggregates by district+tier, NEVER stores center_id

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

  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(
      JSON.stringify({ error: 'Missing Supabase config' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Use yesterday's date for snapshot (data is complete for previous day)
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const snapshotDate = yesterday.toISOString().slice(0, 10);

    const { data, error } = await supabase.rpc('compute_benchmark_snapshots', {
      p_snapshot_date: snapshotDate,
    });

    if (error) {
      console.error('[compute-benchmarks] RPC error:', error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const rowsAffected = (data as number) ?? 0;
    return new Response(
      JSON.stringify({ ok: true, rows_affected: rowsAffected, snapshot_date: snapshotDate }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('[compute-benchmarks] Error:', err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
