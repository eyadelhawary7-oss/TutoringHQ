import { NextRequest, NextResponse } from 'next/server';
import { sendTemplateMessage } from '@/lib/whatsapp/client';
import { WA_TEMPLATES } from '@/lib/parentPack';
import { requireOwnerAdminCenter } from '@/lib/requireOwnerAdminCenter';
import { parseBodyWithLimit } from '@/lib/validate';

export const dynamic = 'force-dynamic';

export async function PATCH(request: NextRequest) {
  const ctx = await requireOwnerAdminCenter(request);
  if (ctx instanceof NextResponse) return ctx;

  const { supabaseAdmin, centerId } = ctx;

  let body: { enabled?: boolean };
  try {
    body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled boolean required' }, { status: 400 });
  }

  const { data: ctr } = await supabaseAdmin.from('centers').select('name').eq('id', centerId).maybeSingle();

  if (body.enabled === true) {
    await supabaseAdmin
      .from('centers')
      .update({
        parent_pack_enabled: true,
        parent_pack_activated_at: new Date().toISOString(),
      })
      .eq('id', centerId);

    const { data: students } = await supabaseAdmin
      .from('students')
      .select('id, name, parent_phone')
      .eq('center_id', centerId)
      .eq('parent_pack_opted_in', true)
      .not('parent_phone', 'is', null)
      .eq('is_active', true);

    const list = students ?? [];
    await supabaseAdmin
      .from('centers')
      .update({ parent_pack_active_parents: list.length })
      .eq('id', centerId);

    const centerName = ctr?.name ?? '';
    for (const student of list) {
      if (!student.parent_phone) continue;
      await sendTemplateMessage(centerId, student.parent_phone, WA_TEMPLATES.PARENT_WELCOME, {
        '1': student.name,
        '2': centerName,
        '3': student.name,
      });
    }

    return NextResponse.json({ success: true, activeParents: list.length });
  }

  await supabaseAdmin
    .from('centers')
    .update({
      parent_pack_enabled: false,
      pack_request_status: 'none',
    })
    .eq('id', centerId);

  return NextResponse.json({ success: true, warning: 'billing_continues_this_month' });
}
