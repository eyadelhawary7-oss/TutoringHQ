import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The headline figures `Merged-Admin-Accounts` §01 draws on the account-detail
 * header: the three KPI tiles and the counts the MANAGE list carries.
 *
 * Every column named here was confirmed in `information_schema` on 29 July
 * before it was queried — `students.is_active`, `student_groups.center_id`,
 * `sessions.status`/`scheduled_at`, `attendance_scans.session_id`,
 * `enrollments.status`. CI has no live database, so a name that only *looks*
 * right passes every gate and fails in production.
 *
 * ⚠ Confirming the COLUMNS is not enough — confirm the TABLE the data actually
 * lives in. This function first shipped reading `public.groups`, which has the
 * right columns and zero rows; the real table is `student_groups`. Every column
 * check passed and the metric was dead on arrival.
 *
 * NOT here, and deliberately:
 *  - **Branches.** There is no `branches` table. `branch_user_assignments`
 *    exists but records which staff see which branch, not the branches
 *    themselves, so a count from it would be a different number wearing the
 *    design's label.
 *  - **Verified / National ID.** Still not here, and for two different reasons.
 *    Verification STATE no longer belongs in this module at all: it is decided
 *    by `src/lib/verificationState.ts` (the state machine) over
 *    `src/lib/verificationStore.ts` (the reader), and read by admin screens
 *    through `/api/admin/verification/availability`, so that exactly one place
 *    in the codebase decides it. The National ID NUMBER is not here and never
 *    will be — `design/VERIFICATION-SPEC.md` §9.7 establishes that no verified
 *    screen needs it, and §7.7/§7.8 flag that rendering it to internal staff
 *    has no least-privilege control behind it.
 *
 *    Re-verified live against project lczmjpnbuhnsislcvzar on 4 Aug 2026:
 *    `public.centers` has 128 columns and none of `verification_status`,
 *    `verified_at`, `national_id` or `valify_transaction_id`; and neither
 *    `verification_records` nor `verification_attempts` exists among the 142
 *    base tables in `public`. When they do, the number will live in
 *    `verification_records` behind a column-level REVOKE — not on `centers`,
 *    where four `select('*')` call sites would pick it up and RLS could not
 *    withhold it.
 */

export const ATTENDANCE_WINDOW_DAYS = 30;

export interface CenterAccountMetrics {
  studentCount: number;
  teacherStaffCount: number;
  invoiceCount: number;
  addOnCount: number;
  /** Percent 0–100, or null when the window held nothing to measure. */
  attendanceRatePct: number | null;
  attendanceWindowDays: number;
}

type SessionRow = { id: string; group_id: string | null };
type ScanRow = { session_id: string | null; student_id: string };
type EnrollmentRow = { group_id: string };

/**
 * Σ distinct attendees over finished sessions ÷ (enrolled × finished sessions),
 * capped at 1 — the same definition `attendanceRatePerGroup` uses in
 * `teacherAnalytics.ts`, aggregated to the whole centre instead of per group.
 * Returns null when the denominator is zero: a centre with no finished sessions
 * has no attendance rate, and 0% would be a claim the data does not make.
 */
export function centerAttendanceRate(
  finishedSessions: SessionRow[],
  scans: ScanRow[],
  enrollments: EnrollmentRow[],
): number | null {
  const enrolledByGroup = new Map<string, number>();
  for (const e of enrollments) {
    enrolledByGroup.set(e.group_id, (enrolledByGroup.get(e.group_id) ?? 0) + 1);
  }

  // attendance_scans can hold more than one row per student per session
  // (re-scan, offline replay), so attendees are counted distinctly.
  const attendeesBySession = new Map<string, Set<string>>();
  for (const s of scans) {
    if (!s.session_id) continue;
    let set = attendeesBySession.get(s.session_id);
    if (!set) {
      set = new Set();
      attendeesBySession.set(s.session_id, set);
    }
    set.add(s.student_id);
  }

  let attended = 0;
  let expected = 0;
  for (const sess of finishedSessions) {
    if (!sess.group_id) continue;
    const enrolled = enrolledByGroup.get(sess.group_id) ?? 0;
    if (enrolled === 0) continue;
    expected += enrolled;
    attended += Math.min(enrolled, attendeesBySession.get(sess.id)?.size ?? 0);
  }

  if (expected === 0) return null;
  return Math.round((attended / expected) * 1000) / 10;
}

/** How many paid add-ons the centre is on. Parent Pack is the only one today. */
export function countAddOns(center: { parent_pack_enabled?: boolean | null }): number {
  return center.parent_pack_enabled ? 1 : 0;
}

export async function fetchCenterAccountMetrics(
  supabaseAdmin: SupabaseClient,
  centerId: string,
  center: { parent_pack_enabled?: boolean | null },
  invoiceCount: number,
): Promise<CenterAccountMetrics> {
  const since = new Date(Date.now() - ATTENDANCE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [studentsRes, staffRes, groupsRes] = await Promise.all([
    supabaseAdmin
      .from('students')
      .select('id', { count: 'exact', head: true })
      .eq('center_id', centerId)
      .eq('is_active', true),
    supabaseAdmin.from('users').select('id', { count: 'exact', head: true }).eq('center_id', centerId),
    // `student_groups`, NOT `groups`. `public.groups` exists with a plausible
    // shape (id, center_id, name, is_active) and holds ZERO rows; every FK that
    // matters — sessions.group_id, enrollments.group_id, attendance_scans.group_id
    // — references `student_groups`. Reading `groups` returned an empty id list on
    // every call, so the attendance rate was permanently null and the KPI tile
    // never rendered. Confirmed against pg_constraint on 29 July.
    supabaseAdmin
      .from('student_groups')
      .select('id')
      .eq('center_id', centerId)
      .eq('status', 'active'),
  ]);

  const groupIds = ((groupsRes.data ?? []) as { id: string }[]).map((g) => g.id);

  let attendanceRatePct: number | null = null;
  if (groupIds.length > 0) {
    const { data: sessionRows } = await supabaseAdmin
      .from('sessions')
      .select('id, group_id')
      .in('group_id', groupIds)
      .eq('status', 'finished')
      .gte('scheduled_at', since);
    const finishedSessions = (sessionRows ?? []) as SessionRow[];

    if (finishedSessions.length > 0) {
      const [{ data: scanRows }, { data: enrollmentRows }] = await Promise.all([
        supabaseAdmin
          .from('attendance_scans')
          .select('session_id, student_id')
          .eq('center_id', centerId)
          .in(
            'session_id',
            finishedSessions.map((s) => s.id),
          ),
        supabaseAdmin.from('enrollments').select('group_id').in('group_id', groupIds).eq('status', 'active'),
      ]);
      attendanceRatePct = centerAttendanceRate(
        finishedSessions,
        (scanRows ?? []) as ScanRow[],
        (enrollmentRows ?? []) as EnrollmentRow[],
      );
    }
  }

  return {
    studentCount: studentsRes.count ?? 0,
    teacherStaffCount: staffRes.count ?? 0,
    invoiceCount,
    addOnCount: countAddOns(center),
    attendanceRatePct,
    attendanceWindowDays: ATTENDANCE_WINDOW_DAYS,
  };
}
