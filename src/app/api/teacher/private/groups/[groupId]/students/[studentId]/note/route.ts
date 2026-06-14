import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireTeacherPrivateAccess } from '@/lib/centerAuth';
import { isUuid } from '@/lib/teacherPrivate';

const ROUTE_TAG = 'api/teacher/private/note';
const MAX_NOTE_LEN = 2000;

function serverError(step: string, err: { message: string }): NextResponse {
  Sentry.withScope((scope) => {
    scope.setTag('route', ROUTE_TAG);
    scope.setTag('step', step);
    Sentry.captureException(err);
  });
  return NextResponse.json(
    { error: 'Server error', code: 'server_error' },
    { status: 500 },
  );
}

type GuardOk = {
  ok: true;
  userId: string;
  admin: SupabaseClient;
  groupId: string;
  studentId: string;
};
type GuardFail = { ok: false; response: NextResponse };

/**
 * Shared gate for both GET and PUT: auth -> group ownership (403, not 404, when
 * the group belongs to another teacher, per the note-feature spec) -> Pro plan
 * gate -> guest rejection -> enrollment guard.
 *
 * Ordered so the cheapest/most-specific failures surface first:
 *   - bad uuid / unknown group        -> 404 group_not_found
 *   - foreign group                   -> 403 NOT_GROUP_OWNER
 *   - non-Pro teacher                 -> 403 NOTES_PRO_ONLY (mirrors GUESTS_PRO_ONLY)
 *   - guest student                   -> 400 GUEST_NO_NOTES
 *   - student not live-enrolled here  -> 404 not_enrolled
 */
async function guard(request: NextRequest, groupId: string, studentId: string): Promise<GuardOk | GuardFail> {
  const auth = await requireTeacherPrivateAccess(request);
  if (!auth.ok) {
    return { ok: false, response: auth.response };
  }
  const admin = auth.supabaseAdmin;

  if (!isUuid(groupId) || !isUuid(studentId)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Not found', code: 'group_not_found' }, { status: 404 }),
    };
  }

  // Ownership: the spec is explicit -- 403 (not the roster routes' 404) when
  // the group exists but belongs to another teacher.
  const { data: groupRow, error: groupErr } = await admin
    .from('student_groups')
    .select('id, teacher_id, kind')
    .eq('id', groupId)
    .maybeSingle();
  if (groupErr) {
    return { ok: false, response: serverError('group_lookup', groupErr) };
  }
  if (!groupRow) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Not found', code: 'group_not_found' }, { status: 404 }),
    };
  }
  const group = groupRow as { id: string; teacher_id: string | null; kind: string | null };
  if (group.teacher_id !== auth.userId) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden', code: 'NOT_GROUP_OWNER' }, { status: 403 }),
    };
  }

  // Pro gate -- mirrors the GUESTS_PRO_ONLY gate exactly (plan_key read from
  // teacher_subscriptions, default teacher_299, Pro is teacher_699).
  const { data: planRow, error: planErr } = await admin
    .from('teacher_subscriptions')
    .select('plan_key')
    .eq('teacher_id', auth.userId)
    .maybeSingle();
  if (planErr) {
    return { ok: false, response: serverError('plan_lookup', planErr) };
  }
  const planKey = (planRow as { plan_key?: string } | null)?.plan_key ?? 'teacher_299';
  if (planKey !== 'teacher_699') {
    return {
      ok: false,
      response: NextResponse.json({ error: 'NOTES_PRO_ONLY', upgrade_required: true }, { status: 403 }),
    };
  }

  // Guest students never get notes. Checked before the enrollment guard so a
  // guest is a clean 400 regardless of whether a stray enrollment row exists.
  const { data: studentRow, error: studentErr } = await admin
    .from('students')
    .select('id, is_guest')
    .eq('id', studentId)
    .maybeSingle();
  if (studentErr) {
    return { ok: false, response: serverError('student_lookup', studentErr) };
  }
  if (!studentRow) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Not found', code: 'student_not_found' }, { status: 404 }),
    };
  }
  if ((studentRow as { is_guest?: boolean }).is_guest === true) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'GUEST_NO_NOTES' }, { status: 400 }),
    };
  }

  // Enrollment guard: the student must be live-enrolled (pending or active) in
  // this group. A foreign/unenrolled student is 404 not_enrolled.
  const { data: enrollRow, error: enrollErr } = await admin
    .from('enrollments')
    .select('id')
    .eq('group_id', groupId)
    .eq('student_id', studentId)
    .in('status', ['pending', 'active'])
    .limit(1)
    .maybeSingle();
  if (enrollErr) {
    return { ok: false, response: serverError('enrollment_guard', enrollErr) };
  }
  if (!enrollRow) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Not found', code: 'not_enrolled' }, { status: 404 }),
    };
  }

  return { ok: true, userId: auth.userId, admin, groupId, studentId };
}

/**
 * GET: the teacher's private note for (student, group). Returns the empty
 * string when no note row exists yet -- a missing note is a valid empty state,
 * never an error.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string; studentId: string }> },
) {
  const { groupId, studentId } = await params;
  const g = await guard(request, groupId, studentId);
  if (!g.ok) {
    return g.response;
  }

  const { data, error } = await g.admin
    .from('student_group_notes')
    .select('note, updated_at')
    .eq('group_id', groupId)
    .eq('student_id', studentId)
    .maybeSingle();
  if (error) {
    return serverError('note_read', error);
  }
  const row = data as { note?: string; updated_at?: string } | null;
  return NextResponse.json({
    note: row?.note ?? '',
    updated_at: row?.updated_at ?? null,
  });
}

/**
 * PUT: upsert the note for (student, group). Trims, caps at 2000 chars, and
 * stamps teacher_id from the verified group owner. The (student_id, group_id)
 * unique constraint makes this a true upsert -- one note per pair.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string; studentId: string }> },
) {
  const { groupId, studentId } = await params;
  const g = await guard(request, groupId, studentId);
  if (!g.ok) {
    return g.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request', code: 'invalid_body' }, { status: 400 });
  }
  const rawNote = (body ?? {}) as { note?: unknown };
  if (typeof rawNote.note !== 'string') {
    return NextResponse.json({ error: 'Invalid request', code: 'invalid_note' }, { status: 400 });
  }
  const note = rawNote.note.trim();
  if (note.length > MAX_NOTE_LEN) {
    return NextResponse.json(
      { error: 'NOTE_TOO_LONG', max: MAX_NOTE_LEN },
      { status: 400 },
    );
  }

  const { data, error } = await g.admin
    .from('student_group_notes')
    .upsert(
      { student_id: studentId, group_id: groupId, teacher_id: g.userId, note },
      { onConflict: 'student_id,group_id' },
    )
    .select('note, updated_at')
    .single();
  if (error) {
    return serverError('note_upsert', error);
  }
  const row = data as { note: string; updated_at: string };
  return NextResponse.json({ note: row.note, updated_at: row.updated_at });
}
