import { NextRequest, NextResponse } from 'next/server';
import { isFeatureEnabled } from '@/lib/features';
import { verifyPaymobHmac } from '@/lib/paymob';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  if (!isFeatureEnabled('PAYMOB_ENABLED')) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const body = (await request.json()) as { hmac?: string; obj?: Record<string, unknown> };
    const hmac = body.hmac;
    const obj = body.obj;

    if (!hmac || !obj) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    if (!verifyPaymobHmac(obj, hmac)) {
      return NextResponse.json({ error: 'Invalid HMAC' }, { status: 401 });
    }

    const transaction = obj;
    const success =
      transaction.success === true || transaction.success === 'true';

    const order = transaction.order as Record<string, unknown> | undefined;
    const merchantOrderId = order?.merchant_order_id as string | undefined;
    const centerId = merchantOrderId?.split('-')[0];

    const amountCents = parseInt(String(transaction.amount_cents ?? 0), 10);

    if (!centerId) {
      return NextResponse.json({ error: 'No center ID' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

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

      // Note: student_id is intentionally null here.
      // Paymob processes center subscription payments, not student sessions.
      // The payments table allows null student_id for this use case.
      // See migration: ALTER TABLE payments ALTER COLUMN student_id DROP NOT NULL
      await supabase.from('payments').insert({
        center_id: centerId,
        amount: amountCents / 100,
        method: 'bank_transfer',
        status: 'confirmed',
        paid_at: new Date().toISOString(),
        student_id: null, // Paymob is a center billing payment, not student
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

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('Paymob webhook error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Webhook failed' },
      { status: 500 }
    );
  }
}
