import { NextResponse } from 'next/server';
import { getClientIp, rateLimit, rateLimitExceededResponse } from '@/lib/ratelimit';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { parseBodyWithLimit, validatePhone, validateString, ValidationError } from '@/lib/validate';
import { orClauseCenterByCodeOrId } from '@/lib/postgrestSafe';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  context: { params: Promise<{ center_code: string; group_id: string }> },
) {
  const joinWindowSec = 3600;
  const ip = getClientIp(request);
  const { success } = await rateLimit(`join:${ip}`, 10, joinWindowSec);
  if (!success) {
    return rateLimitExceededResponse(joinWindowSec);
  }

  const { center_code, group_id } = await context.params;

  if (!center_code || !group_id) {
    return NextResponse.json({ error: 'Invalid link' }, { status: 404 });
  }
  if (!UUID_RE.test(group_id)) {
    return NextResponse.json({ error: 'Invalid link' }, { status: 404 });
  }

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const orFilter = orClauseCenterByCodeOrId(center_code);
  if (!orFilter) {
    return NextResponse.json({ error: 'Invalid link' }, { status: 404 });
  }

  const { data: center, error: centerError } = await supabase
    .from('centers')
    .select('id, name')
    .or(orFilter)
    .limit(1)
    .maybeSingle();

  if (centerError || !center) {
    return NextResponse.json({ error: 'Center not found' }, { status: 404 });
  }

  const centerRow = center as { id: string; name: string | null };

  const { data: group, error: groupError } = await supabase
    .from('student_groups')
    .select('id, name, subject')
    .eq('id', group_id)
    .eq('center_id', centerRow.id)
    .maybeSingle();

  if (groupError || !group) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 });
  }

  const groupRow = group as { id: string; name: string | null; subject: string | null };

  return NextResponse.json({
    center_id: centerRow.id,
    center_name: centerRow.name ?? '',
    group_id: groupRow.id,
    group_name: groupRow.name ?? '',
    group_subject: groupRow.subject ?? null,
  });
}

/** Public join: create inactive student + pending_enrollment (same data model as /api/join/pending-enrollment). */
export async function POST(
  request: Request,
  context: { params: Promise<{ center_code: string; group_id: string }> },
) {
  try {
    const joinWindowSec = 3600;
    const ip = getClientIp(request);
    const { success } = await rateLimit(`join:${ip}`, 10, joinWindowSec);
    if (!success) {
      return rateLimitExceededResponse(joinWindowSec);
    }

    const { center_code, group_id } = await context.params;
    if (!center_code || !group_id) {
      return NextResponse.json({ error: 'Invalid link' }, { status: 404 });
    }
    if (!UUID_RE.test(group_id)) {
      return NextResponse.json({ error: 'Invalid link' }, { status: 404 });
    }

    const body = (await parseBodyWithLimit(request, 10240)) as Record<string, unknown>;
    const name = validateString(body.name, 'name', { required: true, maxLength: 100 });
    const studentPhone = validatePhone(body.phone, 'phone');
    if (!studentPhone) {
      throw new ValidationError('phone is required', 'phone');
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

    const orFilter = orClauseCenterByCodeOrId(center_code);
    if (!orFilter) {
      return NextResponse.json({ error: 'Invalid link' }, { status: 404 });
    }

    const { data: center, error: centerError } = await admin
      .from('centers')
      .select('id')
      .or(orFilter)
      .limit(1)
      .maybeSingle();

    if (centerError || !center) {
      return NextResponse.json({ error: 'Center not found' }, { status: 404 });
    }

    const centerId = (center as { id: string }).id;

    const { data: groupRow, error: groupErr } = await admin
      .from('student_groups')
      .select('id, subject')
      .eq('id', group_id)
      .eq('center_id', centerId)
      .maybeSingle();

    if (groupErr || !groupRow) {
      return NextResponse.json({ error: 'Invalid group' }, { status: 400 });
    }

    const subjectValue = (groupRow as { subject?: string | null }).subject ?? null;
    let parentPhone: string | null = null;
    if (body.parent_phone !== undefined && body.parent_phone !== null && body.parent_phone !== '') {
      parentPhone = validatePhone(body.parent_phone, 'parent_phone');
    }
    const notes =
      typeof body.notes === 'string' && body.notes.trim().length > 0
        ? validateString(body.notes, 'notes', { maxLength: 500 })
        : null;

    const { data: insertedStudent, error: studentErr } = await admin
      .from('students')
      .insert({
        center_id: centerId,
        name,
        phone: studentPhone,
        parent_phone: parentPhone,
        subject: subjectValue,
        payment_status: 'unpaid',
        is_active: false,
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
      group_id: group_id,
      student_id: studentId,
      student_name: name,
      student_phone: studentPhone,
      parent_phone: parentPhone,
      notes,
      status: 'pending',
    });

    if (pendingErr) {
      return NextResponse.json({ error: pendingErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message, field: err.field }, { status: 400 });
    }
    throw err;
  }
}
