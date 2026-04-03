import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdminApi } from '@/lib/admin-auth';
import { sendFreeformMessage } from '@/lib/whatsapp/client';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSuperAdminApi(request);
  if (!auth.ok) return auth.response;

  const { id: withdrawalId } = await params;

  let body: { action?: string; notes?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const action = body.action;
  if (action !== 'mark_paid' && action !== 'reject') {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  const { data: row, error: fetchErr } = await auth.supabaseAdmin
    .from('withdrawal_requests')
    .select(
      'id, center_id, credits_deducted, cash_amount, instapay_number, status',
    )
    .eq('id', withdrawalId)
    .maybeSingle();

  if (fetchErr || !row) {
    return NextResponse.json({ error: 'Withdrawal not found' }, { status: 404 });
  }

  const w = row as {
    center_id: string;
    credits_deducted: number | string | null;
    cash_amount: number | string | null;
    instapay_number: string | null;
    status: string | null;
  };

  if (w.status !== 'pending') {
    return NextResponse.json({ error: 'Request is not pending' }, { status: 400 });
  }

  const credits = Number(w.credits_deducted ?? 0);
  const cashAmount = Number(w.cash_amount ?? 0);
  const instapay = String(w.instapay_number ?? '').trim();

  if (!Number.isFinite(credits) || credits <= 0) {
    return NextResponse.json({ error: 'Invalid credits on request' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const notesUpdate =
    typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;

  if (action === 'mark_paid') {
    const { error: cancelErr } = await auth.supabaseAdmin.rpc('cancel_reservation_atomic', {
      p_center_id: w.center_id,
      p_amount: credits,
    });

    if (cancelErr) {
      console.error('[admin/withdrawals] cancel_reservation_atomic', cancelErr);
      return NextResponse.json({ error: cancelErr.message }, { status: 500 });
    }

    const { error: spendErr } = await auth.supabaseAdmin.rpc('spend_credits_atomic', {
      p_center_id: w.center_id,
      p_amount: credits,
      p_reference_id: withdrawalId,
      p_reference_type: 'withdrawal',
    });

    if (spendErr) {
      console.error('[admin/withdrawals] spend_credits_atomic', spendErr);
      return NextResponse.json({ error: spendErr.message }, { status: 500 });
    }

    const { error: updErr } = await auth.supabaseAdmin
      .from('withdrawal_requests')
      .update({
        status: 'paid',
        processed_at: now,
        processed_by: auth.userId,
        ...(notesUpdate ? { notes: notesUpdate } : {}),
      })
      .eq('id', withdrawalId)
      .eq('status', 'pending');

    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }

    const { data: center } = await auth.supabaseAdmin
      .from('centers')
      .select('phone')
      .eq('id', w.center_id)
      .maybeSingle();

    const phone = String((center as { phone?: string | null } | null)?.phone ?? '').trim();
    if (phone) {
      const cashStr = cashAmount.toLocaleString('en-US');
      const msg = `تم معالجة طلب سحب رصيدك. ستصل ${cashStr} جنيه على رقم ${instapay || '—'} خلال 24 ساعة.`;
      try {
        await sendFreeformMessage(w.center_id, phone, msg);
      } catch (e) {
        console.error('[admin/withdrawals] mark_paid WA:', e);
      }
    }

    return NextResponse.json({ success: true });
  }

  // reject
  const { error: cancelErr } = await auth.supabaseAdmin.rpc('cancel_reservation_atomic', {
    p_center_id: w.center_id,
    p_amount: credits,
  });

  if (cancelErr) {
    console.error('[admin/withdrawals] reject cancel_reservation_atomic', cancelErr);
    return NextResponse.json({ error: cancelErr.message }, { status: 500 });
  }

  const { error: updErr } = await auth.supabaseAdmin
    .from('withdrawal_requests')
    .update({
      status: 'rejected',
      processed_at: now,
      processed_by: auth.userId,
      ...(notesUpdate ? { notes: notesUpdate } : {}),
    })
    .eq('id', withdrawalId)
    .eq('status', 'pending');

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  const { data: center } = await auth.supabaseAdmin
    .from('centers')
    .select('phone')
    .eq('id', w.center_id)
    .maybeSingle();

  const phone = String((center as { phone?: string | null } | null)?.phone ?? '').trim();
  if (phone) {
    const cr = credits.toLocaleString('en-US');
    const msg = `عذراً، تم رفض طلب سحب رصيدك. تم إعادة ${cr} نقطة لرصيدك.`;
    try {
      await sendFreeformMessage(w.center_id, phone, msg);
    } catch (e) {
      console.error('[admin/withdrawals] reject WA:', e);
    }
  }

  return NextResponse.json({ success: true });
}
