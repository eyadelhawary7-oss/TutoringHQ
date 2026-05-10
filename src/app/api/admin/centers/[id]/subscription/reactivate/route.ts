import { NextResponse } from 'next/server';
import { validateCSRFRequest } from '@/lib/csrf';
import { requireInternalAdminApi } from '@/lib/admin-auth';
import { parseBodyWithLimit } from '@/lib/validate';
import { sendFreeformMessage } from '@/lib/whatsapp/client';

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

  const { data: center, error: cErr } = await ctx.supabaseAdmin
    .from('centers')
    .select('id, phone, name, status')
    .eq('id', centerId)
    .maybeSingle();

  if (cErr || !center) {
    return NextResponse.json({ error: 'Center not found' }, { status: 404 });
  }

  const { error: upErr } = await ctx.supabaseAdmin
    .from('centers')
    .update({
      status: 'active',
      subscription_status: 'active',
      billing_status: 'active',
      suspended_at: null,
    })
    .eq('id', centerId);

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  try {
    await ctx.supabaseAdmin.from('audit_log').insert({
      center_id: centerId,
      user_id: ctx.userId,
      action: 'admin_subscription_reactivate',
      details: { reason, prior_status: (center as { status?: string }).status },
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
        `أخبار سارة${name ? ` ${name}` : ''}: تم تفعيل اشتراككم على CenterHQ من قبل الدعم. يمكنكم المتابعة استخدام المنصة.`,
      );
    } catch {
      /* non-fatal */
    }
  }

  return NextResponse.json({ ok: true });
}
