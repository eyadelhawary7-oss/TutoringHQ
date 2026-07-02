import { NextResponse } from 'next/server';
import { getAdminContext, requireAdminRole } from '@/lib/admin-auth';
import { validateCSRFRequest } from '@/lib/csrf';
import { parseBodyWithLimit } from '@/lib/validate';
import { normalizePhone } from '@/lib/utils/phone';
import { logAdminAction } from '@/lib/audit';

// H8/M5 (minimum erasure). super_admin only.
//
// GET  ?phone=…   → candidate students whose phone or parent_phone matches the
//                   data subject, so the admin can pick the row to erase.
// POST { requestId, studentId } → anonymize that student: strip every personal
//   or identifying field, keep the row + its financial links with the identity
//   removed, set inactive, write the action to audit_log, mark the request done.
//
// FLAG (Adsero-pending): we strip generously (over-stripping is the safe
// direction). The exact field boundary is a small edit to the field list below,
// not a rebuild.

export async function GET(request: Request) {
  const ctx = await getAdminContext(request);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const denied = requireAdminRole(ctx, ['super_admin']);
  if (denied) return denied;

  const url = new URL(request.url);
  const phoneRaw = url.searchParams.get('phone')?.trim() ?? '';
  if (!phoneRaw) return NextResponse.json({ students: [] });

  const variants = [...new Set([phoneRaw, normalizePhone(phoneRaw) || phoneRaw])];
  const orFilter = variants
    .flatMap((p) => [`phone.eq.${p}`, `parent_phone.eq.${p}`])
    .join(',');

  const { data, error } = await ctx.supabaseAdmin
    .from('students')
    .select('id, name, student_number, center_id, phone, parent_phone, is_active')
    .or(orFilter)
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ students: data ?? [] });
}

export async function POST(request: Request) {
  const ctx = await getAdminContext(request);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const denied = requireAdminRole(ctx, ['super_admin']);
  if (denied) return denied;
  if (!validateCSRFRequest(request, ctx.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
  }

  const body = (await parseBodyWithLimit(request, 16384)) as Record<string, unknown>;
  const requestId = typeof body.requestId === 'string' ? body.requestId : '';
  const studentId = typeof body.studentId === 'string' ? body.studentId : '';
  if (!requestId || !studentId) {
    return NextResponse.json({ error: 'requestId and studentId required' }, { status: 400 });
  }

  const admin = ctx.supabaseAdmin;

  const { data: reqRow, error: reqErr } = await admin
    .from('privacy_requests')
    .select('id, request_types, status')
    .eq('id', requestId)
    .maybeSingle();
  if (reqErr || !reqRow) {
    return NextResponse.json({ error: 'Privacy request not found' }, { status: 404 });
  }
  const types = ((reqRow as { request_types?: string[] }).request_types ?? []);
  if (!types.includes('deletion')) {
    return NextResponse.json({ error: 'Not a deletion request' }, { status: 400 });
  }

  const { data: student, error: stuErr } = await admin
    .from('students')
    .select('id, center_id, is_active')
    .eq('id', studentId)
    .maybeSingle();
  if (stuErr || !student) {
    return NextResponse.json({ error: 'Student not found' }, { status: 404 });
  }
  const centerId = (student as { center_id: string }).center_id;

  // Strip every personal/identifying field; keep the row + financial links.
  const { error: anonErr } = await admin
    .from('students')
    .update({
      name: '[erased]',
      phone: null,
      parent_phone: null,
      qr_code: null,
      qr_data: null,
      qr_code_data: null,
      grade_level: null,
      parent_phone_verified: false,
      parent_consent_given: false,
      is_active: false,
    })
    .eq('id', studentId);
  if (anonErr) {
    return NextResponse.json({ error: anonErr.message }, { status: 500 });
  }

  // Free-text notes about the student (staff + teacher) are personal data — remove.
  await admin.from('student_notes').delete().eq('student_id', studentId);
  await admin.from('student_group_notes').update({ note: '' }).eq('student_id', studentId);

  // Append-only audit trail of the erasure (de-identified: no PII in details).
  await logAdminAction(
    ctx.userId,
    'anonymize_student',
    {
      privacy_request_id: requestId,
      student_id: studentId,
      fields_stripped: ['name', 'phone', 'parent_phone', 'qr_code', 'qr_data', 'qr_code_data', 'grade_level', 'student_notes', 'student_group_notes'],
    },
    centerId,
  );

  // Close the request against its SLA.
  await admin
    .from('privacy_requests')
    .update({
      status: 'completed',
      handled_by: ctx.userId,
      handled_at: new Date().toISOString(),
      response_notes: `Student ${studentId} anonymized (deletion request).`,
    })
    .eq('id', requestId);

  // Note: admin_alerts rows carry no per-request link, so we don't auto-resolve
  // here (that would clear alerts for other still-pending requests). The admin
  // resolves alerts from the panel; the request status itself is now 'completed'.

  return NextResponse.json({ success: true });
}
