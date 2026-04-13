import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { createAction } from '@/lib/ceo';
import { sendFreeformMessage } from '@/lib/whatsapp/client';
import { formatDate } from '@/lib/formatNumber';

export const dynamic = 'force-dynamic';

const ALLOWED_REASONS = new Set([
  'moving_competitor',
  'too_expensive',
  'center_closing',
  'not_using',
  'other',
]);

function periodEndLabel(ymd: string | null | undefined): string {
  if (!ymd) return '—';
  const d = new Date(`${ymd.slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? ymd.slice(0, 10) : formatDate(d, 'ar');
}

export async function POST(request: NextRequest) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;
  if (auth.role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { reason?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason || !ALLOWED_REASONS.has(reason)) {
    return NextResponse.json({ error: 'Invalid cancellation reason' }, { status: 400 });
  }

  const { supabaseAdmin, centerId } = auth;

  const { data: center, error: fetchErr } = await supabaseAdmin
    .from('centers')
    .select(
      'id, name, phone, status, subscription_status, current_period_end, next_payment_due',
    )
    .eq('id', centerId)
    .maybeSingle();

  if (fetchErr || !center) {
    return NextResponse.json({ error: 'Center not found' }, { status: 404 });
  }

  const c = center as {
    name?: string | null;
    phone?: string | null;
    status?: string | null;
    subscription_status?: string | null;
    current_period_end?: string | null;
    next_payment_due?: string | null;
  };

  if (c.status === 'pending_cancellation') {
    return NextResponse.json({ error: 'Cancellation already requested' }, { status: 400 });
  }
  if (c.status !== 'active') {
    return NextResponse.json({ error: 'Center is not active' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const periodEnd =
    (c.current_period_end && String(c.current_period_end).slice(0, 10)) ||
    (c.next_payment_due && String(c.next_payment_due).slice(0, 10)) ||
    null;

  const { error: updErr } = await supabaseAdmin
    .from('centers')
    .update({
      status: 'pending_cancellation',
      cancellation_reason: reason,
      cancellation_requested_at: now,
    })
    .eq('id', centerId)
    .eq('status', 'active');

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  try {
    await createAction(supabaseAdmin, {
      type: 'cancellation_request',
      priority: 'red',
      center_id: centerId,
      title: `Cancellation request: ${c.name ?? centerId}`,
      subtitle: `Reason: ${reason}. Period ends: ${periodEnd ?? '—'}`,
      revenue_at_risk: 0,
      auto_generated: true,
    });
  } catch (e) {
    console.error('[billing/cancel] ceo_action_queue:', e);
  }

  const phone = String(c.phone ?? '').trim();
  const peLabel = periodEndLabel(periodEnd);
  if (phone) {
    try {
      await sendFreeformMessage(
        centerId,
        phone,
        `تم استلام طلب إلغاء اشتراكك. سيظل سنترك نشطاً حتى ${peLabel}.`,
      );
    } catch (e) {
      console.error('[billing/cancel] WA:', e);
    }
  }

  return NextResponse.json({
    success: true,
    periodEnd: periodEnd ?? null,
  });
}
