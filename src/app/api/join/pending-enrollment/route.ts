import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

/**
 * Public: create inactive student + pending_enrollment (v3 join flow).
 */
export async function POST(request: NextRequest) {
  let body: {
    center_id?: string;
    group_id?: string;
    student_name?: string;
    student_phone?: string;
    parent_phone?: string | null;
    notes?: string | null;
  };
  try {
    body = await request.json();
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
      parent_pack_opted_in: false,
      parent_consent_given: false,
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
