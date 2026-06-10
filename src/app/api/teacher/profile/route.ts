import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherAuth } from '@/lib/centerAuth';

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
  const { displayName: rawName, subject: rawSubject } = (body ?? {}) as {
    displayName?: unknown;
    subject?: unknown;
  };

  const hasName = rawName !== undefined;
  const hasSubject = rawSubject !== undefined;
  if (!hasName && !hasSubject) {
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
