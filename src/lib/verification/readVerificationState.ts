/**
 * Server-side reader: fetch a subject's verification row and hand it to the
 * state machine. Server-only — imports the service-role client indirectly via
 * the caller's `supabaseAdmin` and must never be pulled into a client bundle.
 *
 * MULTI-TENANCY: this function takes an ALREADY-RESOLVED subject. The caller
 * derives `subjectId` from the authenticated session (`requireCenterAuth` →
 * `centerId`, `requireTeacherAuth` → `userId`) and NEVER from request input.
 * There is no `centerId` parameter on any verification route for that reason.
 *
 * LIVE SCHEMA FACT, re-verified 4 Aug 2026 (project lczmjpnbuhnsislcvzar):
 * neither `public.centers` (128 columns) nor `public.teacher_profiles`
 * (24 columns) carries `verification_status`, `verified_at` or
 * `valify_transaction_id`. The select below therefore fails today with
 * PostgREST 42703 (undefined column), and that failure is EXPECTED and mapped
 * to `stateSourceAvailable: false`. It is not swallowed: any other error is
 * reported to Sentry and still fails closed.
 */

import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/nextjs';
import { readVerificationConfig } from './config';
import {
  resolveVerificationState,
  VERIFICATION_STATE_COLUMNS,
  type VerificationRow,
  type VerificationState,
  type VerificationSubjectKind,
} from './state';

/**
 * Where each subject kind's verification row lives once the migration lands.
 * Centres key on `centers.id`; solo teachers key on `teacher_profiles.user_id`,
 * because teachers are centre-less by design (`users.center_id` is NULL and the
 * link is `teacher_center`). That is not a bug to fix.
 */
const SUBJECT_TABLES: Record<VerificationSubjectKind, { table: string; idColumn: string }> = {
  center: { table: 'centers', idColumn: 'id' },
  teacher: { table: 'teacher_profiles', idColumn: 'user_id' },
};

/** PostgREST / Postgres codes that mean "this column is not in the schema". */
const UNDEFINED_COLUMN_CODES = new Set(['42703', 'PGRST204', 'PGRST202']);

function isUndefinedColumnError(err: { code?: string | null; message?: string | null }): boolean {
  if (err.code && UNDEFINED_COLUMN_CODES.has(err.code)) return true;
  const msg = (err.message ?? '').toLowerCase();
  return msg.includes('does not exist') || msg.includes('could not find');
}

export async function readVerificationState(
  supabaseAdmin: SupabaseClient,
  subject: { kind: VerificationSubjectKind; id: string },
): Promise<VerificationState> {
  const config = readVerificationConfig();

  // Short-circuit: with no credentials there is no outcome we could trust even
  // if a row existed, so we do not spend a query proving it. The state machine
  // applies the same precedence; this only avoids the round trip.
  if (!config.configured) {
    return resolveVerificationState({ config, stateSourceAvailable: false, row: null });
  }

  const { table, idColumn } = SUBJECT_TABLES[subject.kind];

  const { data, error } = await supabaseAdmin
    .from(table)
    .select(VERIFICATION_STATE_COLUMNS.join(', '))
    .eq(idColumn, subject.id)
    .maybeSingle();

  if (error) {
    if (isUndefinedColumnError(error)) {
      // Expected until the migration is applied by hand. Not an incident.
      return resolveVerificationState({ config, stateSourceAvailable: false, row: null });
    }
    // A real infrastructure failure. Report it, then still fail closed — an
    // unreadable state is never a verified state.
    Sentry.withScope((scope) => {
      scope.setTag('module', 'verification');
      scope.setTag('step', 'read_state');
      scope.setTag('subject_kind', subject.kind);
      Sentry.captureException(error);
    });
    return resolveVerificationState({ config, stateSourceAvailable: false, row: null });
  }

  return resolveVerificationState({
    config,
    stateSourceAvailable: true,
    row: (data as unknown as VerificationRow | null) ?? null,
  });
}
