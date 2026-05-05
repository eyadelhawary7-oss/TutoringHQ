import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdminApi } from '@/lib/admin-auth';
import { requireSuperAdminRow } from '@/lib/admin-access';
import { sendWithdrawalProcessed } from '@/lib/centerNotify';
import { formatNumber } from '@/lib/formatNumber';
import { ownerContactByCenterId, resolveOwnerWaPhone } from '@/lib/ownerPhone';
import { parseBodyWithLimit } from '@/lib/validate';

const WA_AR = 'ar';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSuperAdminApi(request);
  if (!auth.ok) return auth.response;
  const row403 = await requireSuperAdminRow(auth.supabaseAdmin, auth.userId);
  if (row403) return row403;
  // super_admin only; can_approve_signups does not apply.

  const { id: withdrawalId } = await params;

  let body: { action?: string; notes?: string };
  try {
    body = (await parseBodyWithLimit(request, 65536)) as typeof body;
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
      .select('phone, owner_name, name')
      .eq('id', w.center_id)
      .maybeSingle();

    const cRow = center as { phone?: string | null; owner_name?: string | null; name?: string | null } | null;
    const ownerMap = await ownerContactByCenterId(auth.supabaseAdmin, [w.center_id]);
    const oc = ownerMap.get(w.center_id);
    const ownerPhone = await resolveOwnerWaPhone(
      auth.supabaseAdmin,
      oc?.authId ?? null,
      oc?.userPhone,
      cRow?.phone,
    );
    if (ownerPhone) {
      const ownerName = (cRow?.owner_name ?? '').trim() || (cRow?.name ?? '').trim() || '—';
      const note = notesUpdate ?? `إنستاباي: ${instapay || '—'}`;
      try {
        await sendWithdrawalProcessed(ownerPhone, ownerName, 'قبول', cashAmount, note);
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
    .select('phone, owner_name, name')
    .eq('id', w.center_id)
    .maybeSingle();

  const cRow2 = center as { phone?: string | null; owner_name?: string | null; name?: string | null } | null;
  const ownerMap2 = await ownerContactByCenterId(auth.supabaseAdmin, [w.center_id]);
  const oc2 = ownerMap2.get(w.center_id);
  const ownerPhone2 = await resolveOwnerWaPhone(
    auth.supabaseAdmin,
    oc2?.authId ?? null,
    oc2?.userPhone,
    cRow2?.phone,
  );
  if (ownerPhone2) {
    const ownerName = (cRow2?.owner_name ?? '').trim() || (cRow2?.name ?? '').trim() || '—';
    const note = notesUpdate ?? formatNumber(credits, WA_AR) + ' نقطة أُعيدت للرصيد';
    try {
      await sendWithdrawalProcessed(ownerPhone2, ownerName, 'رفض', credits, note);
    } catch (e) {
      console.error('[admin/withdrawals] reject WA:', e);
    }
  }

  return NextResponse.json({ success: true });
}
