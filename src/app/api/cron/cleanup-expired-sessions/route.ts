import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function runCleanupExpiredSessions(request: Request): Promise<Response> {
  const cronStart = Date.now();

  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ success: false, error: 'Server misconfigured' }, { status: 200 });
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

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

    await supabase.from('cron_log').insert({
      cron_name: 'cleanup-expired-sessions',
      status: 'success',
      duration_ms: Date.now() - cronStart,
      records_processed: expired,
      metadata: { candidates: list.length, expired },
    });

    return NextResponse.json({ success: true, expired, candidates: list.length });
  } catch (error) {
    try {
      await supabase.from('cron_log').insert({
        cron_name: 'cleanup-expired-sessions',
        status: 'failure',
        duration_ms: Date.now() - cronStart,
        error_message: error instanceof Error ? error.message.slice(0, 2000) : 'Unknown error',
      });
    } catch (logErr) {
      console.error('[cleanup-expired-sessions] cron_log', logErr);
    }
    return NextResponse.json({ success: false }, { status: 200 });
  }
}

export async function GET(request: Request) {
  return runCleanupExpiredSessions(request);
}

export async function POST(request: Request) {
  return runCleanupExpiredSessions(request);
}
