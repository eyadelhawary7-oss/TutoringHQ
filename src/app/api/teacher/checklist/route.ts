import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherAuth } from '@/lib/centerAuth';

const ROUTE_TAG = 'api/teacher/checklist';

function warn(step: string, message: string) {
  Sentry.withScope((scope) => {
    scope.setTag('route', ROUTE_TAG);
    scope.setTag('step', step);
    Sentry.captureMessage(`teacher checklist ${step} failed: ${message}`, 'warning');
  });
}

/**
 * GET /api/teacher/checklist
 * Onboarding checklist state for the free-zone home card. Every check is
 * BEST-EFFORT: this is non-critical guidance UI, so a failed sub-query degrades
 * to "step not done" (or dismissed=false) with a Sentry warning rather than
 * failing the whole card. All queries are scoped to the authenticated teacher.
 */
export async function GET(request: NextRequest) {
  const auth = await requireTeacherAuth(request);
  if (!auth.ok) return auth.response;

  const { supabaseAdmin, userId } = auth;

  // Profile: subject (step 2) + checklist_dismissed. The dismissed column
  // arrives with migration 20260612000000; tolerate its absence (older DB ->
  // dismissed defaults to false) by retrying without it.
  let subjectDone = false;
  let dismissed = false;
  {
    const { data, error } = await supabaseAdmin
      .from('teacher_profiles')
      .select('subject, checklist_dismissed')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      const { data: fallback, error: fbErr } = await supabaseAdmin
        .from('teacher_profiles')
        .select('subject')
        .eq('user_id', userId)
        .maybeSingle();
      if (fbErr) {
        warn('profile', fbErr.message);
      } else {
        subjectDone = Boolean((fallback as { subject?: string | null } | null)?.subject);
      }
    } else {
      const row = data as { subject?: string | null; checklist_dismissed?: boolean | null } | null;
      subjectDone = Boolean(row?.subject);
      dismissed = row?.checklist_dismissed === true;
    }
  }

  // Step 3: a center membership OR a private group.
  let centerOrGroupDone = false;
  {
    const { count: centerCount, error: cErr } = await supabaseAdmin
      .from('teacher_center')
      .select('*', { count: 'exact', head: true })
      .eq('teacher_id', userId)
      .eq('status', 'active');
    if (cErr) warn('center_count', cErr.message);
    if ((centerCount ?? 0) > 0) {
      centerOrGroupDone = true;
    } else {
      const { count: groupCount, error: gErr } = await supabaseAdmin
        .from('student_groups')
        .select('*', { count: 'exact', head: true })
        .eq('teacher_id', userId)
        .eq('kind', 'private');
      if (gErr) warn('group_count', gErr.message);
      centerOrGroupDone = (groupCount ?? 0) > 0;
    }
  }

  // Step 4: the teacher has set a weekly schedule slot on a private group.
  // (No payment-collection setup step: the funnel is account -> students/groups
  // -> schedule -> done.)
  let scheduleDone = false;
  {
    const { data: groupRows, error: gErr } = await supabaseAdmin
      .from('student_groups')
      .select('id')
      .eq('teacher_id', userId)
      .eq('kind', 'private');
    if (gErr) warn('schedule_groups', gErr.message);
    const groupIds = ((groupRows ?? []) as { id: string }[]).map((g) => g.id);
    if (groupIds.length > 0) {
      const { count, error } = await supabaseAdmin
        .from('group_schedule')
        .select('*', { count: 'exact', head: true })
        .in('group_id', groupIds);
      if (error) warn('schedule_count', error.message);
      scheduleDone = (count ?? 0) > 0;
    }
  }

  // Step 5: this teacher referred at least one other teacher.
  let referralDone = false;
  {
    const { count, error } = await supabaseAdmin
      .from('teacher_profiles')
      .select('*', { count: 'exact', head: true })
      .eq('referred_by_teacher_id', userId);
    if (error) warn('referral_count', error.message);
    referralDone = (count ?? 0) > 0;
  }

  return NextResponse.json({
    subjectDone,
    centerOrGroupDone,
    scheduleDone,
    referralDone,
    dismissed,
  });
}
