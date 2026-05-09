import * as Sentry from '@sentry/nextjs';
import { createHmac } from 'crypto';
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendOrderShipped } from '@/lib/centerNotify';
import { sendFreeformMessage } from '@/lib/whatsapp/client';
import { createAction } from '@/lib/ceo';
import { notifyVendorOfNewOrder } from '@/lib/vendorNotify';
import { ownerContactByCenterId, resolveOwnerWaPhone } from '@/lib/ownerPhone';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { readRawBodyWithLimit, ValidationError } from '@/lib/validate';
import { timingSafeEqualHex } from '@/lib/verifyHmac';
import {
  applyCardOrderTransition,
  IllegalCardOrderTransitionError,
} from '@/lib/cardOrderState';

export const dynamic = 'force-dynamic';

const BODY_LIMIT = 32 * 1024;

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

async function processBostaEvent(payload: Record<string, unknown>): Promise<void> {
  if (!supabaseAdmin) {
    console.error('[bosta-webhook] Missing Supabase admin');
    return;
  }

  const supabase = supabaseAdmin;

  const shipment = payload.shipment as Record<string, unknown> | undefined;
  const state = shipment?.state as Record<string, unknown> | undefined;

  const shipmentId =
    (typeof shipment?._id === 'string' ? shipment._id : null) ??
    (typeof payload._id === 'string' ? payload._id : null) ??
    (typeof payload.id === 'string' ? payload.id : null);

  const trackingNumber =
    (typeof shipment?.trackingNumber === 'string' ? shipment.trackingNumber : null) ??
    (typeof payload.trackingNumber === 'string' ? payload.trackingNumber : null);

  const stateCode =
    normalizeStateCode(state?.code) ||
    normalizeStateCode(state?.value) ||
    normalizeStateCode(payload.state) ||
    normalizeStateCode(payload.type);

  const eventId =
    (typeof payload.eventId === 'string' ? payload.eventId : null) ??
    (typeof payload._id === 'string' ? payload._id : null);

  if (!shipmentId && !trackingNumber) {
    console.warn('[bosta-webhook] No shipment identifier');
    return;
  }

  const order = await findCardOrder(supabase, shipmentId, trackingNumber);

  if (!order) {
    console.error('[bosta-webhook] Unknown shipment:', shipmentId ?? trackingNumber);
    return;
  }

  const dedupeKey = eventId?.trim() || null;

  const { error: eventErr } = await supabase.from('card_order_events').insert({
    card_order_id: order.id,
    event_type: stateCode || 'UNKNOWN',
    bosta_event_id: dedupeKey,
    payload,
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
      return;
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
      try {
        await applyCardOrderTransition(supabase, order.id, 'bosta_picked_up', {
          actorRole: 'system',
          extraColumns: {
            bosta_status: stateCode,
            bosta_updated_at: now,
          },
        });
      } catch (e) {
        if (e instanceof IllegalCardOrderTransitionError) {
          const { error: fbErr } = await supabase
            .from('card_orders')
            .update({
              bosta_status: stateCode,
              bosta_updated_at: now,
            })
            .eq('id', order.id);
          if (fbErr) console.error('[bosta-webhook] OUT_FOR_DELIVERY fallback:', fbErr);
        } else {
          console.error('[bosta-webhook] OUT_FOR_DELIVERY transition:', e);
        }
      }
        try {
          const trackingNum =
            order.tracking_number ??
            (typeof trackingNumber === 'string' ? trackingNumber : null);

          if (trackingNum) {
            const { data: invoice } = await supabase
              .from('invoices')
              .select('id, metadata')
              .eq('invoice_type', 'setup_fee')
              .eq('center_id', order.center_id)
              .contains('metadata', { card_order_id: order.id })
              .maybeSingle();

            if (invoice) {
              const inv = invoice as { id: string; metadata: unknown };
              const updatedMetadata = {
                ...(typeof inv.metadata === 'object' &&
                inv.metadata !== null &&
                !Array.isArray(inv.metadata)
                  ? (inv.metadata as Record<string, unknown>)
                  : {}),
                tracking_number: trackingNum,
                tracking_url: bostaTrackingUrl(trackingNum),
              };
              const { error: invErr } = await supabase
                .from('invoices')
                .update({ metadata: updatedMetadata })
                .eq('id', inv.id);
              if (invErr) {
                console.error('[bosta-webhook] invoice metadata update OUT_FOR_DELIVERY:', invErr);
              }
            }
          }
        } catch (e) {
          console.error('[bosta-webhook] invoice tracking writeback OUT_FOR_DELIVERY:', e);
        }
      break;
    }

    case 'DELIVERED':
    case 'DELIVERED_TO_SENDER': {
      if (shouldNotifyOrderShipped(prevBostaStatus, stateCode)) {
        void notifyOwnerOrderShipped(supabase, order, trackingUrl);
      }
      try {
        await applyCardOrderTransition(supabase, order.id, 'bosta_delivered', {
          actorRole: 'system',
          extraColumns: {
            bosta_status: stateCode,
            bosta_updated_at: now,
            delivered_at: now,
          },
        });
      } catch (e) {
        if (e instanceof IllegalCardOrderTransitionError) {
          const { error: fbErr } = await supabase
            .from('card_orders')
            .update({
              bosta_status: stateCode,
              bosta_updated_at: now,
              delivered_at: now,
            })
            .eq('id', order.id);
          if (fbErr) console.error('[bosta-webhook] DELIVERED fallback:', fbErr);
        } else {
          console.error('[bosta-webhook] DELIVERED transition:', e);
        }
      }
      try {
          const trackingNum =
            order.tracking_number ??
            (typeof trackingNumber === 'string' ? trackingNumber : null);

          if (trackingNum) {
            const { data: invoice } = await supabase
              .from('invoices')
              .select('id, metadata')
              .eq('invoice_type', 'setup_fee')
              .eq('center_id', order.center_id)
              .contains('metadata', { card_order_id: order.id })
              .maybeSingle();

            if (invoice) {
              const inv = invoice as { id: string; metadata: unknown };
              const updatedMetadata = {
                ...(typeof inv.metadata === 'object' &&
                inv.metadata !== null &&
                !Array.isArray(inv.metadata)
                  ? (inv.metadata as Record<string, unknown>)
                  : {}),
                tracking_number: trackingNum,
                tracking_url: bostaTrackingUrl(trackingNum),
                delivered_at: now,
              };
              const { error: invErr } = await supabase
                .from('invoices')
                .update({ metadata: updatedMetadata })
                .eq('id', inv.id);
              if (invErr) {
                console.error('[bosta-webhook] invoice metadata update:', invErr);
              } else {
                console.info('[bosta-webhook] tracking written to invoice:', inv.id);
              }
            }
          }
        } catch (e) {
          console.error('[bosta-webhook] invoice tracking writeback:', e);
        }
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
              price_per_card: fo.price_per_card ?? 62,
              delivery_fee: 0,
              total_amount: 0,
              status: 'paid',
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
}

export async function POST(request: Request) {
  try {
    const rawBody = await readRawBodyWithLimit(request, BODY_LIMIT);

    // BOSTA_WEBHOOK_SECRET — Set in Vercel env vars — get from Bosta dashboard
    const secret = process.env.BOSTA_WEBHOOK_SECRET ?? '';
    const sig = (request.headers.get('Bosta-Signature') ?? '').trim();
    const requireSecret =
      process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
    if (requireSecret && !secret) {
      Sentry.captureMessage('bosta webhook missing BOSTA_WEBHOOK_SECRET', {
        level: 'warning',
        tags: { provider: 'bosta' },
      });
      return new Response(null, { status: 401 });
    }
    if (secret) {
      const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
      if (!timingSafeEqualHex(expected, sig)) {
        return new Response(null, { status: 401 });
      }
    } else {
      console.warn(
        '[bosta-webhook] BOSTA_WEBHOOK_SECRET is not set; webhook HMAC verification skipped (non-production only)',
      );
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return new Response(null, { status: 401 });
    }

    const o1 = payload.order_id;
    const o2 = payload.trackingNumber;
    const orderId =
      (typeof o1 === 'string' ? o1 : o1 != null ? String(o1) : null) ??
      (typeof o2 === 'string' ? o2 : o2 != null ? String(o2) : null) ??
      null;

    if (orderId && supabaseAdmin) {
      const idempotencyKey = 'bosta:' + orderId;

      const { data: existing } = await supabaseAdmin
        .from('webhook_inbox')
        .select('id, processed')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();

      if (existing && (existing as { processed?: boolean }).processed === true) {
        return NextResponse.json({ received: true });
      }

      await supabaseAdmin.from('webhook_inbox').upsert(
        {
          idempotency_key: idempotencyKey,
          source: 'bosta',
          payload,
          processed: false,
        },
        { onConflict: 'idempotency_key' },
      );

      await processBostaEvent(payload);

      await supabaseAdmin
        .from('webhook_inbox')
        .update({
          processed: true,
          processed_at: new Date().toISOString(),
        })
        .eq('idempotency_key', idempotencyKey);
    } else {
      await processBostaEvent(payload);
    }

    return NextResponse.json({ received: true });
  } catch (e) {
    if (e instanceof ValidationError && e.message === 'Request payload too large') {
      Sentry.captureMessage('bosta webhook payload limit exceeded', {
        level: 'warning',
        tags: { provider: 'bosta' },
      });
      return new Response(null, { status: 413 });
    }
    Sentry.captureException(e, { tags: { provider: 'bosta' } });
    return new Response(null, { status: 401 });
  }
}
