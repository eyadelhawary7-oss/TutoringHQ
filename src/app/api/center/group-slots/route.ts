import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireCenterAuth } from '@/lib/centerAuth';
import { ensureCanManageProposals } from '@/lib/groupProposals';

const ROUTE_TAG = 'api/center/group-slots';

function fail(step: string, err: unknown) {
  Sentry.withScope((scope) => {
    scope.setTag('route', ROUTE_TAG);
    scope.setTag('step', step);
    Sentry.captureException(err);
  });
  return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
}

/**
 * GET /api/center/group-slots
 * Pending slot proposals awaiting this center's confirmation, plus the center's
 * rooms (so the confirmer can assign one). Read-only; gated to staff who can
 * manage proposals (fails closed).
 */
export async function GET(request: NextRequest) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;

  const denied = await ensureCanManageProposals(auth, ROUTE_TAG);
  if (denied) return denied;

  const admin = auth.supabaseAdmin;

  const { data: groupsData, error: groupsErr } = await admin
    .from('student_groups')
    .select('id, name, subject, teacher_id')
    .eq('center_id', auth.centerId)
    .eq('kind', 'center');
  if (groupsErr) return fail('groups_lookup', groupsErr);

  const groups = (groupsData ?? []) as Array<{
    id: string;
    name: string | null;
    subject: string | null;
    teacher_id: string | null;
  }>;
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const groupIds = groups.map((g) => g.id);

  const [propsRes, roomsRes] = await Promise.all([
    admin
      .from('group_slot_proposals')
      .select('id, group_id, day_of_week, start_time, end_time, room_id, note, created_at')
      .in('group_id', groupIds.length ? groupIds : [''])
      .eq('status', 'pending')
      .order('created_at', { ascending: true }),
    admin.from('rooms').select('id, name').eq('center_id', auth.centerId),
  ]);
  if (propsRes.error) return fail('proposals_lookup', propsRes.error);
  if (roomsRes.error) return fail('rooms_lookup', roomsRes.error);

  const pending = (propsRes.data ?? []) as Array<{
    id: string;
    group_id: string;
    day_of_week: number;
    start_time: string;
    end_time: string;
    room_id: string | null;
    note: string | null;
    created_at: string;
  }>;

  const teacherIds = Array.from(
    new Set(
      pending
        .map((p) => groupById.get(p.group_id)?.teacher_id)
        .filter((id): id is string => !!id),
    ),
  );

  const [profilesRes, usersRes] = await Promise.all([
    admin.from('teacher_profiles').select('user_id, display_name').in('user_id', teacherIds.length ? teacherIds : ['']),
    admin.from('users').select('id, name').in('id', teacherIds.length ? teacherIds : ['']),
  ]);

  const displayName = new Map(
    ((profilesRes.data ?? []) as Array<{ user_id: string; display_name: string | null }>).map((p) => [
      p.user_id,
      p.display_name,
    ]),
  );
  const userName = new Map(
    ((usersRes.data ?? []) as Array<{ id: string; name: string | null }>).map((u) => [u.id, u.name]),
  );

  const proposals = pending.map((p) => {
    const g = groupById.get(p.group_id);
    const teacherId = g?.teacher_id ?? null;
    return {
      id: p.id,
      group_id: p.group_id,
      group_name: g?.name ?? null,
      subject: g?.subject ?? null,
      teacher_id: teacherId,
      teacher_name: teacherId ? (displayName.get(teacherId) ?? userName.get(teacherId) ?? null) : null,
      day_of_week: Number(p.day_of_week),
      start_time: p.start_time,
      end_time: p.end_time,
      room_id: p.room_id,
      note: p.note,
      created_at: p.created_at,
    };
  });

  const rooms = (roomsRes.data ?? []) as Array<{ id: string; name: string | null }>;

  return NextResponse.json({ proposals, rooms });
}
