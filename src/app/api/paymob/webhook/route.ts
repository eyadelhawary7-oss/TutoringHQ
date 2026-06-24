import * as Sentry from '@sentry/nextjs';
import { NextRequest, NextResponse } from 'next/server';
import { verifyCardOrderPaymobHmac } from '@/lib/paymob';
import { triggerT1Eligible, resumeCommissionClocks } from '@/lib/commissions';
import { sendPaymentConfirmed } from '@/lib/centerNotify';
import { ownerContactByCenterId, resolveOwnerWaPhone } from '@/lib/ownerPhone';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { readRawBodyWithLimit, ValidationError } from '@/lib/validate';
import { hmacSha512Hex, timingSafeEqualHex } from '@/lib/verifyHmac';
import { getPaymobHmacSecret } from '@/lib/paymobConfig';
import { redeemPromoCodeForPaymobOrder } from '@/lib/redeemPromoCode';

export const dynamic = 'force-dynamic';

const paymentFailedEnabled = true; // chq_payment_failed - set to false if template gets rejected

const BODY_LIMIT = 32 * 1024;
async function processPaymobEvent(payload: Record<string, unknown>): Promise<void> {
  let supabaseAdminLocal;
  try {
    supabaseAdminLocal = getSupabaseAdmin();
  } catch {
    return;
  }

  const obj = payload.obj;
  if (!obj || typeof obj !== 'object') {
    return;
  }

  const objRec = obj as Record<string, unknown>;

  // IDEMPOTENCY GUARD - Paymob order id is the idempotency key (not transaction_id)
  const orderForIdem = objRec.order as { id?: unknown } | null | undefined;
  const orderId =
    orderForIdem?.id !== null && orderForIdem?.id !== undefined
      ? String(orderForIdem.id)
      : '';
  if (!orderId) {
    return;
  }

  const { data: existingSession } = await supabaseAdminLocal
    .from('combined_payment_sessions')
    .select('id, status')
    .eq('paymob_order_id', orderId)
    .maybeSingle();

  if (existingSession?.status === 'paid') {
    return;
  }

  const { data: existingInvoice } = await supabaseAdminLocal
    .from('invoices')
    .select('id, status')
    .eq('paymob_order_id', orderId)
    .maybeSingle();

  const sessionPending = existingSession?.status === 'pending';
  if (existingInvoice?.status === 'paid' && !sessionPending) {
    return;
  }

  try {
    const success = objRec.success === true || objRec.success === 'true';
    const transactionId = String(objRec.id ?? '');

    /** Paymob HMAC object includes is_voided / is_refunded - used for chargebacks after capture. */
    const isChargebackLike =
      objRec.is_voided === true ||
      objRec.is_voided === 'true' ||
      objRec.is_refunded === true ||
      objRec.is_refunded === 'true';

    if (isChargebackLike) {
      const { finalizeInvoiceChargeback } = await import('@/lib/invoicePaymobPayment');
      await finalizeInvoiceChargeback(supabaseAdminLocal, orderId, transactionId);
    } else if (success) {
      const { tryFinalizeCombinedPaymentSession } = await import('@/lib/combinedPaymentFinalize');
      const combo = existingSession as { id?: string; status?: string } | null;
      const combined =
        combo?.id && combo.status === 'pending'
          ? await tryFinalizeCombinedPaymentSession(
              combo.id,
              supabaseAdminLocal,
              'webhook',
              transactionId,
            )
          : false;
      if (!combined) {
        const { finalizeCardOrderPaymentSuccess } = await import('@/lib/cardOrderPayment');
        const cardResult = await finalizeCardOrderPaymentSuccess(
          supabaseAdminLocal,
          orderId,
          transactionId,
        );
        if (!cardResult) {
          const { finalizeInvoicePaymentSuccess } = await import('@/lib/invoicePaymobPayment');
          await finalizeInvoicePaymentSuccess(supabaseAdminLocal, orderId, transactionId);
        }
      }
      const { processSignupAutoApprovalAfterPaymobSuccess } = await import('@/lib/signupPaymobAutoApprove');
      await processSignupAutoApprovalAfterPaymobSuccess(supabaseAdminLocal, orderId, transactionId);

      try {
        await redeemPromoCodeForPaymobOrder(supabaseAdminLocal, { paymobOrderId: orderId });
      } catch (promoErr) {
        console.error('[paymob-webhook] promo redemption error', promoErr);
      }

      const { data: paidInv } = await supabaseAdminLocal
        .from('invoices')
        .select('center_id')
        .eq('paymob_order_id', orderId)
        .eq('status', 'paid')
        .maybeSingle();
      let centerId: string | null =
        (paidInv as { center_id?: string } | null)?.center_id ?? null;
      if (!centerId) {
        const { data: paidSess } = await supabaseAdminLocal
          .from('combined_payment_sessions')
          .select('center_id')
          .eq('paymob_order_id', orderId)
          .eq('status', 'paid')
          .maybeSingle();
        centerId = (paidSess as { center_id?: string } | null)?.center_id ?? null;
      }
      if (centerId) {
        await triggerT1Eligible(centerId);
        await resumeCommissionClocks(centerId);
      }

      try {
        const { data: invRow } = await supabaseAdminLocal
          .from('invoices')
          .select('center_id, total_amount, billing_period_start, billing_period_end')
          .eq('paymob_order_id', orderId)
          .eq('status', 'paid')
          .maybeSingle();
        const cid = (invRow as { center_id?: string } | null)?.center_id;
        if (cid) {
          const { data: center } = await supabaseAdminLocal
            .from('centers')
            .select('id, name, phone')
            .eq('id', cid)
            .maybeSingle();
          if (center) {
            const ownerMap = await ownerContactByCenterId(supabaseAdminLocal, [cid]);
            const contact = ownerMap.get(cid);
            const ownerPhone = await resolveOwnerWaPhone(
              supabaseAdminLocal,
              contact?.authId ?? null,
              contact?.userPhone ?? null,
              (center as { phone?: string | null }).phone ?? null,
            );
            if (ownerPhone) {
              const start = String((invRow as { billing_period_start?: string | null }).billing_period_start ?? '');
              const end = String((invRow as { billing_period_end?: string | null }).billing_period_end ?? '');
              const periodStr = start && end ? `${start} - ${end}` : start || end || '';
              await sendPaymentConfirmed(
                supabaseAdminLocal,
                ownerPhone,
                String((center as { name?: string | null }).name ?? ''),
                periodStr,
                String((invRow as { total_amount?: unknown }).total_amount ?? ''),
              );
            }
          }
        } else {
          const { data: sessRow } = await supabaseAdminLocal
            .from('combined_payment_sessions')
            .select('center_id, total_amount, metadata')
            .eq('paymob_order_id', orderId)
            .eq('status', 'paid')
            .maybeSingle();
          const sessionCenterId = (sessRow as { center_id?: string } | null)?.center_id;
          if (sessionCenterId) {
            const { data: center } = await supabaseAdminLocal
              .from('centers')
              .select('id, name, phone')
              .eq('id', sessionCenterId)
              .maybeSingle();
            if (center) {
              const ownerMap = await ownerContactByCenterId(supabaseAdminLocal, [sessionCenterId]);
              const contact = ownerMap.get(sessionCenterId);
              const ownerPhone = await resolveOwnerWaPhone(
                supabaseAdminLocal,
                contact?.authId ?? null,
                contact?.userPhone ?? null,
                (center as { phone?: string | null }).phone ?? null,
              );
              if (ownerPhone) {
                const meta = (sessRow as { metadata?: unknown }).metadata;
                const anchor =
                  meta && typeof meta === 'object' && meta !== null && 'billingAnchorYmd' in meta
                    ? String((meta as { billingAnchorYmd?: unknown }).billingAnchorYmd ?? '')
                    : '';
                const periodStr = anchor ? anchor.slice(0, 10) : new Date().toISOString().slice(0, 10);
                await sendPaymentConfirmed(
                  supabaseAdminLocal,
                  ownerPhone,
                  String((center as { name?: string | null }).name ?? ''),
                  periodStr,
                  String((sessRow as { total_amount?: unknown }).total_amount ?? ''),
                );
              }
            }
          }
        }
      } catch {
        console.error('[paymob-webhook] sendPaymentConfirmed failed');
      }
    } else {
      const { finalizeCardOrderPaymentFailure } = await import('@/lib/cardOrderPayment');
      await finalizeCardOrderPaymentFailure(supabaseAdminLocal, orderId);
      const { finalizeInvoicePaymentFailure, notifySubscriptionInvoicePaymentFailed } = await import(
        '@/lib/invoicePaymobPayment'
      );
      await finalizeInvoicePaymentFailure(supabaseAdminLocal, orderId);
      await notifySubscriptionInvoicePaymentFailed(supabaseAdminLocal, orderId, paymentFailedEnabled);
    }
  } catch (e) {
    console.error('[paymob/webhook]', e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await readRawBodyWithLimit(request, BODY_LIMIT);

    const hmacSecret = getPaymobHmacSecret();
    if (!hmacSecret) {
      Sentry.captureMessage('paymob webhook missing PAYMOB_HMAC_SECRET', {
        level: 'warning',
        tags: { provider: 'paymob' },
      });
      return new Response(null, { status: 401 });
    }

    const receivedHeaderHmac = (request.headers.get('x-hmac-signature') ?? '').trim();
    if (receivedHeaderHmac) {
      const computedHmac = hmacSha512Hex(hmacSecret, rawBody);
      if (!timingSafeEqualHex(computedHmac, receivedHeaderHmac)) {
        return new Response(null, { status: 401 });
      }
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return new Response(null, { status: 401 });
    }

    if (!receivedHeaderHmac) {
      const hmacFromQuery = request.nextUrl.searchParams.get('hmac') ?? '';
      const hmac = hmacFromQuery || (typeof payload.hmac === 'string' ? payload.hmac : '');
      const obj = payload.obj;

      if (!hmac || !obj || typeof obj !== 'object') {
        return new Response(null, { status: 401 });
      }

      if (!verifyCardOrderPaymobHmac(obj as Record<string, unknown>, hmac)) {
        return new Response(null, { status: 401 });
      }
    }

    const objAsRec = payload.obj as Record<string, unknown> | undefined;
    const transactionId =
      (objAsRec?.id as string | number | null | undefined) ??
      (payload.id as string | number | null | undefined) ??
      null;

    if (transactionId != null && transactionId !== '') {
      const idempotencyKey = 'paymob:' + String(transactionId);

      if (supabaseAdmin) {
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
            source: 'paymob',
            payload,
            processed: false,
          },
          { onConflict: 'idempotency_key', ignoreDuplicates: true },
        );

        await processPaymobEvent(payload);

        await supabaseAdmin
          .from('webhook_inbox')
          .update({
            processed: true,
            processed_at: new Date().toISOString(),
          })
          .eq('idempotency_key', idempotencyKey);
      } else {
        await processPaymobEvent(payload);
      }
    } else {
      await processPaymobEvent(payload);
    }

    return NextResponse.json({ received: true });
  } catch (e) {
    if (e instanceof ValidationError && e.message === 'Request payload too large') {
      Sentry.captureMessage('paymob webhook payload limit exceeded', {
        level: 'warning',
        tags: { provider: 'paymob' },
      });
      return new Response(null, { status: 413 });
    }
    Sentry.captureException(e, { tags: { provider: 'paymob' } });
    return new Response(null, { status: 401 });
  }
}
