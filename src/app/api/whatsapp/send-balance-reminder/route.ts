import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { sendTemplateMessage } from '@/lib/whatsapp/client';
import { formatNumber } from '@/lib/formatNumber';
import { parseBodyWithLimit } from '@/lib/validate';
import { centerAccessGateResponse } from '@/lib/centerAccessGate';
import { getStudentBalances } from '@/lib/studentBalance';
import { validateCSRFRequest } from '@/lib/csrf';

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

  return { centerId: userRecord.center_id, supabaseAdmin, userId: user.id };
}

const BALANCE_REMINDER_TEMPLATE = 'chq_balance_reminder';

export async function POST(request: NextRequest) {
  try {
    const ctx = await getUserContext(request);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Fail-closed CSRF on this state-changing POST (sends WhatsApp to parents). Same pattern
    // as the pay route: validateCSRFRequest returns false when CSRF_SECRET is unset/malformed.
    if (!validateCSRFRequest(request, ctx.userId)) {
      return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
    }

    const body = (await parseBodyWithLimit(request, 65536).catch(() => ({}))) as Record<string, unknown>;
    const studentId = body.student_id as string | undefined;
    const studentIds = body.student_ids as string[] | undefined;

    const ids = studentIds ?? (studentId ? [studentId] : []);
    if (ids.length === 0) {
      return NextResponse.json({ error: 'student_id or student_ids required' }, { status: 400 });
    }

    const { centerId, supabaseAdmin } = ctx;

    // Part 6 (CLOSE as leak): inherit the suspension / lock gate the hand-rolled
    // auth skipped. A locked centre must not send outbound WhatsApp to parents.
    const gate = await centerAccessGateResponse(supabaseAdmin, centerId);
    if (gate) return gate;

    const { data: students } = await supabaseAdmin
      .from('students')
      .select('id, name, phone')
      .eq('center_id', centerId)
      .in('id', ids);

    const balances = await getStudentBalances(supabaseAdmin, { centerId, activeOnly: true });

    const list = ((students || []) as { id: string; name: string; phone: string | null }[])
      .map((s) => ({ ...s, balance: balances.get(s.id)?.balance ?? 0 }))
      .filter((s) => s.balance > 0);
    const results: { student_id: string; success: boolean; error?: string }[] = [];

    for (const st of list) {
      const phone = st.phone?.trim();
      if (!phone) {
        results.push({ student_id: st.id, success: false, error: 'No phone' });
        continue;
      }

      const variables: Record<string, string> = {
        '1': st.name ?? '',
        '2': formatNumber(Number(st.balance), 'ar'),
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
