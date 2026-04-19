import { NextRequest, NextResponse } from 'next/server';
import { isFeatureEnabled } from '@/lib/features';
import { verifyPaymobHmac } from '@/lib/paymob';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

/** Paymob and proxies expect HTTP 200 on all outcomes to limit retries. */
function ack(body: Record<string, unknown> = {}) {
  return NextResponse.json({ received: true, ...body }, { status: 200 });
}

export async function POST(request: NextRequest) {
  if (!isFeatureEnabled('PAYMOB_ENABLED')) {
    return ack({ error: 'disabled' });
  }

  try {
    const body = (await request.json()) as { hmac?: string; obj?: Record<string, unknown> };
    const hmac = body.hmac;
    const obj = body.obj;

    if (!hmac || !obj) {
      return ack({ error: 'invalid_payload' });
    }

    if (!verifyPaymobHmac(obj, hmac)) {
      return ack({ error: 'invalid_hmac' });
    }

    let supabase;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return ack({ error: 'misconfigured' });
    }

    const transaction = obj;
    const success =
      transaction.success === true || transaction.success === 'true';

    const order = transaction.order as Record<string, unknown> | undefined;
    const merchantOrderId = order?.merchant_order_id as string | undefined;
    const centerId = merchantOrderId?.split('-')[0];

    const amountCents = parseInt(String(transaction.amount_cents ?? 0), 10);

    if (!centerId) {
      return ack({ error: 'no_center_id' });
    }

    if (success) {
      const nextBillingDate = new Date();
      nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);

      await supabase
        .from('centers')
        .update({
          subscription_status: 'active',
          billing_status: 'paid',
          last_payment_date: new Date().toISOString(),
          next_payment_due: nextBillingDate.toISOString().split('T')[0],
        })
        .eq('id', centerId);

      await supabase.from('payments').insert({
        center_id: centerId,
        amount: amountCents / 100,
        method: 'bank_transfer',
        status: 'confirmed',
        paid_at: new Date().toISOString(),
        student_id: null,
        notes: `Paymob transaction ${transaction.id}`,
      });
    } else {
      await supabase
        .from('centers')
        .update({
          billing_status: 'overdue',
        })
        .eq('id', centerId);
    }

    return ack();
  } catch (err) {
    console.error('Paymob webhook error:', err);
    return ack({ error: 'exception' });
  }
}
