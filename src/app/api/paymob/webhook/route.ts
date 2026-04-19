import { NextRequest, NextResponse } from 'next/server';
import { verifyCardOrderPaymobHmac } from '@/lib/paymob';
import { triggerT1Eligible, resumeCommissionClocks } from '@/lib/commissions';
import { sendPaymentConfirmed } from '@/lib/centerNotify';
import { ownerContactByCenterId, resolveOwnerWaPhone } from '@/lib/ownerPhone';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

const paymentFailedEnabled = true; // chq_payment_failed — set to false if template gets rejected

/** Paymob expects HTTP 200 even on bad payloads to avoid aggressive retries. */
function paymobAck(body: Record<string, unknown> = {}) {
  return NextResponse.json({ received: true, ...body }, { status: 200 });
}

export async function POST(request: NextRequest) {
  let supabaseAdmin;
  try {
    supabaseAdmin = getSupabaseAdmin();
  } catch {
    return paymobAck({ error: 'misconfigured' });
  }

  const hmacFromQuery = request.nextUrl.searchParams.get('hmac') ?? '';

  let parsed: { obj?: Record<string, unknown>; hmac?: string };
  try {
    parsed = (await request.json()) as { obj?: Record<string, unknown>; hmac?: string };
  } catch {
    return paymobAck({ error: 'invalid_json' });
  }

  const hmac = hmacFromQuery || (typeof parsed.hmac === 'string' ? parsed.hmac : '');
  const obj = parsed.obj;

  if (!hmac || !obj || typeof obj !== 'object') {
    return paymobAck({ error: 'invalid_payload' });
  }

  if (!verifyCardOrderPaymobHmac(obj, hmac)) {
    console.warn('[paymob/webhook] Invalid HMAC');
    return paymobAck({ error: 'invalid_hmac' });
  }

  // IDEMPOTENCY GUARD — Paymob order id is the idempotency key (not transaction_id)
  const orderForIdem = obj.order as { id?: unknown } | null | undefined;
  const orderId =
    orderForIdem?.id !== null && orderForIdem?.id !== undefined
      ? String(orderForIdem.id)
      : '';
  if (!orderId) {
    return paymobAck({ error: 'no_order_id' });
  }

  const { data: existingSession } = await supabaseAdmin
    .from('combined_payment_sessions')
    .select('id, status')
    .eq('paymob_order_id', orderId)
    .maybeSingle();

  if (existingSession?.status === 'paid') {
    return paymobAck();
  }

  const { data: existingInvoice } = await supabaseAdmin
    .from('invoices')
    .select('id, status')
    .eq('paymob_order_id', orderId)
    .maybeSingle();

  const sessionPending = existingSession?.status === 'pending';
  if (existingInvoice?.status === 'paid' && !sessionPending) {
    return paymobAck();
  }

  try {
    const success = obj.success === true || obj.success === 'true';
    const transactionId = String(obj.id ?? '');

    /** Paymob HMAC object includes is_voided / is_refunded — used for chargebacks after capture. */
    const isChargebackLike =
      obj.is_voided === true ||
      obj.is_voided === 'true' ||
      obj.is_refunded === true ||
      obj.is_refunded === 'true';

    if (isChargebackLike) {
      const { finalizeInvoiceChargeback } = await import('@/lib/invoicePaymobPayment');
      await finalizeInvoiceChargeback(supabaseAdmin, orderId, transactionId);
    } else if (success) {
      const { tryFinalizeCombinedPaymentSession } = await import('@/lib/combinedPaymentFinalize');
      const combo = existingSession as { id?: string; status?: string } | null;
      const combined =
        combo?.id && combo.status === 'pending'
          ? await tryFinalizeCombinedPaymentSession(
              combo.id,
              supabaseAdmin,
              'webhook',
              transactionId,
            )
          : false;
      if (!combined) {
        const { finalizeCardOrderPaymentSuccess } = await import('@/lib/cardOrderPayment');
        const cardResult = await finalizeCardOrderPaymentSuccess(supabaseAdmin, orderId, transactionId);
        if (!cardResult) {
          const { finalizeInvoicePaymentSuccess } = await import('@/lib/invoicePaymobPayment');
          // Includes invoice_type signup_first_payment: pending_payment centers are finalized in processInvoiceSignupAfterPaymobSuccess.
          await finalizeInvoicePaymentSuccess(supabaseAdmin, orderId, transactionId);
        }
      }
      // Signup flow: platform_config keys auto_approve_signups, pause_new_signups (see signupPaymobAutoApprove).
      const { processSignupAutoApprovalAfterPaymobSuccess } = await import('@/lib/signupPaymobAutoApprove');
      await processSignupAutoApprovalAfterPaymobSuccess(supabaseAdmin, orderId, transactionId);

      const { data: paidInv } = await supabaseAdmin
        .from('invoices')
        .select('center_id')
        .eq('paymob_order_id', orderId)
        .eq('status', 'paid')
        .maybeSingle();
      let centerId: string | null =
        (paidInv as { center_id?: string } | null)?.center_id ?? null;
      if (!centerId) {
        const { data: paidSess } = await supabaseAdmin
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
        const { data: invRow } = await supabaseAdmin
          .from('invoices')
          .select('center_id, total_amount, billing_period_start, billing_period_end')
          .eq('paymob_order_id', orderId)
          .eq('status', 'paid')
          .maybeSingle();
        const cid = (invRow as { center_id?: string } | null)?.center_id;
        if (cid) {
          const { data: center } = await supabaseAdmin
            .from('centers')
            .select('id, name, phone')
            .eq('id', cid)
            .maybeSingle();
          if (center) {
            const ownerMap = await ownerContactByCenterId(supabaseAdmin, [cid]);
            const contact = ownerMap.get(cid);
            const ownerPhone = await resolveOwnerWaPhone(
              supabaseAdmin,
              contact?.authId ?? null,
              contact?.userPhone ?? null,
              (center as { phone?: string | null }).phone ?? null,
            );
            if (ownerPhone) {
              const start = String((invRow as { billing_period_start?: string | null }).billing_period_start ?? '');
              const end = String((invRow as { billing_period_end?: string | null }).billing_period_end ?? '');
              const periodStr = start && end ? `${start} - ${end}` : start || end || '';
              await sendPaymentConfirmed(
                supabaseAdmin,
                ownerPhone,
                String((center as { name?: string | null }).name ?? ''),
                periodStr,
                String((invRow as { total_amount?: unknown }).total_amount ?? ''),
              );
            }
          }
        } else {
          const { data: sessRow } = await supabaseAdmin
            .from('combined_payment_sessions')
            .select('center_id, total_amount, metadata')
            .eq('paymob_order_id', orderId)
            .eq('status', 'paid')
            .maybeSingle();
          const sessionCenterId = (sessRow as { center_id?: string } | null)?.center_id;
          if (sessionCenterId) {
            const { data: center } = await supabaseAdmin
              .from('centers')
              .select('id, name, phone')
              .eq('id', sessionCenterId)
              .maybeSingle();
            if (center) {
              const ownerMap = await ownerContactByCenterId(supabaseAdmin, [sessionCenterId]);
              const contact = ownerMap.get(sessionCenterId);
              const ownerPhone = await resolveOwnerWaPhone(
                supabaseAdmin,
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
                  supabaseAdmin,
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
      await finalizeCardOrderPaymentFailure(supabaseAdmin, orderId);
      const { finalizeInvoicePaymentFailure, notifySubscriptionInvoicePaymentFailed } = await import(
        '@/lib/invoicePaymobPayment'
      );
      await finalizeInvoicePaymentFailure(supabaseAdmin, orderId);
      await notifySubscriptionInvoicePaymentFailed(supabaseAdmin, orderId, paymentFailedEnabled);
    }
  } catch (e) {
    console.error('[paymob/webhook]', e);
  }

  return paymobAck();
}
