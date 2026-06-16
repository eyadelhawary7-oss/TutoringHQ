import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherAuth } from '@/lib/centerAuth';
import { validateCSRFRequest } from '@/lib/csrf';
import {
  isValidDayOfWeek,
  isValidTimeRange,
  mapSlotRpcError,
  normalizeTime,
  type BookedSlotOut,
  type SlotProposalOut,
} from '@/lib/groupSlots';

const ROUTE_TAG = 'api/teacher/group-slots';

function fail(step: string, err: unknown) {
  Sentry.withScope((scope) => {
    scope.setTag('route', ROUTE_TAG);
    scope.setTag('step', step);
    Sentry.captureException(err);
  });
  return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
}

interface TeacherGroupSlotsRow {
  group_id: string;
  name: string | null;
  subject: string | null;
  center_id: string | null;
  center_name: string | null;
  center_cut_egp: number;
  booked_slots: BookedSlotOut[];
  pending: SlotProposalOut | null;
  last_response: { status: string; responded_at: string | null } | null;
}

/**
 * GET /api/teacher/group-slots
 * The teacher's center-attached groups, each with its booked slots and the
 * current slot-proposal status. Read-only; the slot step sits AFTER cut-agreed.
 */
export async function GET(request: NextRequest) {
  const auth = await requireTeacherAuth(request);
  if (!auth.ok) return auth.response;

  const admin = auth.supabaseAdmin;

  const { data: groupsData, error: groupsErr } = await admin
    .from('student_groups')
    .select('id, name, subject, center_id, center_cut_egp')
    .eq('teacher_id', auth.userId)
    .eq('kind', 'center');
  if (groupsErr) return fail('groups_lookup', groupsErr);

  const groups = (groupsData ?? []) as Array<{
    id: string;
    name: string | null;
    subject: string | null;
    center_id: string | null;
    center_cut_egp: number | null;
  }>;
  const groupIds = groups.map((g) => g.id);
  const centerIds = Array.from(
    new Set(groups.map((g) => g.center_id).filter((c): c is string => !!c)),
  );

  const [centersRes, slotsRes, propsRes] = await Promise.all([
    admin.from('centers').select('id, name').in('id', centerIds.length ? centerIds : ['']),
    admin
      .from('schedule_slots')
      .select('id, group_id, day_of_week, start_time, end_time, room_id')
      .in('group_id', groupIds.length ? groupIds : ['']),
    admin
      .from('group_slot_proposals')
      .select('id, group_id, day_of_week, start_time, end_time, room_id, note, status, created_at, responded_at')
      .in('group_id', groupIds.length ? groupIds : [''])
      .order('created_at', { ascending: false }),
  ]);
  if (centersRes.error) return fail('centers_lookup', centersRes.error);
  if (slotsRes.error) return fail('slots_lookup', slotsRes.error);
  if (propsRes.error) return fail('proposals_lookup', propsRes.error);

  const centerName = new Map(
    ((centersRes.data ?? []) as Array<{ id: string; name: string | null }>).map((c) => [c.id, c.name]),
  );

  const slotsByGroup = new Map<string, BookedSlotOut[]>();
  for (const s of (slotsRes.data ?? []) as Array<BookedSlotOut & { group_id: string }>) {
    const list = slotsByGroup.get(s.group_id) ?? [];
    list.push({
      id: s.id,
      day_of_week: Number(s.day_of_week),
      start_time: s.start_time,
      end_time: s.end_time,
      room_id: s.room_id,
    });
    slotsByGroup.set(s.group_id, list);
  }

  const props = (propsRes.data ?? []) as SlotProposalOut[];
  const pendingByGroup = new Map<string, SlotProposalOut>();
  const lastByGroup = new Map<string, { status: string; responded_at: string | null }>();
  for (const p of props) {
    if (p.status === 'pending' && !pendingByGroup.has(p.group_id)) {
      pendingByGroup.set(p.group_id, p);
    }
    if (p.status !== 'pending' && !lastByGroup.has(p.group_id)) {
      lastByGroup.set(p.group_id, { status: p.status, responded_at: p.responded_at });
    }
  }

  const out: TeacherGroupSlotsRow[] = groups.map((g) => ({
    group_id: g.id,
    name: g.name,
    subject: g.subject,
    center_id: g.center_id,
    center_name: g.center_id ? (centerName.get(g.center_id) ?? null) : null,
    center_cut_egp: Number(g.center_cut_egp ?? 0),
    booked_slots: slotsByGroup.get(g.id) ?? [],
    pending: pendingByGroup.get(g.id) ?? null,
    last_response: lastByGroup.get(g.id) ?? null,
  }));

  return NextResponse.json({ groups: out });
}

/**
 * POST /api/teacher/group-slots
 * Body: { group_id, day_of_week (0-6), start_time "HH:MM", end_time "HH:MM", room_id?, note? }.
 * The teacher proposes a weekly slot for their own center-attached group. Ownership,
 * center-attachment, room scoping and the one-pending rule are enforced in
 * propose_group_slot (SECURITY DEFINER); this route does authn, CSRF, validation.
 */
export async function POST(request: NextRequest) {
  const auth = await requireTeacherAuth(request);
  if (!auth.ok) return auth.response;

  if (!validateCSRFRequest(request, auth.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token', code: 'CSRF' }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    group_id?: unknown;
    day_of_week?: unknown;
    start_time?: unknown;
    end_time?: unknown;
    room_id?: unknown;
    note?: unknown;
  };

  const groupId = typeof body.group_id === 'string' ? body.group_id : null;
  const day = typeof body.day_of_week === 'number' ? body.day_of_week : Number(body.day_of_week);
  const start = normalizeTime(body.start_time);
  const end = normalizeTime(body.end_time);
  const roomId = typeof body.room_id === 'string' && body.room_id ? body.room_id : null;
  const note =
    typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null;

  if (!groupId) {
    return NextResponse.json({ error: 'Missing group', code: 'INVALID_INPUT' }, { status: 400 });
  }
  if (!isValidDayOfWeek(day)) {
    return NextResponse.json({ error: 'Invalid day', code: 'INVALID_INPUT' }, { status: 400 });
  }
  if (!isValidTimeRange(start, end)) {
    return NextResponse.json({ error: 'Invalid time range', code: 'INVALID_INPUT' }, { status: 400 });
  }

  const { data: rpcData, error: rpcErr } = await auth.supabaseAdmin.rpc('propose_group_slot', {
    p_group_id: groupId,
    p_actor_user_id: auth.userId,
    p_day_of_week: day,
    p_start_time: start,
    p_end_time: end,
    p_room_id: roomId,
    p_note: note,
  });
  if (rpcErr) {
    const mapped = mapSlotRpcError(rpcErr as { code?: string; message?: string });
    if (mapped) return mapped;
    return fail('propose_rpc', rpcErr);
  }

  const row = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as SlotProposalOut | undefined;
  return NextResponse.json({ status: 'pending', proposal: row ?? null });
}
