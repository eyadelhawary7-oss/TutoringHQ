import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { parseBodyWithLimit } from '@/lib/validate';
import { getClientIp, rateLimit, rateLimitExceededResponse } from '@/lib/ratelimit';

/**
 * Public: create inactive student + pending_enrollment (v3 join flow).
 */
export async function POST(request: NextRequest) {
  // This is a public, unauthenticated write path for child-safety / PDPL-sensitive
  // personal data (student_name, student_phone, parent_phone, incl. minors). Cap
  // anonymous writes per IP, sharing the `join:` budget with the sibling join route.
  const joinWindowSec = 3600;
  const ip = getClientIp(request);
  const { success } = await rateLimit(`join:${ip}`, 10, joinWindowSec);
  if (!success) {
    return rateLimitExceededResponse(joinWindowSec);
  }

  let body: {
    center_id?: string;
    group_id?: string;
    student_name?: string;
    student_phone?: string;
    parent_phone?: string | null;
    notes?: string | null;
    parent_consent?: boolean;
  };
  try {
    body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const centerId = typeof body.center_id === 'string' ? body.center_id.trim() : '';
  const groupId = typeof body.group_id === 'string' ? body.group_id.trim() : '';
  const studentName = typeof body.student_name === 'string' ? body.student_name.trim() : '';
  const studentPhone = typeof body.student_phone === 'string' ? body.student_phone.trim() : '';

  if (!centerId || !groupId || !studentName || !studentPhone) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  // Server is the gate, not just the checkbox: the self-enrolling parent must
  // attest they are the parent/legal guardian and consent to processing the
  // student's data. Recorded on the student row as parent_self_enroll_consent_at.
  if (body.parent_consent !== true) {
    return NextResponse.json({ error: 'PARENT_CONSENT_REQUIRED' }, { status: 403 });
  }

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const { data: groupRow, error: groupErr } = await admin
    .from('student_groups')
    .select('id, subject')
    .eq('id', groupId)
    .eq('center_id', centerId)
    .maybeSingle();

  if (groupErr || !groupRow) {
    return NextResponse.json({ error: 'Invalid group' }, { status: 400 });
  }

  const subjectValue = (groupRow as { subject?: string | null }).subject ?? null;
  const parentPhone =
    typeof body.parent_phone === 'string' && body.parent_phone.trim().length > 0
      ? body.parent_phone.trim()
      : null;
  const notes =
    typeof body.notes === 'string' && body.notes.trim().length > 0 ? body.notes.trim() : null;

  const { data: insertedStudent, error: studentErr } = await admin
    .from('students')
    .insert({
      center_id: centerId,
      name: studentName,
      phone: studentPhone,
      parent_phone: parentPhone,
      subject: subjectValue,
      payment_status: 'unpaid',
      is_active: false,
      inactive_reason: 'pending_signup',
      parent_pack_opted_in: false,
      parent_consent_given: false,
      parent_self_enroll_consent_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (studentErr || !insertedStudent) {
    return NextResponse.json(
      { error: studentErr?.message ?? 'Failed to create student' },
      { status: 500 },
    );
  }

  const studentId = (insertedStudent as { id: string }).id;

  const { error: pendingErr } = await admin.from('pending_enrollments').insert({
    center_id: centerId,
    group_id: groupId,
    student_id: studentId,
    student_name: studentName,
    student_phone: studentPhone,
    parent_phone: parentPhone,
    notes,
    status: 'pending',
  });

  if (pendingErr) {
    return NextResponse.json({ error: pendingErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
