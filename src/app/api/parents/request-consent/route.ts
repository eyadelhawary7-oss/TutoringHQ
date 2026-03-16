import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { sendTemplateMessage } from '@/lib/whatsapp/client';

const TEMPLATE_CONSENT = 'chq_parent_consent';

async function getUserContext(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) return null;

  const authHeader = request.headers.get('Authorization');
  const accessToken = authHeader?.replace('Bearer ', '');
  if (!accessToken) return null;

  const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const { data: { user }, error } = await supabaseAuth.auth.getUser();
  if (error || !user) return null;

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  const { data: userRecord } = await supabaseAdmin
    .from('users')
    .select('id, center_id')
    .eq('id', user.id)
    .single();

  if (!userRecord?.center_id) return null;

  return { centerId: userRecord.center_id, supabaseAdmin };
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getUserContext(request);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
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
