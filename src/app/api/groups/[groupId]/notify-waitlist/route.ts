import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { sendWhatsAppMessage, normalizeWhatsAppNumber } from '@/lib/whatsapp';

/** POST: When a spot opens, notify first waitlist parent via WA. Called after member removal. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> },
) {
  try {
    const auth = await requireCenterAuth(request);
    if (!auth.ok) return auth.response;

    const { groupId } = await params;
    if (!groupId) return NextResponse.json({ error: 'groupId required' }, { status: 400 });

    const { supabaseAdmin } = auth;

    const { data: group } = await supabaseAdmin
      .from('student_groups')
      .select('id, name, center_id')
      .eq('id', groupId)
      .single();

    if (!group || (group as { center_id: string }).center_id !== auth.centerId) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }

    const { data: firstWaitlist } = await supabaseAdmin
      .from('students')
      .select('id, name, parent_phone')
      .eq('waitlist_group_id', groupId)
      .not('parent_phone', 'is', null)
      .order('waitlist_position', { ascending: true, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (!firstWaitlist) {
      return NextResponse.json({ ok: true, notified: false, message: 'No waitlist or no parent phone' });
    }

    const phone = (firstWaitlist as { parent_phone?: string }).parent_phone;
    if (!phone) {
      return NextResponse.json({ ok: true, notified: false });
    }

    const groupName = (group as { name?: string }).name ?? 'المجموعة';
    const studentName = (firstWaitlist as { name?: string }).name ?? '';
    const msg = `مرحباً، متاح مكان في مجموعة "${groupName}" لطفلك ${studentName}. هل ترغب بالتسجيل؟ رد بـ نعم أو لا`;

    const normalized = normalizeWhatsAppNumber(phone);
    const sent = await sendWhatsAppMessage(normalized, msg);

    if (sent) {
      await supabaseAdmin.from('waitlist_notifications').insert({
        student_id: firstWaitlist.id,
        group_id: groupId,
        response: 'pending',
      });
    }

    return NextResponse.json({ ok: true, notified: sent });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
