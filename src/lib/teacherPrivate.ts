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
