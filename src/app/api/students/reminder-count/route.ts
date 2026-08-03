import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

/**
 * How many balance reminders this center has actually SENT to one student.
 *
 * Merged-Center-Students §03 draws "…· reminded twice" in the outstanding hero.
 * The tables that name sounds like — `wa_messages` and `whatsapp_messages` —
 * are both 0 rows with NO WRITER ANYWHERE in src/ (grep confirms), so neither
 * can back it. The live outbound log is `wa_message_queue` (235 rows), written
 * by src/lib/whatsapp/client.ts, and it has NO student_id — only `to_phone`.
 *
 * So the count is a phone-string match, and it is deliberately conservative:
 *   • template_name = the exact template send-balance-reminder sends
 *   • status = 'sent' (queued-but-failed is not a reminder the parent received)
 *   • to_phone = the student's phone, which is what that route sends to
 *     (route line 86 reads students.phone, NOT parent_phone)
 *
 * A student with no phone can never match, and the caller MUST omit the clause
 * rather than print "reminded 0 times" — a zero here means "we cannot show
 * this", not "we never reminded them".
 *
 * wa_message_queue is service-role-only under RLS (`wa_message_queue_service_only`),
 * so this cannot be read from the browser client — hence the route.
 */
const BALANCE_REMINDER_TEMPLATE = 'chq_balance_reminder';

/** Digit-only tail comparison — the queue stores whatever form the sender used. */
function phoneTail(raw: string | null | undefined): string | null {
  const d = (raw ?? '').replace(/\D/g, '');
  return d.length >= 9 ? d.slice(-9) : null;
}

export async function GET(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Not configured' }, { status: 500 });
  }

  const accessToken = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')?.trim();
  if (!accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const studentId = request.nextUrl.searchParams.get('student_id');
  if (!studentId) return NextResponse.json({ error: 'student_id required' }, { status: 400 });

  const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const {
    data: { user },
    error,
  } = await supabaseAuth.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } });

  const { data: userRecord } = await admin
    .from('users')
    .select('center_id')
    .eq('id', user.id)
    .maybeSingle();
  const centerId = (userRecord as { center_id?: string | null } | null)?.center_id ?? null;
  if (!centerId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Tenant check: the student must belong to the caller's center. Never trust
  // the id in the query string.
  const { data: student } = await admin
    .from('students')
    .select('id, phone')
    .eq('id', studentId)
    .eq('center_id', centerId)
    .maybeSingle();
  if (!student) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const tail = phoneTail((student as { phone?: string | null }).phone);
  if (!tail) return NextResponse.json({ count: 0, matchable: false });

  const { data: rows } = await admin
    .from('wa_message_queue')
    .select('to_phone')
    .eq('center_id', centerId)
    .eq('template_name', BALANCE_REMINDER_TEMPLATE)
    .eq('status', 'sent');

  const count = ((rows ?? []) as { to_phone: string }[]).filter(
    (r) => phoneTail(r.to_phone) === tail,
  ).length;

  return NextResponse.json({ count, matchable: true });
}
