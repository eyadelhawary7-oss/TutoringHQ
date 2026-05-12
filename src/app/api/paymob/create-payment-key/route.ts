import '@/lib/paymobProductionGuard';
import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { requirePermission } from '@/lib/centerPermissions';
import { parseBodyWithLimit } from '@/lib/validate';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireCenterAuth(request);
    if (!auth.ok) return auth.response;
    // Permission gate added May 12 per docs/AUDIT_center_role_gating.md
    const permErr = requirePermission(auth, 'can_place_card_orders');
    if (permErr) return permErr;

    const apiKey = process.env.PAYMOB_API_KEY;
    const integrationId = process.env.PAYMOB_INTEGRATION_ID;
    const iframeId = process.env.PAYMOB_IFRAME_ID;
    if (!apiKey || !integrationId || !iframeId) {
      return NextResponse.json(
        { error: 'Paymob is not configured' },
        { status: 500 }
      );
    }

    let body: {
      amount?: unknown;
      cardOrderId?: unknown;
    };
    try {
      body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const amount = typeof body.amount === 'number' ? body.amount : NaN;
    const cardOrderId =
      typeof body.cardOrderId === 'string' ? body.cardOrderId.trim() : '';

    const { data: centerRow } = await auth.supabaseAdmin
      .from('centers')
      .select('name, phone')
      .eq('id', auth.centerId)
      .maybeSingle();
    const centerName = String((centerRow as { name?: string | null } | null)?.name ?? '').trim();
    const centerPhone = String((centerRow as { phone?: string | null } | null)?.phone ?? '').trim();

    if (!Number.isFinite(amount) || amount < 0 || !centerName || !centerPhone || !cardOrderId) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
    }

    const { data: orderRow, error: orderErr } = await auth.supabaseAdmin
      .from('card_orders')
      .select('id, center_id, total_amount, payment_status')
      .eq('id', cardOrderId)
      .maybeSingle();

    if (orderErr || !orderRow || orderRow.center_id !== auth.centerId) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const paySt = String((orderRow as { payment_status?: string | null }).payment_status ?? '');
    if (paySt === 'paid') {
      return NextResponse.json({ error: 'Order already paid' }, { status: 400 });
    }
    if (paySt !== 'pending_payment' && paySt !== 'unpaid') {
      return NextResponse.json({ error: 'Order not payable' }, { status: 400 });
    }

    const dbTotal = Number(orderRow.total_amount);
    if (!Number.isFinite(dbTotal) || Math.abs(dbTotal - amount) > 0.01) {
      return NextResponse.json({ error: 'Amount mismatch' }, { status: 400 });
    }

    const billingDigits = centerPhone.replace(/\D/g, '');
    const { issueCardOrderIframePayment } = await import('@/lib/paymob/issueCardOrderIframe');
    const result = await issueCardOrderIframePayment({
      supabaseAdmin: auth.supabaseAdmin,
      centerId: auth.centerId,
      cardOrderId,
      amountEgp: amount,
      centerName,
      billingPhoneDigits: billingDigits.length >= 10 ? billingDigits : `20${billingDigits.replace(/^20/, '')}`,
    });
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      paymentKey: result.paymentKey,
      iframeId: result.iframeId,
      paymobOrderId: result.paymobOrderId,
      iframeUrl: result.iframeUrl,
    });
  } catch (e) {
    console.error('[create-payment-key]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Internal error' },
      { status: 500 }
    );
  }
}
