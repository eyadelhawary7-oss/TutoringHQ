import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import type { SupabaseClient } from '@supabase/supabase-js';

export type OwnedPrivateGroup = {
  id: string;
  name: string | null;
  fee_per_class: number | string | null;
  approval_mode: string | null;
  status: string | null;
};

export type OwnedGroupResult =
  | { ok: true; group: OwnedPrivateGroup }
  | { ok: false; response: NextResponse };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: string): boolean {
  return UUID_RE.test(v);
}

/**
 * Ownership guard for every teacher-private roster route: the group must
 * exist AND belong to the authenticated teacher AND be a private group. A
 * teacher must never read or mutate another teacher's roster - a foreign or
 * unknown group id is indistinguishable from "not found" (404
 * group_not_found, never 403, to avoid confirming the id exists).
 *
 * Rule 151: this is a CORE read - a query error is 500, never a 404 minted
 * from an error.
 */
export async function requireOwnedPrivateGroup(
  admin: SupabaseClient,
  userId: string,
  groupId: string,
  routeTag: string,
): Promise<OwnedGroupResult> {
  if (!isUuid(groupId)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Not found', code: 'group_not_found' },
        { status: 404 },
      ),
    };
  }

  const { data, error } = await admin
    .from('student_groups')
    .select('id, name, fee_per_class, approval_mode, status')
    .eq('id', groupId)
    .eq('teacher_id', userId)
    .eq('kind', 'private')
    .maybeSingle();
  if (error) {
    Sentry.withScope((scope) => {
      scope.setTag('route', routeTag);
      scope.setTag('step', 'group_ownership');
      Sentry.captureException(error);
    });
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Server error', code: 'server_error' },
        { status: 500 },
      ),
    };
  }
  if (!data) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Not found', code: 'group_not_found' },
        { status: 404 },
      ),
    };
  }
  return { ok: true, group: data as OwnedPrivateGroup };
}

export type OwnedSession = {
  id: string;
  group_id: string;
  kind: string;
  scheduled_at: string;
  status: string;
  billed: boolean;
  billed_at: string | null;
  finished_at: string | null;
};

export type OwnedSessionResult =
  | { ok: true; group: OwnedPrivateGroup; session: OwnedSession }
  | { ok: false; response: NextResponse };

/**
 * Ownership chain for session routes: session -> group -> teacher_id =
 * auth.userId. The group leg reuses requireOwnedPrivateGroup; the session leg
 * pins the session to that verified group. A session id from another
 * teacher's group is 404 session_not_found with no further reads or
 * mutations. CORE reads throughout: errors are 500, never an error-minted 404.
 */
export async function requireOwnedSession(
  admin: SupabaseClient,
  userId: string,
  groupId: string,
  sessionId: string,
  routeTag: string,
): Promise<OwnedSessionResult> {
  const owned = await requireOwnedPrivateGroup(admin, userId, groupId, routeTag);
  if (!owned.ok) {
    return owned;
  }
  if (!isUuid(sessionId)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Not found', code: 'session_not_found' },
        { status: 404 },
      ),
    };
  }
  const { data, error } = await admin
    .from('sessions')
    .select('id, group_id, kind, scheduled_at, status, billed, billed_at, finished_at')
    .eq('id', sessionId)
    .eq('group_id', groupId)
    .maybeSingle();
  if (error) {
    Sentry.withScope((scope) => {
      scope.setTag('route', routeTag);
      scope.setTag('step', 'session_ownership');
      Sentry.captureException(error);
    });
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Server error', code: 'server_error' },
        { status: 500 },
      ),
    };
  }
  if (!data) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Not found', code: 'session_not_found' },
        { status: 404 },
      ),
    };
  }
  return { ok: true, group: owned.group, session: data as OwnedSession };
}
