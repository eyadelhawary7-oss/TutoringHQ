import { NextRequest, NextResponse } from 'next/server';
import { finalizeInvoicePaymentFailure, finalizeInvoicePaymentSuccess } from '@/lib/invoicePaymobPayment';
import { inquirePaymobCardOrder } from '@/lib/paymobOrderInquiry';
import { requireTeacherAuth } from '@/lib/centerAuth';

type PollStatus = 'paid' | 'failed' | 'pending';

function pollBody(base: Record<string, unknown>, status: PollStatus) {
  return { ...base, status };
}

/**
 * Teacher-scoped Paymob poll (parity with /api/paymob/invoice-status). Polls a
 * teacher invoice by id, finalizing via the SAME idempotent finalizer (which
 * advances the teacher subscription + restores access on settle). Scoped so a
 * teacher only ever polls/settles her own invoice.
 */
export async function GET(request: NextRequest) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      return NextResponse.json({ error: 'Server misconfigured', status: 'pending' as const }, { status: 500 });
    }

    const invoiceId = request.nextUrl.searchParams.get('invoiceId')?.trim() ?? '';
    if (!invoiceId) {
      return NextResponse.json({ error: 'invoiceId required', status: 'pending' as const }, { status: 400 });
    }

    const auth = await requireTeacherAuth(request);
    if (!auth.ok) return auth.response;

    const supabaseAdmin = auth.supabaseAdmin;

    const { data: inv } = await supabaseAdmin
      .from('invoices')
      .select('id, owner_type, teacher_id, status, paymob_order_id')
      .eq('id', invoiceId)
      .maybeSingle();

    if (!inv) {
      return NextResponse.json(pollBody({ paid: false, failed: false }, 'pending'));
    }

    const row = inv as {
      id: string;
      owner_type?: string | null;
      teacher_id?: string | null;
      status?: string | null;
      paymob_order_id?: string | null;
    };

    if (row.owner_type !== 'teacher' || row.teacher_id !== auth.userId) {
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
      if (!finalized || !finalized.settled) {
        return NextResponse.json(pollBody({ paid: false, failed: false }, 'pending'));
      }
      return NextResponse.json(pollBody({ paid: true }, 'paid'));
    }

    return NextResponse.json(pollBody({ paid: false, failed: false }, 'pending'));
  } catch (e) {
    console.error('[teacher/invoice-status]', e);
    return NextResponse.json(
      pollBody(
        { paid: false, failed: false, error: e instanceof Error ? e.message : 'Internal error' },
        'pending',
      ),
      { status: 500 },
    );
  }
}
