import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherPrivateAccess } from '@/lib/centerAuth';
import { buildTeacherAnalytics, requireTeacherPro } from '@/lib/teacherAnalytics';

const ROUTE_TAG = 'api/teacher/private/analytics';

/**
 * GET /api/teacher/private/analytics — Pro teacher analytics (Pile A).
 *
 * Two gates, in order:
 *   1. requireTeacherPrivateAccess — same access gate as the income surface
 *      (trialing|active subscription). Free/lapsed → 403 NO_PRIVATE_ACCESS.
 *   2. requireTeacherPro — Standard (teacher_299) → 403 ANALYTICS_PRO_ONLY so
 *      the client can render the brass upgrade row; Pro (teacher_699) passes.
 *
 * Everything is computed LIVE and scoped to the authenticated teacher (no
 * teacher metrics table exists, and one teacher's data is small). A query
 * failure inside buildTeacherAnalytics surfaces as 500 + Sentry — never a
 * partial/misleading payload.
 */
export async function GET(request: NextRequest) {
  const auth = await requireTeacherPrivateAccess(request);
  if (!auth.ok) {
    return auth.response;
  }

  const pro = await requireTeacherPro(auth.supabaseAdmin, auth.userId, ROUTE_TAG);
  if (!pro.ok) {
    return pro.response;
  }

  try {
    const analytics = await buildTeacherAnalytics(auth.supabaseAdmin, auth.userId);
    return NextResponse.json(analytics);
  } catch (err) {
    Sentry.withScope((scope) => {
      scope.setTag('route', ROUTE_TAG);
      scope.setTag('step', 'build_analytics');
      Sentry.captureException(err);
    });
    return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
  }
}
