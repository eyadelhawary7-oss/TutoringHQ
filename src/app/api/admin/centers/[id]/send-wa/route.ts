import { NextResponse } from 'next/server';
import { getAdminContext } from '@/lib/admin-auth';
import { validateCSRFRequest } from '@/lib/csrf';
import { sendFreeformMessage } from '@/lib/whatsapp/client';
import { parseBodyWithLimit } from '@/lib/validate';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAdminContext(request);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!validateCSRFRequest(request, ctx.userId)) {
    return NextResponse.json({ errorKey: 'manualWA.errors.csrf' }, { status: 403 });
  }

  const { id } = await params;
  let body: { message?: string };
  try {
    body = (await parseBodyWithLimit(request, 65536)) as { message?: string };
  } catch {
    return NextResponse.json({ errorKey: 'manualWA.errors.invalidJson' }, { status: 400 });
  }

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (message.length < 5) {
    return NextResponse.json({ errorKey: 'manualWA.errors.minLength' }, { status: 400 });
  }

  const { data: center, error: centerErr } = await ctx.supabaseAdmin
    .from('centers')
    .select('id, name, phone')
    .eq('id', id)
    .maybeSingle();

  if (centerErr || !center) {
    return NextResponse.json({ error: centerErr?.message ?? 'Not found' }, { status: 404 });
  }

  const phone = String(center.phone ?? '').trim();
  if (!phone) {
    return NextResponse.json({ errorKey: 'manualWA.errors.noPhone' }, { status: 400 });
  }

  const { data: adminRow } = await ctx.supabaseAdmin.from('admin_users').select('name').eq('id', ctx.userId).maybeSingle();
  const sentBy = adminRow?.name ?? 'Admin';

  let result: { success: boolean; error?: string };
  try {
    result = await sendFreeformMessage(id, phone, message);
  } catch {
    return NextResponse.json({ errorKey: 'manualWA.errors.notConfigured' }, { status: 500 });
  }

  if (!result.success) {
    return NextResponse.json(
      { errorKey: 'manualWA.errors.sendFailed', errorDetail: result.error ?? '' },
      { status: 500 },
    );
  }

  const digits = phone.replace(/\D/g, '');

  try {
    await ctx.supabaseAdmin.from('audit_log').insert({
      center_id: id,
      user_id: ctx.userId,
      action: 'admin_manual_wa',
      entity_type: 'center',
      details: {
        message_preview: message.slice(0, 100),
        sent_to: digits,
        sent_by: sentBy,
      },
    });
  } catch {
    /* non-fatal */
  }

  return NextResponse.json({
    success: true,
    sent_to: digits,
    center_name: center.name ?? '',
  });
}
