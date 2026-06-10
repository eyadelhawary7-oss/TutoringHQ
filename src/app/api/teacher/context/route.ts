import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherAuth } from '@/lib/centerAuth';

type TeacherPortalState = 'center_only' | 'unified' | 'lapsed';

type CenterDisplay = {
  id: string;
  name: string | null;
  center_code: string | null;
};

/**
 * Teacher portal bootstrap context. Entry auth is requireTeacherAuth, NOT the
 * private gate: lapsed and never-subscribed teachers must still load their
 * shell (center zone + CTA / resume card). The private gate decides the state
 * word only.
 *
 * State mapping (single source of truth = teacher_private_access + presence
 * of a teacher_subscriptions row):
 *   gate true                  -> 'unified'
 *   gate false + sub row       -> 'lapsed'
 *   gate false + no row        -> 'center_only'
 *
 * The response carries NOTHING about the subscription beyond the state word:
 * no status detail, no dates, no counts. Lapsed private data stays invisible.
 *
 * Rule 151: a gate RPC error is infrastructure failure, not a state -> 500 +
 * Sentry. A subscription-select error means presence is UNKNOWN -> render
 * State A semantics ('center_only'); an error must never invent a lapse.
 */
export async function GET(request: NextRequest) {
  const auth = await requireTeacherAuth(request);
  if (!auth.ok) {
    return auth.response;
  }

  const { data: gateData, error: gateErr } = await auth.supabaseAdmin.rpc(
    'teacher_private_access',
    { p_user_id: auth.userId },
  );
  if (gateErr) {
    Sentry.withScope((scope) => {
      scope.setTag('route', 'api/teacher/context');
      scope.setTag('step', 'gate_rpc');
      Sentry.captureException(gateErr);
    });
    return NextResponse.json(
      { error: 'Server error', code: 'server_error' },
      { status: 500 },
    );
  }
  const hasPrivateAccess: boolean = gateData === true;

  let state: TeacherPortalState = 'unified';
  if (!hasPrivateAccess) {
    const { data: subRow, error: subErr } = await auth.supabaseAdmin
      .from('teacher_subscriptions')
      .select('status')
      .eq('teacher_id', auth.userId)
      .limit(1)
      .maybeSingle();
    if (subErr) {
      Sentry.withScope((scope) => {
        scope.setTag('route', 'api/teacher/context');
        scope.setTag('step', 'subscription_status');
        Sentry.captureMessage(
          `teacher context subscription-presence lookup failed: ${subErr.message}`,
          'warning',
        );
      });
      state = 'center_only';
    } else {
      state = subRow ? 'lapsed' : 'center_only';
    }
  }

  // Center display info is best-effort: memberships themselves are
  // authoritative from auth.centerIds; a failed display lookup degrades to an
  // empty list, it never fails the request.
  let centers: CenterDisplay[] = [];
  if (auth.centerIds.length > 0) {
    const { data: centerRows, error: centersErr } = await auth.supabaseAdmin
      .from('centers')
      .select('id, name, center_code')
      .in('id', auth.centerIds);
    if (centersErr) {
      Sentry.withScope((scope) => {
        scope.setTag('route', 'api/teacher/context');
        scope.setTag('step', 'center_display');
        Sentry.captureMessage(
          `teacher context center-display lookup failed: ${centersErr.message}`,
          'warning',
        );
      });
    } else {
      centers = ((centerRows ?? []) as CenterDisplay[]).map((c) => ({
        id: c.id,
        name: c.name,
        center_code: c.center_code,
      }));
    }
  }

  return NextResponse.json({ state, centers, hasPrivateAccess });
}
