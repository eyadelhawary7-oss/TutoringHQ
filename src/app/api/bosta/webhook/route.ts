import { createHmac, timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendOrderShipped } from '@/lib/centerNotify';
import { sendFreeformMessage } from '@/lib/whatsapp/client';
import { createAction } from '@/lib/ceo';
import { notifyVendorOfNewOrder } from '@/lib/vendorNotify';
import { ownerContactByCenterId, resolveOwnerWaPhone } from '@/lib/ownerPhone';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

const MSG_DELIVERY_FAILED =
  'تعذر توصيل طلب بطاقات QR الخاص بك. يرجى التواصل معنا لإعادة الجدولة.';
const MSG_LOST_REPLACEMENT = 'تأكدنا من ضياع طلبك. سيتم إرسال بدائل مجاناً.';

function readAutoReshipFlag(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v === 'true' || v === '1';
  }
  return false;
}

function normalizeStateCode(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : raw != null ? String(raw) : '';
  return s.toUpperCase().replace(/-/g, '_').trim();
}

/** Notify center owner via WhatsApp when Bosta reports delivery/pickup failure. */
export async function notifyCenterBostaDFailed(centerId: string, admin: SupabaseClient): Promise<void> {
  const { data: center } = await admin.from('centers').select('phone').eq('id', centerId).maybeSingle();
  const phone = String((center as { phone?: string | null } | null)?.phone ?? '').trim();
  if (!phone) {
    console.warn('[bosta-webhook] No center phone for delivery-failed WA', centerId);
    return;
  }
  await sendFreeformMessage(centerId, phone, MSG_DELIVERY_FAILED);
}

type CardOrderRow = {
  id: string;
  center_id: string;
  quantity: number;
  total_amount: number;
  bosta_status: string | null;
  tracking_number: string | null;
};

const ORDER_LOOKUP_SELECT = 'id, center_id, quantity, total_amount, bosta_status, tracking_number';

function bostaTrackingUrl(trackingNumber: string | null): string {
  const t = (trackingNumber ?? '').trim();
  if (!t) return (process.env.NEXT_PUBLIC_APP_URL ?? 'https://centerhq.app').replace(/\/$/, '');
  return `https://bosta.co/en/track-shipment?trackingNumber=${encodeURIComponent(t)}`;
}

function shouldNotifyOrderShipped(prevStatus: string | null, stateCode: string): boolean {
  const prev = (prevStatus ?? '').toUpperCase().replace(/-/g, '_');
  const code = stateCode.toUpperCase().replace(/-/g, '_');
  if (code === 'OUT_FOR_DELIVERY') {
    return prev !== 'OUT_FOR_DELIVERY';
  }
  if (code === 'DELIVERED' || code === 'DELIVERED_TO_SENDER') {
    return prev !== 'OUT_FOR_DELIVERY' && prev !== 'DELIVERED' && prev !== 'DELIVERED_TO_SENDER';
  }
  return false;
}

async function notifyOwnerOrderShipped(
  admin: SupabaseClient,
  order: CardOrderRow,
  trackingUrl: string,
): Promise<void> {
  try {
    const { data: center } = await admin
      .from('centers')
      .select('id, name, owner_name, phone')
      .eq('id', order.center_id)
      .maybeSingle();
    if (!center) return;
    const c = center as {
      id: string;
      name: string | null;
      owner_name: string | null;
      phone: string | null;
    };
    const ownerMap = await ownerContactByCenterId(admin, [c.id]);
    const oc = ownerMap.get(c.id);
    const ownerPhone = await resolveOwnerWaPhone(
      admin,
      oc?.authId ?? null,
      oc?.userPhone,
      c.phone,
    );
    if (!ownerPhone) return;
    const ownerName = (c.owner_name ?? '').trim() || (c.name ?? '').trim() || '—';
    const centerName = (c.name ?? '').trim() || '—';
    await sendOrderShipped(ownerPhone, ownerName, centerName, order.quantity, trackingUrl);
  } catch (e) {
    console.error('[bosta-webhook] notifyOwnerOrderShipped:', e);
  }
}

async function findCardOrder(
  admin: SupabaseClient,
  shipmentId: string | null,
  trackingNumber: string | null,
): Promise<CardOrderRow | null> {
  if (shipmentId) {
    const { data } = await admin
      .from('card_orders')
      .select(ORDER_LOOKUP_SELECT)
      .eq('bosta_shipment_id', shipmentId)
      .maybeSingle();
    if (data) return data as CardOrderRow;
  }
  if (trackingNumber) {
    const { data: byTrack } = await admin
      .from('card_orders')
      .select(ORDER_LOOKUP_SELECT)
      .eq('tracking_number', trackingNumber)
      .maybeSingle();
    if (byTrack) return byTrack as CardOrderRow;
  }
  if (shipmentId) {
    const { data: byTrackAsId } = await admin
      .from('card_orders')
      .select(ORDER_LOOKUP_SELECT)
      .eq('tracking_number', shipmentId)
      .maybeSingle();
    if (byTrackAsId) return byTrackAsId as CardOrderRow;
  }
  return null;
}

export async function POST(request: Request) {
  const rawBody = await request.text();

  // BOSTA_WEBHOOK_SECRET — Set in Vercel env vars — get from Bosta dashboard
  const secret = process.env.BOSTA_WEBHOOK_SECRET ?? '';
  const sig = request.headers.get('Bosta-Signature') ?? '';
  const requireSecret =
    process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
  if (requireSecret && !secret) {
    console.error('[bosta-webhook] BOSTA_WEBHOOK_SECRET is required in production');
    return NextResponse.json({ received: true, error: 'misconfigured' }, { status: 200 });
  }
  if (secret) {
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expected);
    if (
      sigBuf.length !== expectedBuf.length ||
      !timingSafeEqual(sigBuf, expectedBuf)
    ) {
      console.warn('[bosta-webhook] Invalid signature');
      return NextResponse.json({ received: true, error: 'invalid_signature' }, { status: 200 });
    }
  } else {
    console.warn(
      '[bosta-webhook] BOSTA_WEBHOOK_SECRET is not set; webhook HMAC verification skipped (non-production only)',
    );
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    console.warn('[bosta-webhook] Invalid JSON body');
    return NextResponse.json({ received: true, error: 'invalid_json' }, { status: 200 });
  }

  if (!supabaseAdmin) {
    console.error('[bosta-webhook] Missing Supabase admin');
    return NextResponse.json({ received: true });
  }

  const supabase = supabaseAdmin;

  const shipment = body.shipment as Record<string, unknown> | undefined;
  const state = shipment?.state as Record<string, unknown> | undefined;

  const shipmentId =
    (typeof shipment?._id === 'string' ? shipment._id : null) ??
    (typeof body._id === 'string' ? body._id : null) ??
    (typeof body.id === 'string' ? body.id : null);

  const trackingNumber =
    (typeof shipment?.trackingNumber === 'string' ? shipment.trackingNumber : null) ??
    (typeof body.trackingNumber === 'string' ? body.trackingNumber : null);

  const stateCode =
    normalizeStateCode(state?.code) ||
    normalizeStateCode(state?.value) ||
    normalizeStateCode(body.state) ||
    normalizeStateCode(body.type);

  const eventId =
    (typeof body.eventId === 'string' ? body.eventId : null) ??
    (typeof body._id === 'string' ? body._id : null);

  if (!shipmentId && !trackingNumber) {
    console.warn('[bosta-webhook] No shipment identifier');
    return NextResponse.json({ received: true, error: 'no_shipment' }, { status: 200 });
  }

  const order = await findCardOrder(supabase, shipmentId, trackingNumber);

  if (!order) {
    console.error('[bosta-webhook] Unknown shipment:', shipmentId ?? trackingNumber);
    return NextResponse.json({ received: true });
  }

  const dedupeKey = eventId?.trim() || null;

  const { error: eventErr } = await supabase.from('card_order_events').insert({
    card_order_id: order.id,
    event_type: stateCode || 'UNKNOWN',
    bosta_event_id: dedupeKey,
    payload: body,
  });
  if (eventErr) {
    console.error('[bosta-webhook] card_order_events insert:', eventErr);
  }

  if (dedupeKey) {
    const { count, error: cntErr } = await supabase
      .from('card_order_events')
      .select('*', { count: 'exact', head: true })
      .eq('card_order_id', order.id)
      .eq('bosta_event_id', dedupeKey);
    if (!cntErr && (count ?? 0) > 1) {
      return NextResponse.json({ received: true });
    }
  }

  const now = new Date().toISOString();
  const prevBostaStatus = order.bosta_status;
  const trackingUrl = bostaTrackingUrl(order.tracking_number);

  switch (stateCode) {
    case 'OUT_FOR_DELIVERY': {
      if (shouldNotifyOrderShipped(prevBostaStatus, stateCode)) {
        void notifyOwnerOrderShipped(supabase, order, trackingUrl);
      }
      const { error } = await supabase
        .from('card_orders')
        .update({
          status: 'shipped',
          bosta_status: stateCode,
          bosta_updated_at: now,
        })
        .eq('id', order.id);
      if (error) console.error('[bosta-webhook] OUT_FOR_DELIVERY update:', error);
      break;
    }

    case 'DELIVERED':
    case 'DELIVERED_TO_SENDER': {
      if (shouldNotifyOrderShipped(prevBostaStatus, stateCode)) {
        void notifyOwnerOrderShipped(supabase, order, trackingUrl);
      }
      const { error } = await supabase
        .from('card_orders')
        .update({
          status: 'delivered',
          bosta_status: stateCode,
          bosta_updated_at: now,
          delivered_at: now,
        })
        .eq('id', order.id);
      if (error) console.error('[bosta-webhook] DELIVERED/DELIVERED_TO_SENDER update:', error);
      break;
    }

    case 'DELIVERY_FAILED':
    case 'PICKUP_FAILED': {
      const { error } = await supabase
        .from('card_orders')
        .update({
          bosta_status: stateCode,
          bosta_updated_at: now,
        })
        .eq('id', order.id);
      if (error) console.error('[bosta-webhook] FAILED update:', error);
      try {
        await notifyCenterBostaDFailed(order.center_id, supabase);
      } catch (e) {
        console.error('[bosta-webhook] WA send failed:', e);
      }
      break;
    }

    case 'LOST': {
      const { error } = await supabase
        .from('card_orders')
        .update({
          bosta_status: 'LOST',
          bosta_updated_at: now,
          bosta_notes: 'Package confirmed lost by Bosta',
        })
        .eq('id', order.id);
      if (error) console.error('[bosta-webhook] LOST update:', error);

      const { data: flagRow } = await supabase
        .from('platform_config')
        .select('value')
        .eq('key', 'bosta_auto_reship_on_lost')
        .maybeSingle();

      const autoReship = readAutoReshipFlag(flagRow?.value);

      if (autoReship) {
        const { data: fullOrder, error: fullErr } = await supabase
          .from('card_orders')
          .select(
            'center_id, quantity, students, price_per_card, delivery_fee, delivery_address, created_by',
          )
          .eq('id', order.id)
          .maybeSingle();

        if (!fullErr && fullOrder) {
          const fo = fullOrder as {
            center_id: string;
            quantity: number;
            students: unknown;
            price_per_card: number | null;
            delivery_fee: number | null;
            delivery_address: string | null;
            created_by: string | null;
          };
          const { data: inserted, error: insErr } = await supabase
            .from('card_orders')
            .insert({
              center_id: fo.center_id,
              created_by: fo.created_by,
              students: fo.students ?? [],
              quantity: fo.quantity,
              price_per_card: fo.price_per_card ?? 55,
              delivery_fee: 0,
              total_amount: 0,
              status: 'pending',
              payment_status: 'paid',
              delivery_address: fo.delivery_address,
              notes: `Replacement for lost order ${order.id}`,
              bosta_notes: `Replacement for lost order ${order.id}`,
            })
            .select('id')
            .single();

          if (insErr) {
            console.error('[bosta-webhook] replacement insert:', insErr);
          } else if (inserted && typeof (inserted as { id?: string }).id === 'string') {
            void notifyVendorOfNewOrder((inserted as { id: string }).id);
            try {
              const { data: center } = await supabase
                .from('centers')
                .select('phone')
                .eq('id', order.center_id)
                .maybeSingle();
              const phone = String((center as { phone?: string | null } | null)?.phone ?? '').trim();
              if (phone) {
                await sendFreeformMessage(order.center_id, phone, MSG_LOST_REPLACEMENT);
              }
            } catch (e) {
              console.error('[bosta-webhook] LOST replacement WA:', e);
            }
          }
        }
      } else {
        try {
          await createAction(supabase, {
            type: 'ops',
            priority: 'red',
            center_id: order.center_id,
            title: `Bosta LOST: card order ${order.id}`,
            subtitle: JSON.stringify({
              orderId: order.id,
              quantity: order.quantity,
              shipmentId: shipmentId ?? trackingNumber,
            }),
            auto_generated: true,
          });
        } catch (e) {
          console.error('[bosta-webhook] ceo_action_queue LOST:', e);
        }
      }
      break;
    }

    case 'RETURNED_TO_ORIGIN':
    case 'RETURNED': {
      const { error } = await supabase
        .from('card_orders')
        .update({
          bosta_status: 'RETURNED',
          bosta_updated_at: now,
          bosta_notes: 'Package returned to origin - center may have refused delivery',
        })
        .eq('id', order.id);
      if (error) console.error('[bosta-webhook] RETURNED update:', error);

      try {
        await createAction(supabase, {
          type: 'ops',
          priority: 'amber',
          center_id: order.center_id,
          title: `Bosta RETURNED: card order ${order.id}`,
          subtitle: JSON.stringify({
            orderId: order.id,
            shipmentId: shipmentId ?? trackingNumber,
          }),
          auto_generated: true,
        });
      } catch (e) {
        console.error('[bosta-webhook] ceo_action_queue RETURNED:', e);
      }
      break;
    }

    default: {
      if (stateCode) {
        const { error } = await supabase
          .from('card_orders')
          .update({
            bosta_status: stateCode,
            bosta_updated_at: now,
          })
          .eq('id', order.id);
        if (error) console.error('[bosta-webhook] default update:', error);
      }
      break;
    }
  }

  return NextResponse.json({ received: true });
}
