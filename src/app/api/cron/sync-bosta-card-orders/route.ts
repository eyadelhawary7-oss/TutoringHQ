import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron/requireCronSecret';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { fetchBostaDeliveryByTracking } from '@/lib/bosta';
import { applyCardOrderTransition, IllegalCardOrderTransitionError } from '@/lib/cardOrderState';
import { insertCronLogFailure, insertCronLogSuccess } from '@/lib/cron/cronLog';

const CRON_NAME = 'sync-bosta-card-orders';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const admin = supabaseAdmin;

  const cronStart = Date.now();

  try {

  const { data: orders, error } = await admin
    .from('card_orders')
    .select('id, tracking_number, status')
    .not('tracking_number', 'is', null)
    .in('status', ['ready_for_pickup', 'in_transit', 'shipped', 'vendor_assigned', 'in_production'])
    .limit(40);

  if (error) {
    console.error('[sync-bosta-card-orders]', error.message);
    await insertCronLogFailure(admin, CRON_NAME, new Error(error.message), {
      duration_ms: Date.now() - cronStart,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let polled = 0;
  let transitioned = 0;
  let noop = 0;

  for (const row of orders ?? []) {
    const id = String((row as { id: string }).id);
    const tn = String((row as { tracking_number: string | null }).tracking_number ?? '').trim();
    if (!tn) continue;

    polled += 1;
    const poll = await fetchBostaDeliveryByTracking(tn);
    if (!poll.ok || !poll.stateCode) {
      noop += 1;
      continue;
    }

    const code = poll.stateCode;
    const now = new Date().toISOString();

    try {
      if (code === 'OUT_FOR_DELIVERY') {
        await applyCardOrderTransition(admin, id, 'bosta_picked_up', {
          actorRole: 'system',
          extraColumns: {
            bosta_status: code,
            bosta_updated_at: now,
          },
        });
        transitioned += 1;
      } else if (code === 'DELIVERED' || code === 'DELIVERED_TO_SENDER') {
        await applyCardOrderTransition(admin, id, 'bosta_delivered', {
          actorRole: 'system',
          extraColumns: {
            bosta_status: code,
            bosta_updated_at: now,
            delivered_at: now,
          },
        });
        transitioned += 1;
      } else {
        noop += 1;
      }
    } catch (e) {
      if (e instanceof IllegalCardOrderTransitionError) {
        noop += 1;
      } else {
        console.error('[sync-bosta-card-orders] transition', id, e);
        noop += 1;
      }
    }
  }

  await insertCronLogSuccess(admin, CRON_NAME, {
    duration_ms: Date.now() - cronStart,
    records_processed: polled,
    metadata: { transitioned, noop },
  });

  return NextResponse.json({ polled, transitioned, noop });
  } catch (e) {
    console.error('[sync-bosta-card-orders]', e);
    await insertCronLogFailure(admin, CRON_NAME, e, { duration_ms: Date.now() - cronStart });
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
