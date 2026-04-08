import { NextRequest, NextResponse } from 'next/server';
import { finalizeInvoicePaymentFailure, finalizeInvoicePaymentSuccess } from '@/lib/invoicePaymobPayment';
import { inquirePaymobCardOrder } from '@/lib/paymobOrderInquiry';
import { requireCenterAuth } from '@/lib/centerAuth';

type PollStatus = 'paid' | 'failed' | 'pending';

function pollBody(base: Record<string, unknown>, status: PollStatus) {
  return { ...base, status };
}

/**
 * Polling for Paymob: either invoiceId (UUID) or paymobOrderId (combined session / invoice checkout).
 * Requires center Bearer auth; only returns or finalizes data for the caller's center.
 */
export async function GET(request: NextRequest) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      return NextResponse.json({ error: 'Server misconfigured', status: 'pending' as const }, { status: 500 });
    }

    const invoiceId = request.nextUrl.searchParams.get('invoiceId')?.trim() ?? '';
    const paymobOrderIdParam = request.nextUrl.searchParams.get('paymobOrderId')?.trim() ?? '';

    if (!invoiceId && !paymobOrderIdParam) {
      return NextResponse.json({ error: 'invoiceId or paymobOrderId required', status: 'pending' as const }, { status: 400 });
    }

    const auth = await requireCenterAuth(request);
    if (!auth.ok) return auth.response;

    const supabaseAdmin = auth.supabaseAdmin;

    if (invoiceId) {
      const { data: inv } = await supabaseAdmin
        .from('invoices')
        .select('id, status, paymob_order_id, center_id')
        .eq('id', invoiceId)
        .maybeSingle();

      if (!inv) {
        return NextResponse.json(pollBody({ paid: false, failed: false }, 'pending'));
      }

      const row = inv as {
        id: string;
        status?: string | null;
        paymob_order_id?: string | null;
        center_id?: string | null;
      };

      if (row.center_id !== auth.centerId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      if (row.status === 'paid') {
        return NextResponse.json(pollBody({ paid: true }, 'paid'));
      }

      if (row.status === 'failed') {
        return NextResponse.json(pollBody({ paid: false, failed: true }, 'failed'));
      }

      const paymobOrderId = row.paymob_order_id?.trim() ?? '';
      if (!paymobOrderId) {
        return NextResponse.json(pollBody({ paid: false, failed: false }, 'pending'));
      }

      const inquiry = await inquirePaymobCardOrder(paymobOrderId);

      if (inquiry.state === 'failed') {
        await finalizeInvoicePaymentFailure(supabaseAdmin, paymobOrderId);
        return NextResponse.json(pollBody({ paid: false, failed: true }, 'failed'));
      }

      if (inquiry.state === 'paid') {
        const txId = inquiry.transactionId ?? '';
        const finalized = await finalizeInvoicePaymentSuccess(supabaseAdmin, paymobOrderId, txId);
        if (!finalized) {
          return NextResponse.json(pollBody({ paid: false, failed: false }, 'pending'));
        }
        return NextResponse.json(pollBody({ paid: true }, 'paid'));
      }

      return NextResponse.json(pollBody({ paid: false, failed: false }, 'pending'));
    }

    const [{ data: sess }, { data: invByOrder }] = await Promise.all([
      supabaseAdmin
        .from('combined_payment_sessions')
        .select('id, status, center_id')
        .eq('paymob_order_id', paymobOrderIdParam)
        .maybeSingle(),
      supabaseAdmin
        .from('invoices')
        .select('id, status, paymob_order_id, center_id')
        .eq('paymob_order_id', paymobOrderIdParam)
        .maybeSingle(),
    ]);

    const sessRow = sess as { id: string; status?: string; center_id?: string | null } | null;
    const invRow = invByOrder as {
      id: string;
      status?: string | null;
      paymob_order_id?: string | null;
      center_id?: string | null;
    } | null;

    if (!sessRow && !invRow) {
      return NextResponse.json(pollBody({ paid: false, failed: false }, 'pending'));
    }

    if (
      (sessRow && sessRow.center_id !== auth.centerId) ||
      (invRow && invRow.center_id !== auth.centerId)
    ) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (sessRow && (sessRow as { status?: string }).status === 'paid') {
      return NextResponse.json(pollBody({ paid: true }, 'paid'));
    }

    if (invRow) {
      const ir = invRow;
      if (ir.status === 'paid') {
        return NextResponse.json(pollBody({ paid: true }, 'paid'));
      }
      if (ir.status === 'failed') {
        return NextResponse.json(pollBody({ paid: false, failed: true }, 'failed'));
      }
      const inquiryInv = await inquirePaymobCardOrder(paymobOrderIdParam);
      if (inquiryInv.state === 'failed') {
        await finalizeInvoicePaymentFailure(supabaseAdmin, paymobOrderIdParam);
        return NextResponse.json(pollBody({ paid: false, failed: true }, 'failed'));
      }
      if (inquiryInv.state === 'paid') {
        const txId = inquiryInv.transactionId ?? '';
        const finalized = await finalizeInvoicePaymentSuccess(supabaseAdmin, paymobOrderIdParam, txId);
        if (finalized) {
          return NextResponse.json(pollBody({ paid: true }, 'paid'));
        }
      }
    }

    if (sessRow && (sessRow as { status?: string }).status === 'pending') {
      const inquiry = await inquirePaymobCardOrder(paymobOrderIdParam);
      if (inquiry.state === 'failed') {
        return NextResponse.json(pollBody({ paid: false, failed: true }, 'failed'));
      }
      if (inquiry.state === 'paid') {
        const txId = inquiry.transactionId ?? '';
        const { tryFinalizeCombinedPaymentSession } = await import('@/lib/combinedPaymentFinalize');
        const sid = sessRow.id;
        await tryFinalizeCombinedPaymentSession(sid, supabaseAdmin, 'cron', txId);
        return NextResponse.json(pollBody({ paid: true }, 'paid'));
      }
    }

    return NextResponse.json(pollBody({ paid: false, failed: false }, 'pending'));
  } catch (e) {
    console.error('[invoice-status]', e);
    return NextResponse.json(
      pollBody(
        {
          paid: false,
          failed: false,
          error: e instanceof Error ? e.message : 'Internal error',
        },
        'pending',
      ),
      { status: 500 },
    );
  }
}
