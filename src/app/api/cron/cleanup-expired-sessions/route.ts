import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron/requireCronSecret';
import { insertCronLogSuccess, insertCronLogFailure } from '@/lib/cron/cronLog';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  const cronStart = Date.now();
  const CRON_NAME = 'cleanup-expired-sessions';

  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ success: false }, { status: 200 });
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: pausedRow } = await supabase
    .from('platform_config')
    .select('value')
    .eq('key', 'cron_paused')
    .maybeSingle();
  if (pausedRow?.value === true) {
    return NextResponse.json({ skipped: 'cron_paused' }, { status: 200 });
  }

  try {
    const now = new Date().toISOString();

    const { data: rows, error: fetchErr } = await supabase
      .from('combined_payment_sessions')
      .select('id, center_id, credit_amount')
      .eq('status', 'pending')
      .lt('expires_at', now)
      .is('finalized_at', null);

    if (fetchErr) {
      throw new Error(fetchErr.message);
    }

    const list = rows ?? [];
    let expired = 0;

    for (const row of list) {
      const r = row as { id: string; center_id: string; credit_amount?: number | string | null };
      const { error: upErr } = await supabase
        .from('combined_payment_sessions')
        .update({ status: 'expired' })
        .eq('id', r.id)
        .eq('status', 'pending');

      if (upErr) {
        console.error('[cleanup-expired-sessions] update', r.id, upErr);
        continue;
      }

      expired++;
      const creditAmt = Number(r.credit_amount ?? 0);
      if (creditAmt > 0) {
        const { error: rpcErr } = await supabase.rpc('cancel_reservation_atomic', {
          p_center_id: r.center_id,
          p_amount: creditAmt,
        });
        if (rpcErr) {
          console.error('[cleanup-expired-sessions] cancel_reservation_atomic', r.id, rpcErr);
        }
      }
    }

    await insertCronLogSuccess(supabase, CRON_NAME, {
      duration_ms: Date.now() - cronStart,
      records_processed: expired,
      metadata: { candidates: list.length, expired },
    });

    try {
      if (supabaseAdmin) {
        await supabaseAdmin.from('cron_health_log').upsert(
          {
            cron_name: 'cleanup-expired-sessions',
            last_success_at: new Date().toISOString(),
            failure_count: 0,
          },
          { onConflict: 'cron_name' },
        );
      }
    } catch (healthLogErr) {
      console.error('[cleanup-expired-sessions] cron_health_log:', healthLogErr);
    }

    return NextResponse.json({ success: true, expired, candidates: list.length });
  } catch (error) {
    console.error(`[${CRON_NAME}] Error:`, error);
    await insertCronLogFailure(supabase, CRON_NAME, error, {
      duration_ms: Date.now() - cronStart,
    });
    return NextResponse.json({ success: false }, { status: 200 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
