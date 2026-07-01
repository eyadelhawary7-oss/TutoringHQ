import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { sendTemplateMessage } from '@/lib/whatsapp/client';
import { parseBodyWithLimit } from '@/lib/validate';

const TEMPLATE_CONSENT = 'chq_parent_consent';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireCenterAuth(request);
    if (!auth.ok) return auth.response;
    const ctx = { centerId: auth.centerId, supabaseAdmin: auth.supabaseAdmin };

    const body = (await parseBodyWithLimit(request, 65536).catch(() => ({}))) as Record<string, unknown>;
    const studentId = body.student_id as string | undefined;
    const parentPhone = body.parent_phone as string | undefined;

    if (!studentId || !parentPhone?.trim()) {
      return NextResponse.json({ error: 'student_id and parent_phone required' }, { status: 400 });
    }

    const { centerId, supabaseAdmin } = ctx;

    const { data: student, error: studentErr } = await supabaseAdmin
      .from('students')
      .select('id, name, center_id')
      .eq('id', studentId)
      .eq('center_id', centerId)
      .single();

    if (studentErr || !student) {
      return NextResponse.json({ error: 'Student not found' }, { status: 404 });
    }

    const normalized = parentPhone.replace(/\D/g, '');
    const phone =
      normalized.length === 11 && normalized.startsWith('01')
        ? '+2' + normalized
        : normalized.length === 10 && normalized.startsWith('1')
          ? '+2' + normalized
          : parentPhone.startsWith('+') ? parentPhone : '+2' + normalized.slice(-10);

    await supabaseAdmin
      .from('students')
      .update({
        parent_phone: phone,
        parent_phone_verified: false,
        parent_consent_given: false,
        parent_consent_at: null,
      })
      .eq('id', studentId)
      .eq('center_id', centerId);

    const variables: Record<string, string> = {
      '1': (student as { name?: string }).name ?? '',
    };

    const result = await sendTemplateMessage(centerId, phone, TEMPLATE_CONSENT, variables);

    if (!result.success) {
      return NextResponse.json({ error: result.error ?? 'Failed to send' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, sent: true });
  } catch (error) {
    console.error('[request-consent] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
