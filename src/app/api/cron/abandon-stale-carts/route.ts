import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron/requireCronSecret';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getCartIdleDays } from '@/lib/card-order-cart/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  if (!supabaseAdmin) {
    return NextResponse.json({ ok: false, error: 'Server misconfigured' }, { status: 500 });
  }

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
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, abandonedCount: updated?.length ?? 0, idleDays: days });
}
