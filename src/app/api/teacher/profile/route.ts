import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherAuth } from '@/lib/centerAuth';

/**
 * GET the authenticated teacher's own profile (display_name / subject) so the
 * settings form can prefill. Scoped to user_id = auth.userId via service role;
 * nothing identity-bearing is read from the request body/query. Returns null
 * fields when no row exists yet (the form then starts empty). Rule 151: a read
 * error surfaces as 500 + Sentry.
 */
export async function GET(request: NextRequest) {
  const auth = await requireTeacherAuth(request);
  if (!auth.ok) {
    return auth.response;
  }

  const { data, error: readErr } = await auth.supabaseAdmin
    .from('teacher_profiles')
    .select('display_name, subject, referral_code')
    .eq('user_id', auth.userId)
    .maybeSingle();
  if (readErr) {
    Sentry.withScope((scope) => {
      scope.setTag('route', 'api/teacher/profile');
      scope.setTag('step', 'profile_read');
      Sentry.captureException(readErr);
    });
    return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
  }

  return NextResponse.json({
    displayName: (data?.display_name as string | null) ?? null,
    subject: (data?.subject as string | null) ?? null,
    referralCode: (data?.referral_code as string | null) ?? null,
  });
}

/**
 * PATCH the authenticated teacher's profile (display_name / subject). Scoped
 * to the teacher's own row by user_id = auth.userId - nothing identity-bearing
 * is read from the body. Upserts teacher_profiles on conflict(user_id) so it
 * works whether or not the signup-time row exists. At least one field is
 * required. Rule 151: a write error surfaces as 500 + Sentry.
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireTeacherAuth(request);
  if (!auth.ok) {
    return auth.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request', code: 'invalid_body' }, { status: 400 });
  }
  const {
    displayName: rawName,
    subject: rawSubject,
    checklistDismissed: rawDismissedCamel,
    checklist_dismissed: rawDismissedSnake,
  } = (body ?? {}) as {
    displayName?: unknown;
    subject?: unknown;
    checklistDismissed?: unknown;
    checklist_dismissed?: unknown;
  };

  const hasName = rawName !== undefined;
  const hasSubject = rawSubject !== undefined;
  // Either key spelling is accepted; only `true` latches (no un-dismissing).
  const hasDismiss = rawDismissedCamel === true || rawDismissedSnake === true;
  if (!hasName && !hasSubject && !hasDismiss) {
    return NextResponse.json(
      { error: 'Nothing to update', code: 'no_fields' },
      { status: 400 },
    );
  }

  const updates: Record<string, unknown> = { user_id: auth.userId };
  if (hasName) {
    const displayName = typeof rawName === 'string' ? rawName.trim() : '';
    if (displayName.length < 2 || displayName.length > 120) {
      return NextResponse.json(
        { error: 'Invalid name', code: 'invalid_name' },
        { status: 400 },
      );
    }
    updates.display_name = displayName;
  }
  if (hasSubject) {
    updates.subject =
      typeof rawSubject === 'string' && rawSubject.trim() ? rawSubject.trim() : null;
  }
  // Dismiss is a one-way latch (only ever set to true here); the column lives
  // on teacher_profiles (migration 20260612000000).
  if (hasDismiss) {
    updates.checklist_dismissed = true;
  }

  const { error: upsertErr } = await auth.supabaseAdmin
    .from('teacher_profiles')
    .upsert(updates, { onConflict: 'user_id' });
  if (upsertErr) {
    Sentry.withScope((scope) => {
      scope.setTag('route', 'api/teacher/profile');
      scope.setTag('step', 'profile_upsert');
      Sentry.captureException(upsertErr);
    });
    return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
