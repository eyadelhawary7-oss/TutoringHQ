import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { finalizeInvoicePaymentFailure, finalizeInvoicePaymentSuccess } from '@/lib/invoicePaymobPayment';
import { inquirePaymobCardOrder } from '@/lib/paymobOrderInquiry';

/**
 * Public polling for subscription invoice Paymob payments.
 * Query: invoiceId (UUID).
 */
export async function GET(request: NextRequest) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
    }

    const invoiceId = request.nextUrl.searchParams.get('invoiceId')?.trim() ?? '';
    if (!invoiceId) {
      return NextResponse.json({ error: 'invoiceId required' }, { status: 400 });
    }

    const supabaseAdmin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: inv } = await supabaseAdmin
      .from('invoices')
      .select('id, status, paymob_order_id')
      .eq('id', invoiceId)
      .maybeSingle();

    if (!inv) {
      return NextResponse.json({ paid: false, failed: false });
    }

    const row = inv as { id: string; status?: string | null; paymob_order_id?: string | null };

    if (row.status === 'paid') {
      return NextResponse.json({ paid: true });
    }

    if (row.status === 'failed') {
      return NextResponse.json({ paid: false, failed: true });
    }

    const paymobOrderId = row.paymob_order_id?.trim() ?? '';
    if (!paymobOrderId) {
      return NextResponse.json({ paid: false, failed: false });
    }

    const inquiry = await inquirePaymobCardOrder(paymobOrderId);

    if (inquiry.state === 'failed') {
      await finalizeInvoicePaymentFailure(supabaseAdmin, paymobOrderId);
      return NextResponse.json({ paid: false, failed: true });
    }

    if (inquiry.state === 'paid') {
      const txId = inquiry.transactionId ?? '';
      const finalized = await finalizeInvoicePaymentSuccess(supabaseAdmin, paymobOrderId, txId);
      if (!finalized) {
        return NextResponse.json({ paid: false, failed: false });
      }
      return NextResponse.json({ paid: true });
    }

    return NextResponse.json({ paid: false, failed: false });
  } catch (e) {
    console.error('[invoice-status]', e);
    return NextResponse.json(
      { paid: false, failed: false, error: e instanceof Error ? e.message : 'Internal error' },
      { status: 500 },
    );
  }
}
