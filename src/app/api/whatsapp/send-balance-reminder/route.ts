import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { sendTemplateMessage } from '@/lib/whatsapp/client';

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

const BALANCE_REMINDER_TEMPLATE = 'chq_balance_reminder';

export async function POST(request: NextRequest) {
  try {
    const ctx = await getUserContext(request);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const studentId = body.student_id as string | undefined;
    const studentIds = body.student_ids as string[] | undefined;

    const ids = studentIds ?? (studentId ? [studentId] : []);
    if (ids.length === 0) {
      return NextResponse.json({ error: 'student_id or student_ids required' }, { status: 400 });
    }

    const { centerId, supabaseAdmin } = ctx;

    const { data: students } = await supabaseAdmin
      .from('students')
      .select('id, name, phone, balance_due')
      .eq('center_id', centerId)
      .in('id', ids)
      .gt('balance_due', 0);

    const list = (students || []) as { id: string; name: string; phone: string | null; balance_due: number }[];
    const results: { student_id: string; success: boolean; error?: string }[] = [];

    for (const st of list) {
      const phone = st.phone?.trim();
      if (!phone) {
        results.push({ student_id: st.id, success: false, error: 'No phone' });
        continue;
      }

      const variables: Record<string, string> = {
        '1': st.name ?? '',
        '2': String(Number(st.balance_due).toLocaleString('en-US')),
      };

      const result = await sendTemplateMessage(centerId, phone, BALANCE_REMINDER_TEMPLATE, variables);
      results.push({ student_id: st.id, success: result.success, error: result.error });
    }

    const successCount = results.filter((r) => r.success).length;
    return NextResponse.json({ ok: true, sent: successCount, results });
  } catch (error) {
    console.error('[send-balance-reminder] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
