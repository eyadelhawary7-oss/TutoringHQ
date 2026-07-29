import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { getAdminContext, requireAdminRole } from '@/lib/admin-auth';
import { validateCSRFRequest } from '@/lib/csrf';
import { parseBodyWithLimit } from '@/lib/validate';

const ROUTE_TAG = 'api/admin/teacher-links';

/**
 * R5 · Admin teacher ↔ center linking — `Merged-Admin-Accounts` §03.
 *
 * DELIBERATELY NOT `/api/admin/center-assignments`. That route is the sales
 * commission machinery (staff ↔ center) and shares only a name with this
 * design. Confirmed 26 July; `BUILD-AFTER-REDESIGN.md` R5 marks it do-not-touch.
 *
 * Reads `teacher_center` (the membership) and `teacher_center_requests` (the
 * pending side). Both column sets were checked against `information_schema` on
 * 29 July before a single one was named in a query.
 */

type LinkRow = { teacher_id: string; center_id: string; status: string; accepted_at: string | null };
type RequestRow = { id: string; teacher_id: string; center_id: string; status: string; created_at: string };

function fail(step: string, err: unknown) {
  Sentry.withScope((scope) => {
    scope.setTag('route', ROUTE_TAG);
    scope.setTag('step', step);
    Sentry.captureException(err);
  });
  return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
}

/**
 * GET /api/admin/teacher-links
 *
 * The three groupings the design draws: by center, by teacher, and the
 * teachers with no active membership at all.
 */
export async function GET(request: NextRequest) {
  const ctx = await getAdminContext(request);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Teacher names + which center they work at is staff PII across tenants.
  // internal_admin and above, same bar as the centers list.
  const denied = requireAdminRole(ctx, ['super_admin', 'admin', 'internal_admin']);
  if (denied) return denied;

  const [linksRes, requestsRes, profilesRes] = await Promise.all([
    ctx.supabaseAdmin
      .from('teacher_center')
      .select('teacher_id, center_id, status, accepted_at')
      .eq('status', 'active'),
    ctx.supabaseAdmin
      .from('teacher_center_requests')
      .select('id, teacher_id, center_id, status, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),
    ctx.supabaseAdmin
      .from('teacher_profiles')
      .select('user_id, display_name, subject, plan_key')
      .eq('is_test', false),
  ]);

  if (linksRes.error) return fail('links', linksRes.error);
  if (requestsRes.error) return fail('requests', requestsRes.error);
  if (profilesRes.error) return fail('profiles', profilesRes.error);

  const links = (linksRes.data ?? []) as LinkRow[];
  const requests = (requestsRes.data ?? []) as RequestRow[];
  const profiles = (profilesRes.data ?? []) as {
    user_id: string;
    display_name: string | null;
    subject: string | null;
    plan_key: string | null;
  }[];

  // `teacher_profiles.display_name` is optional, so fall back to `users.name`
  // the same way /api/admin/teacher-assignments does.
  const teacherIds = [...new Set([...profiles.map((p) => p.user_id), ...links.map((l) => l.teacher_id)])];
  const { data: userRows, error: usersErr } = teacherIds.length
    ? await ctx.supabaseAdmin.from('users').select('id, name').in('id', teacherIds)
    : { data: [], error: null };
  if (usersErr) return fail('users', usersErr);
  const nameById = new Map(
    ((userRows ?? []) as { id: string; name: string | null }[]).map((u) => [u.id, u.name]),
  );

  const centerIds = [...new Set([...links.map((l) => l.center_id), ...requests.map((r) => r.center_id)])];
  const { data: centerRows, error: centersErr } = centerIds.length
    ? await ctx.supabaseAdmin
        .from('centers')
        .select('id, name, city, district, plan')
        .in('id', centerIds)
        .eq('is_test', false)
    : { data: [], error: null };
  if (centersErr) return fail('centers', centersErr);
  const centerById = new Map(
    ((centerRows ?? []) as { id: string; name: string; city: string | null; district: string | null; plan: string | null }[]).map(
      (c) => [c.id, c],
    ),
  );

  const teacherById = new Map(
    profiles.map((p) => [
      p.user_id,
      {
        id: p.user_id,
        name: p.display_name || nameById.get(p.user_id) || null,
        subject: p.subject,
        plan: p.plan_key,
      },
    ]),
  );

  const teacherOf = (id: string) =>
    teacherById.get(id) ?? { id, name: nameById.get(id) ?? null, subject: null, plan: null };

  // By center: every center that has at least one active teacher.
  const byCenter = [...centerById.values()]
    .map((c) => ({
      centerId: c.id,
      centerName: c.name,
      location: [c.district, c.city].filter(Boolean).join(', ') || null,
      plan: c.plan,
      teachers: links.filter((l) => l.center_id === c.id).map((l) => teacherOf(l.teacher_id)),
    }))
    .filter((c) => c.teachers.length > 0)
    .sort((a, b) => b.teachers.length - a.teachers.length);

  // By teacher: every teacher with a profile, plus the centers they work at.
  const byTeacher = [...teacherById.values()]
    .map((t) => ({
      ...t,
      centers: links
        .filter((l) => l.teacher_id === t.id)
        .map((l) => {
          const c = centerById.get(l.center_id);
          return { centerId: l.center_id, centerName: c?.name ?? null };
        }),
    }))
    .sort((a, b) => b.centers.length - a.centers.length);

  const unassigned = byTeacher.filter((t) => t.centers.length === 0);

  const pending = requests.map((r) => ({
    requestId: r.id,
    createdAt: r.created_at,
    teacher: teacherOf(r.teacher_id),
    centerId: r.center_id,
    centerName: centerById.get(r.center_id)?.name ?? null,
  }));

  return NextResponse.json({ byCenter, byTeacher, unassigned, pending });
}

/**
 * POST /api/admin/teacher-links — open a link request.
 *
 * ⚠ This does NOT create the membership. Linking a teacher to a center is
 * two-sided by design: `/api/center/teacher-links` opens a pending
 * `teacher_center_requests` row and the teacher's acceptance is what writes
 * `teacher_center`. An admin form that inserted an active membership directly
 * would let an internal operator attach any teacher to any center and hand that
 * center the teacher's roster — the consent step is the control that prevents
 * it. So the admin form opens the same pending request the owner flow opens,
 * with `initiated_by = 'center'`, and the teacher still accepts.
 */
export async function POST(request: NextRequest) {
  const ctx = await getAdminContext(request);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const denied = requireAdminRole(ctx, ['super_admin', 'admin']);
  if (denied) return denied;
  if (!validateCSRFRequest(request, ctx.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token', code: 'CSRF' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await parseBodyWithLimit(request, 8192)) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid request', code: 'INVALID_INPUT' }, { status: 400 });
  }

  const teacherId = typeof body.teacherId === 'string' ? body.teacherId.trim() : '';
  const centerId = typeof body.centerId === 'string' ? body.centerId.trim() : '';
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(teacherId) || !uuid.test(centerId)) {
    return NextResponse.json(
      { error: 'teacherId and centerId are required', code: 'INVALID_INPUT' },
      { status: 400 },
    );
  }

  // Both sides must exist before we open a request against them.
  const [{ data: teacher, error: tErr }, { data: center, error: cErr }] = await Promise.all([
    ctx.supabaseAdmin.from('teacher_profiles').select('user_id').eq('user_id', teacherId).maybeSingle(),
    ctx.supabaseAdmin.from('centers').select('id').eq('id', centerId).maybeSingle(),
  ]);
  if (tErr) return fail('teacher_lookup', tErr);
  if (cErr) return fail('center_lookup', cErr);
  if (!teacher) {
    return NextResponse.json({ error: 'Unknown teacher', code: 'TEACHER_NOT_FOUND' }, { status: 404 });
  }
  if (!center) {
    return NextResponse.json({ error: 'Unknown center', code: 'CENTER_NOT_FOUND' }, { status: 404 });
  }

  const { data: membership, error: memErr } = await ctx.supabaseAdmin
    .from('teacher_center')
    .select('teacher_id')
    .eq('teacher_id', teacherId)
    .eq('center_id', centerId)
    .eq('status', 'active')
    .maybeSingle();
  if (memErr) return fail('membership_check', memErr);
  if (membership) {
    return NextResponse.json({ error: 'Already a member', code: 'ALREADY_A_MEMBER' }, { status: 409 });
  }

  const { data: inserted, error: insErr } = await ctx.supabaseAdmin
    .from('teacher_center_requests')
    .insert({ teacher_id: teacherId, center_id: centerId, status: 'pending', initiated_by: 'center' })
    .select('id')
    .single();
  if (insErr) {
    // The partial unique index on (teacher_id, center_id) WHERE status='pending'
    // surfaces a duplicate as 23505 whichever side opened it.
    if ((insErr as { code?: string }).code === '23505') {
      return NextResponse.json(
        { error: 'Request already pending', code: 'REQUEST_ALREADY_PENDING' },
        { status: 409 },
      );
    }
    return fail('insert_request', insErr);
  }

  return NextResponse.json({ requestId: (inserted as { id: string }).id }, { status: 201 });
}
