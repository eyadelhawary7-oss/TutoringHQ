import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { teacherStudentCap, teacherHasHardCap } from '@/lib/teacherPlans';
import { phonesMatch } from '@/lib/utils/phone';

/**
 * Per-tier active-student caps (see src/lib/teacherPlans.ts):
 *   Standard -> 20 (hard cap), Pro -> 50 (hard cap), Scale -> 100 (overage above).
 *
 * Two thresholds share ONE count definition for the hard-capped tiers:
 *   - ADD is refused at the boundary: enrolling beyond the cap is blocked
 *     (count >= CAP), so a hard-capped teacher can never cross it.
 *   - The over-cap LOCK fires only when a teacher is genuinely past the line
 *     (count > CAP), locking every billable action until they shed students.
 *
 * Scale is never hard-blocked — extra active students are billed as a month-end
 * overage true-up, so its gate always passes.
 */

/** Cap value a route can surface to the client for the given plan. */
export function studentCapForPlan(planKey: string | null | undefined): number {
  return teacherStudentCap(planKey);
}

/** Service-role plan_key is the source of truth (teacher_profiles.plan_key can drift). */
async function fetchPlanKey(
  admin: SupabaseClient,
  teacherId: string,
): Promise<string | undefined> {
  const { data, error } = await admin
    .from('teacher_subscriptions')
    .select('plan_key')
    .eq('teacher_id', teacherId)
    .maybeSingle();
  if (error) throw error;
  return (data as { plan_key?: string } | null)?.plan_key ?? undefined;
}

/**
 * Canonical Standard-cap count: DISTINCT non-guest students holding an ACTIVE
 * enrollment across the teacher's ACTIVE private groups.
 *
 * This is the single source of truth for both the roster add-student gate and
 * the over-cap lock. Guests (students.is_guest = true) never count; archived
 * groups drop out (status='active' filter); a student in two active groups
 * counts once (DISTINCT).
 */
export async function countActiveNonGuestStudents(
  admin: SupabaseClient,
  teacherId: string,
): Promise<number> {
  const { data: groupRows, error: groupsErr } = await admin
    .from('student_groups')
    .select('id')
    .eq('teacher_id', teacherId)
    .eq('kind', 'private')
    .eq('status', 'active');
  if (groupsErr) throw groupsErr;
  const groupIds = (groupRows ?? []).map((g) => (g as { id: string }).id);
  if (groupIds.length === 0) return 0;

  // !inner join + students.is_guest=false drops any guest that somehow carries
  // an enrollment row, mirroring the roster add-student gate exactly.
  const { data: enrollRows, error: enrollErr } = await admin
    .from('enrollments')
    .select('student_id, students!inner(is_guest)')
    .in('group_id', groupIds)
    .eq('status', 'active')
    .eq('students.is_guest', false);
  if (enrollErr) throw enrollErr;
  return new Set(
    (enrollRows ?? []).map((e) => (e as { student_id: string }).student_id),
  ).size;
}

export type CapGateResult = { ok: true } | { ok: false; response: NextResponse };

/**
 * Over-cap action gate. Call after teacher auth on every billable/teacher
 * action that an over-cap Standard teacher must NOT perform (start/finish
 * sessions, attendance, group create, roster add, billing, schedule changes).
 *
 *   - Pro (teacher_699)          -> always { ok: true } (never capped).
 *   - Standard, count <= 60      -> { ok: true }.
 *   - Standard, count > 60       -> 403 OVER_CAP_LOCKED (the lock).
 *   - DB error                   -> 500 CAP_CHECK_FAILED. Rule 151: an error is
 *     not a state. We must never mint a false OVER_CAP_LOCKED (trapping a
 *     legitimate teacher) nor a false pass (letting an over-cap teacher act) on
 *     a transient blip - so we surface the failure and deny the action.
 *
 * The block lifts automatically: there is no stored flag or timer. The moment
 * the live count is <= 60 the next call passes.
 */
export async function requireTeacherUnderCap(
  admin: SupabaseClient,
  teacherId: string,
  routeTag: string,
): Promise<CapGateResult> {
  try {
    const planKey = await fetchPlanKey(admin, teacherId);
    // Scale never hard-blocks: students above the cap are billed as overage.
    if (!teacherHasHardCap(planKey)) return { ok: true };
    const cap = teacherStudentCap(planKey);

    const count = await countActiveNonGuestStudents(admin, teacherId);
    if (count > cap) {
      return {
        ok: false,
        response: NextResponse.json(
          {
            error: 'Over student cap',
            code: 'OVER_CAP_LOCKED',
            limit: cap,
            current: count,
          },
          { status: 403 },
        ),
      };
    }
    return { ok: true };
  } catch (err) {
    Sentry.withScope((scope) => {
      scope.setTag('route', routeTag);
      scope.setTag('step', 'over_cap_gate');
      Sentry.captureException(err);
    });
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Server error', code: 'CAP_CHECK_FAILED' },
        { status: 500 },
      ),
    };
  }
}

/**
 * Self-enroll cap guard (the loophole fix). A public self-enroll must not push
 * a Standard teacher past 60. Returns true when this enrollment WOULD add a new
 * distinct head beyond the cap.
 *
 * An already-enrolled student re-submitting (idempotent retry) is NOT a new
 * head - if a center-less student with this phone already holds an active
 * enrollment in one of the teacher's active groups, they are already counted,
 * so we never block them.
 */
export async function selfEnrollWouldExceedCap(
  admin: SupabaseClient,
  teacherId: string,
  studentPhone: string,
): Promise<boolean> {
  const planKey = await fetchPlanKey(admin, teacherId);
  // Scale has no hard cap (overage instead), so a self-enroll never exceeds it.
  if (!teacherHasHardCap(planKey)) return false;
  const cap = teacherStudentCap(planKey);

  const { data: groupRows, error: groupsErr } = await admin
    .from('student_groups')
    .select('id')
    .eq('teacher_id', teacherId)
    .eq('kind', 'private')
    .eq('status', 'active');
  if (groupsErr) throw groupsErr;
  const groupIds = (groupRows ?? []).map((g) => (g as { id: string }).id);
  if (groupIds.length === 0) return false;

  const { data: enrollRows, error: enrollErr } = await admin
    .from('enrollments')
    .select('student_id, students!inner(is_guest, phone, center_id)')
    .in('group_id', groupIds)
    .eq('status', 'active')
    .eq('students.is_guest', false);
  if (enrollErr) throw enrollErr;

  type StudentEmbed = { phone: string | null; center_id: string | null };
  const rows = (enrollRows ?? []) as unknown as {
    student_id: string;
    // PostgREST embeds a to-one relation as an object, but the generated types
    // widen it to an array - accept either shape.
    students: StudentEmbed | StudentEmbed[] | null;
  }[];
  const distinct = new Set(rows.map((r) => r.student_id));
  if (distinct.size < cap) return false;

  // At/over the cap: only a brand-new head is refused. An existing center-less
  // student with this phone is already in the count -> idempotent, allow.
  const isMatch = (s: StudentEmbed | null | undefined) =>
    s?.center_id === null && phonesMatch(s?.phone, studentPhone);
  const alreadyCounted = rows.some((r) =>
    Array.isArray(r.students) ? r.students.some(isMatch) : isMatch(r.students),
  );
  return !alreadyCounted;
}
