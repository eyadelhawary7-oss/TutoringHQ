import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { finalizeInvoicePaymentFailure, finalizeInvoicePaymentSuccess } from '@/lib/invoicePaymobPayment';
import { inquirePaymobCardOrder } from '@/lib/paymobOrderInquiry';

/**
 * Polling for Paymob: either invoiceId (UUID) or paymobOrderId (combined session / invoice checkout).
 */
export async function GET(request: NextRequest) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
    }

    const invoiceId = request.nextUrl.searchParams.get('invoiceId')?.trim() ?? '';
    const paymobOrderIdParam = request.nextUrl.searchParams.get('paymobOrderId')?.trim() ?? '';

    if (!invoiceId && !paymobOrderIdParam) {
      return NextResponse.json({ error: 'invoiceId or paymobOrderId required' }, { status: 400 });
    }

    const supabaseAdmin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (invoiceId) {
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
    }

    const { data: sess } = await supabaseAdmin
      .from('combined_payment_sessions')
      .select('id, status')
      .eq('paymob_order_id', paymobOrderIdParam)
      .maybeSingle();

    if (sess && (sess as { status?: string }).status === 'paid') {
      return NextResponse.json({ paid: true });
    }

    const { data: invByOrder } = await supabaseAdmin
      .from('invoices')
      .select('id, status, paymob_order_id')
      .eq('paymob_order_id', paymobOrderIdParam)
      .maybeSingle();

    if (invByOrder) {
      const ir = invByOrder as { id: string; status?: string | null; paymob_order_id?: string | null };
      if (ir.status === 'paid') {
        return NextResponse.json({ paid: true });
      }
      if (ir.status === 'failed') {
        return NextResponse.json({ paid: false, failed: true });
      }
      const inquiryInv = await inquirePaymobCardOrder(paymobOrderIdParam);
      if (inquiryInv.state === 'failed') {
        await finalizeInvoicePaymentFailure(supabaseAdmin, paymobOrderIdParam);
        return NextResponse.json({ paid: false, failed: true });
      }
      if (inquiryInv.state === 'paid') {
        const txId = inquiryInv.transactionId ?? '';
        const finalized = await finalizeInvoicePaymentSuccess(supabaseAdmin, paymobOrderIdParam, txId);
        if (finalized) {
          return NextResponse.json({ paid: true });
        }
      }
    }

    if (sess && (sess as { status?: string }).status === 'pending') {
      const inquiry = await inquirePaymobCardOrder(paymobOrderIdParam);
      if (inquiry.state === 'failed') {
        return NextResponse.json({ paid: false, failed: true });
      }
      if (inquiry.state === 'paid') {
        const txId = inquiry.transactionId ?? '';
        const { tryFinalizeCombinedPaymentSession } = await import('@/lib/combinedPaymentFinalize');
        const sid = (sess as { id: string }).id;
        await tryFinalizeCombinedPaymentSession(sid, supabaseAdmin, 'cron', txId);
        return NextResponse.json({ paid: true });
      }
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
