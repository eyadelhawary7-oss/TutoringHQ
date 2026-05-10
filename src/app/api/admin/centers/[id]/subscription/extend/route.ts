import { NextResponse } from 'next/server';
import { validateCSRFRequest } from '@/lib/csrf';
import { requireInternalAdminApi } from '@/lib/admin-auth';
import { parseBodyWithLimit } from '@/lib/validate';
import { autoSuspendAtFromDue, calendarAddDaysYmd } from '@/lib/billingSchedule';
import { sendFreeformMessage } from '@/lib/whatsapp/client';
import { todayISO } from '@/lib/parentPack';

export const dynamic = 'force-dynamic';

function parseReason(body: Record<string, unknown>): string | null {
  const r = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (r.length < 10 || r.length > 500) return null;
  return r;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireInternalAdminApi(request);
  if (!ctx.ok) return ctx.response;
  if (!validateCSRFRequest(request, ctx.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
  }

  const { id: centerId } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const reason = parseReason(body);
  if (!reason) {
    return NextResponse.json({ error: 'Reason must be 10–500 characters' }, { status: 400 });
  }

  const daysRaw = body.days;
  const days =
    typeof daysRaw === 'number'
      ? daysRaw
      : typeof daysRaw === 'string'
        ? Number(daysRaw)
        : NaN;
  if (!Number.isFinite(days) || days < 1 || days > 730) {
    return NextResponse.json({ error: 'days must be between 1 and 730' }, { status: 400 });
  }

  const { data: center, error: cErr } = await ctx.supabaseAdmin
    .from('centers')
    .select('id, next_payment_due, phone, name')
    .eq('id', centerId)
    .maybeSingle();

  if (cErr || !center) {
    return NextResponse.json({ error: 'Center not found' }, { status: 404 });
  }

  const dueRaw = (center as { next_payment_due?: string | null }).next_payment_due;
  const base =
    typeof dueRaw === 'string' && dueRaw.length >= 10 ? dueRaw.slice(0, 10) : todayISO();

  const newDue = calendarAddDaysYmd(base, Math.round(days));
  const autoSus = autoSuspendAtFromDue(newDue);

  const { error: upErr } = await ctx.supabaseAdmin
    .from('centers')
    .update({
      next_payment_due: newDue,
      auto_suspend_at: autoSus,
      billing_status: 'active',
      subscription_status: 'active',
    })
    .eq('id', centerId);

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  try {
    await ctx.supabaseAdmin.from('audit_log').insert({
      center_id: centerId,
      user_id: ctx.userId,
      action: 'admin_subscription_extend',
      details: { reason, days: Math.round(days), next_payment_due: newDue },
    });
  } catch {
    /* non-fatal */
  }

  const phone = String((center as { phone?: string | null }).phone ?? '').trim();
  const name = String((center as { name?: string | null }).name ?? '').trim();
  if (phone) {
    try {
      await sendFreeformMessage(
        centerId,
        phone,
        `مرحباً${name ? ` ${name}` : ''}، تم تمديد موعد استحقاق اشتراككم على CenterHQ بمقدار ${Math.round(days)} يوماً حسب تنسيق مع الدعم. المستحق التالي: ${newDue}. شكراً لثقتكم.`,
      );
    } catch {
      /* non-fatal */
    }
  }

  return NextResponse.json({ ok: true, next_payment_due: newDue, auto_suspend_at: autoSus });
}
