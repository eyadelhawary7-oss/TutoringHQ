import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron/requireCronSecret';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getCartIdleDays } from '@/lib/card-order-cart/server';
import { insertCronLogFailure, insertCronLogSuccess } from '@/lib/cron/cronLog';

const CRON_NAME = 'abandon-stale-carts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  if (!supabaseAdmin) {
    return NextResponse.json({ ok: false, error: 'Server misconfigured' }, { status: 500 });
  }

  const cronStart = Date.now();

  try {
  const days = await getCartIdleDays(supabaseAdmin);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data: updated, error } = await supabaseAdmin
    .from('card_order_carts')
    .update({
      status: 'abandoned',
      abandoned_at: new Date().toISOString(),
    })
    .eq('status', 'open')
    .lt('updated_at', cutoff)
    .select('id');

  if (error) {
    await insertCronLogFailure(supabaseAdmin, CRON_NAME, new Error(error.message), {
      duration_ms: Date.now() - cronStart,
    });
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const n = updated?.length ?? 0;
  await insertCronLogSuccess(supabaseAdmin, CRON_NAME, {
    duration_ms: Date.now() - cronStart,
    records_processed: n,
    metadata: { idleDays: days },
  });

  return NextResponse.json({ ok: true, abandonedCount: n, idleDays: days });
  } catch (e) {
    await insertCronLogFailure(supabaseAdmin, CRON_NAME, e, {
      duration_ms: Date.now() - cronStart,
    });
    return NextResponse.json({ ok: false, error: 'internal' }, { status: 500 });
  }
}
