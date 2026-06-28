// src/lib/teacherFreeBaseline.ts
//
// Reliable "drop a non-paying teacher to the FREE BASELINE" — replaces the
// best-effort inline transition. A teacher on the free baseline keeps the center
// monitoring system + center cut, and loses the private-groups engine until they
// return to a paid plan. Data is never deleted (RLS hides it; the chokepoint
// is_teacher_private_locked()). The free-baseline state is `past_due`:
// teacher_private_access() is false, but the teacher is NOT suspended, so center
// monitoring is untouched.
//
// Idempotent: if the teacher is already off paid access (past_due / suspended /
// expired-cancelled) this is a no-op success. Only trialing/active transition.

import type { SupabaseClient } from '@supabase/supabase-js';

export type TeacherStatus = 'trialing' | 'active' | 'past_due' | 'suspended' | 'cancelled';

/**
 * Pure decision: the status to transition to in order to land on the free
 * baseline, or null when the teacher is already there (no transition needed).
 * Only trialing/active drop to past_due. past_due/suspended/cancelled already
 * deny private access, so no change is required.
 */
export function nextFreeBaselineTransition(current: TeacherStatus | string | null | undefined): 'past_due' | null {
  if (current === 'trialing' || current === 'active') return 'past_due';
  return null;
}

/**
 * Pure mirror of the SQL `teacher_private_access(uid)` predicate — TRUE for
 * trialing/active, or cancelled still within the paid period. Kept in lockstep
 * with the DB function (supabase/migrations baseline) and used by tests to
 * document the access-by-status truth table.
 */
export function teacherPrivateAccessByStatus(
  status: TeacherStatus | string | null | undefined,
  currentPeriodEndIso?: string | null,
  nowIso?: string,
): boolean {
  if (status === 'trialing' || status === 'active') return true;
  if (status === 'cancelled' && currentPeriodEndIso) {
    const now = nowIso ? Date.parse(nowIso) : Date.now();
    return Date.parse(currentPeriodEndIso) > now;
  }
  return false;
}

/**
 * Pure mirror of `is_teacher_private_locked()` — a subscription row exists AND
 * the teacher currently lacks private access (i.e. on the free baseline).
 */
export function isTeacherPrivateLocked(
  hasSubscriptionRow: boolean,
  status: TeacherStatus | string | null | undefined,
  currentPeriodEndIso?: string | null,
  nowIso?: string,
): boolean {
  return hasSubscriptionRow && !teacherPrivateAccessByStatus(status, currentPeriodEndIso, nowIso);
}

export interface DropToFreeBaselineResult {
  ok: boolean;
  /** 'transitioned' | 'already_free_baseline' | 'not_found' | 'error' */
  outcome: 'transitioned' | 'already_free_baseline' | 'not_found' | 'error';
  status?: string;
}

/**
 * Move a teacher subscription to the free baseline (past_due), reliably and
 * idempotently. Uses the guarded apply_teacher_subscription_transition RPC so the
 * lifecycle trigger and audit log are honoured.
 */
export async function dropTeacherToFreeBaseline(
  supabase: SupabaseClient,
  subscriptionId: string,
  actorId: string | null = null,
): Promise<DropToFreeBaselineResult> {
  const { data: row, error: readErr } = await supabase
    .from('teacher_subscriptions')
    .select('status')
    .eq('id', subscriptionId)
    .maybeSingle();
  if (readErr) {
    console.error('[dropTeacherToFreeBaseline] read', subscriptionId, readErr);
    return { ok: false, outcome: 'error' };
  }
  if (!row) return { ok: false, outcome: 'not_found' };

  const current = (row as { status?: string }).status ?? null;
  const target = nextFreeBaselineTransition(current);
  if (!target) {
    // Already past_due / suspended / cancelled → already on (or beyond) the free baseline.
    return { ok: true, outcome: 'already_free_baseline', status: current ?? undefined };
  }

  const { error: trErr } = await supabase.rpc('apply_teacher_subscription_transition', {
    p_subscription_id: subscriptionId,
    p_new_status: target,
    p_actor_id: actorId,
  });
  if (trErr) {
    console.error('[dropTeacherToFreeBaseline] transition', subscriptionId, trErr);
    return { ok: false, outcome: 'error', status: current ?? undefined };
  }
  return { ok: true, outcome: 'transitioned', status: target };
}
