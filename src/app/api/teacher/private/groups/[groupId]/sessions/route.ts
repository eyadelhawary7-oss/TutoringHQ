import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherPrivateAccess } from '@/lib/centerAuth';
import { requireOwnedPrivateGroup } from '@/lib/teacherPrivate';
import { requireTeacherUnderCap } from '@/lib/teacherCap';
import {
  cairoDateKey,
  cairoYmdMinusDays,
  startOfUtcInstantForCairoCalendarDay,
} from '@/lib/cairo/day';

const ROUTE_TAG = 'api/teacher/private/sessions';

type SessionRow = {
  id: string;
  scheduled_at: string;
  status: string;
  billed: boolean;
  billed_at: string | null;
};

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

/**
 * GET: recent sessions for the group (date, status, attendee count, billed
 * total). Session list is CORE; the per-session attendee counts and billed
 * totals are display extras (best-effort: zeros + Sentry warning on error).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> },
) {
  const auth = await requireTeacherPrivateAccess(request);
  if (!auth.ok) {
    return auth.response;
  }
  const { groupId } = await params;
  const owned = await requireOwnedPrivateGroup(auth.supabaseAdmin, auth.userId, groupId, ROUTE_TAG);
  if (!owned.ok) {
    return owned.response;
  }

  const { data: sessionRows, error: sessionsErr } = await auth.supabaseAdmin
    .from('sessions')
    .select('id, scheduled_at, status, billed, billed_at')
    .eq('group_id', groupId)
    .order('scheduled_at', { ascending: false })
    .limit(20);
  if (sessionsErr) {
    return serverError('session_list', sessionsErr);
  }
  const sessions = (sessionRows ?? []) as SessionRow[];

  const presentCounts = new Map<string, number>();
  const billedTotals = new Map<string, number>();
  if (sessions.length > 0) {
    const ids = sessions.map((s) => s.id);
    const { data: scanRows, error: scansErr } = await auth.supabaseAdmin
      .from('attendance_scans')
      .select('session_id')
      .in('session_id', ids)
      .eq('billable', true);
    if (scansErr) {
      Sentry.withScope((scope) => {
        scope.setTag('route', ROUTE_TAG);
        scope.setTag('step', 'attendee_counts');
        Sentry.captureMessage(
          `session attendee-count lookup failed: ${scansErr.message}`,
          'warning',
        );
      });
    } else {
      for (const r of (scanRows ?? []) as { session_id: string }[]) {
        presentCounts.set(r.session_id, (presentCounts.get(r.session_id) ?? 0) + 1);
      }
    }

    const { data: txnRows, error: txnErr } = await auth.supabaseAdmin
      .from('transactions')
      .select('session_id, amount_billed')
      .eq('teacher_id', auth.userId)
      .eq('kind', 'lesson')
      .in('session_id', ids);
    if (txnErr) {
      Sentry.withScope((scope) => {
        scope.setTag('route', ROUTE_TAG);
        scope.setTag('step', 'billed_totals');
        Sentry.captureMessage(
          `session billed-total lookup failed: ${txnErr.message}`,
          'warning',
        );
      });
    } else {
      for (const r of (txnRows ?? []) as { session_id: string; amount_billed: number | string | null }[]) {
        billedTotals.set(
          r.session_id,
          (billedTotals.get(r.session_id) ?? 0) + (Number(r.amount_billed) || 0),
        );
      }
    }
  }

  return NextResponse.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      scheduled_at: s.scheduled_at,
      status: s.status,
      billed: s.billed,
      presentCount: presentCounts.get(s.id) ?? 0,
      billedTotal: Math.round((billedTotals.get(s.id) ?? 0) * 100) / 100,
    })),
  });
}

/**
 * POST: record a class - creates a session for the group. Sessions have no
 * insert guard (guard_sessions_lifecycle is UPDATE-only), so this is a plain
 * insert with kind='private' and created_by set server-side. Teachers record
 * after the fact: the optional scheduled_date accepts today or up to 30 days
 * back on the Cairo calendar, never the future. Today's sessions are stamped
 * now(); past dates anchor to the first UTC instant of that Cairo day.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> },
) {
  const auth = await requireTeacherPrivateAccess(request);
  if (!auth.ok) {
    return auth.response;
  }
  const { groupId } = await params;
  const owned = await requireOwnedPrivateGroup(auth.supabaseAdmin, auth.userId, groupId, ROUTE_TAG);
  if (!owned.ok) {
    return owned.response;
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // No body is fine - defaults to today.
  }
  const { scheduled_date: rawDate } = (body ?? {}) as { scheduled_date?: unknown };

  const todayKey = cairoDateKey();
  let dateKey = todayKey;
  if (rawDate !== undefined && rawDate !== null && rawDate !== '') {
    if (typeof rawDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      return NextResponse.json(
        { error: 'Invalid request', code: 'invalid_date' },
        { status: 400 },
      );
    }
    if (rawDate > todayKey || rawDate < cairoYmdMinusDays(todayKey, 30)) {
      return NextResponse.json(
        { error: 'Invalid request', code: 'invalid_date' },
        { status: 400 },
      );
    }
    dateKey = rawDate;
  }
  // Over-cap lock: a Standard teacher past 60 students cannot record a class.
  // Pro is never capped. After ownership + date validation, before the insert.
  const cap = await requireTeacherUnderCap(auth.supabaseAdmin, auth.userId, ROUTE_TAG);
  if (!cap.ok) {
    return cap.response;
  }

  const scheduledAt =
    dateKey === todayKey
      ? new Date().toISOString()
      : startOfUtcInstantForCairoCalendarDay(dateKey).toISOString();

  const { data: inserted, error: insertErr } = await auth.supabaseAdmin
    .from('sessions')
    .insert({
      group_id: groupId,
      kind: 'private',
      scheduled_at: scheduledAt,
      created_by: auth.userId,
    })
    .select('id, scheduled_at, status, billed')
    .single();
  if (insertErr) {
    return serverError('session_insert', insertErr);
  }

  const s = inserted as SessionRow;
  return NextResponse.json(
    {
      session: {
        id: s.id,
        scheduled_at: s.scheduled_at,
        status: s.status,
        billed: s.billed,
        presentCount: 0,
        billedTotal: 0,
      },
    },
    { status: 201 },
  );
}
