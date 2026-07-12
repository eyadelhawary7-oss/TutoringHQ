import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdminContext } from '@/lib/admin-auth';

/**
 * Internal access scope for the CEO / Manager / Rep rebuild.
 *
 * - CEO (super_admin) and the existing org-wide internal roles see everything.
 * - A Manager (admin_users.role === 'sales_manager', linked to a staff 'sm' row) sees
 *   their own assigned accounts plus those of the reps who report to them.
 * - A Rep (admin_users.role === 'sales_rep', linked to a staff 'sr' row) sees only
 *   their own assigned accounts.
 *
 * The link between a login identity and its sales-org position is staff.user_id
 * (added in migration 20260710120000). This module resolves that link into the set of
 * center ids a caller may see. It is Phase-1 infrastructure: Phases 4–5 wire it into the
 * Centers / Card-Orders / Commission / Payout routes. It is intentionally read-only and
 * never surfaces salary.
 */

export type ScopeLevel = 'all' | 'team' | 'own';

export interface InternalScope {
  level: ScopeLevel;
  /** The caller's own staff row id, or null when they are not a scoped sales role. */
  staffId: string | null;
  /**
   * Staff ids whose approved center assignments this caller may see. When
   * `level !== 'all'` and this is empty, the caller sees NOTHING (fail closed).
   * Ignored when `level === 'all'`.
   */
  staffIds: string[];
}

export type StaffRow = { id: string; role: string | null } | null;

/**
 * Internal roles that keep whole-org visibility today and are therefore never
 * center-scoped by this module. Only the two sales roles get restricted; every other
 * internal role retains exactly the breadth it has now (still gated per-route by
 * requireAdminRole — 'all' here means "apply no center filter", not "grant access").
 */
const ORG_WIDE_ADMIN_ROLES = new Set([
  'admin',
  'internal_admin',
  'accountant',
  'support_agent',
  'internal_viewer',
  'custom',
]);

/**
 * Pure scope resolver — no I/O, so it is fully unit-testable. Given the caller's role
 * signals, their linked staff row, and (for a manager) the ids of reps reporting to
 * them, returns the resolved scope.
 */
export function resolveInternalScope(
  internalRole: string,
  adminRole: string | null,
  staffRow: StaffRow,
  reportingRepIds: string[],
): InternalScope {
  // CEO — never scoped.
  if (internalRole === 'super_admin') {
    return { level: 'all', staffId: null, staffIds: [] };
  }

  // Manager: own + direct reports. Fail closed (sees nothing) if not linked to a staff row.
  if (adminRole === 'sales_manager') {
    if (!staffRow) return { level: 'team', staffId: null, staffIds: [] };
    const staffIds = [staffRow.id, ...reportingRepIds.filter((id) => id !== staffRow.id)];
    return { level: 'team', staffId: staffRow.id, staffIds };
  }

  // Rep: own only. Fail closed if not linked.
  if (adminRole === 'sales_rep') {
    if (!staffRow) return { level: 'own', staffId: null, staffIds: [] };
    return { level: 'own', staffId: staffRow.id, staffIds: [staffRow.id] };
  }

  // Every other internal role keeps org-wide visibility (unchanged from today).
  if (adminRole && ORG_WIDE_ADMIN_ROLES.has(adminRole)) {
    return { level: 'all', staffId: null, staffIds: [] };
  }

  // Unknown role that still passed getAdminContext (e.g. a phone super-admin with no
  // admin_users row): treat as org-wide — per-route gates remain the real boundary.
  return { level: 'all', staffId: null, staffIds: [] };
}

/**
 * Resolve the caller's scope, reading staff linkage from the DB when the role is a
 * scoped sales role. Uses the service-role client already on the AdminContext.
 */
export async function getInternalScope(ctx: AdminContext): Promise<InternalScope> {
  const { internalRole, adminRole, supabaseAdmin, userId } = ctx;

  // Fast path: roles that are never scoped need no DB read.
  if (internalRole === 'super_admin' || (adminRole !== 'sales_manager' && adminRole !== 'sales_rep')) {
    return resolveInternalScope(internalRole, adminRole, null, []);
  }

  const { data: staffRow } = await supabaseAdmin
    .from('staff')
    .select('id, role')
    .eq('user_id', userId)
    .maybeSingle();

  let reportingRepIds: string[] = [];
  if (adminRole === 'sales_manager' && staffRow) {
    const { data: reps } = await supabaseAdmin
      .from('staff')
      .select('id')
      .eq('reports_to', (staffRow as { id: string }).id);
    reportingRepIds = (reps ?? []).map((r) => (r as { id: string }).id);
  }

  return resolveInternalScope(internalRole, adminRole, (staffRow as StaffRow) ?? null, reportingRepIds);
}

/**
 * Center ids this scope may access, or `null` for unrestricted (level === 'all').
 * A restricted scope with no staff ids returns `[]` (sees nothing) — fail closed.
 * Only 'approved' assignments count; unassigned / eyad-sourced / referral / still-pending
 * centers are therefore never returned to a Manager or Rep.
 *
 * Phase 4b: a Manager (level 'team') owns a center two ways — a row directly assigned to
 * one of their staff ids (self or a reporting rep), OR a row assigned to the manager at
 * the manager level (manager_staff_id set, rep not yet chosen). A Rep (level 'own') only
 * ever matches on staff_id — a rep is never a manager, so manager_staff_id never widens them.
 */
export async function allowedCenterIds(
  supabaseAdmin: SupabaseClient,
  scope: InternalScope,
): Promise<string[] | null> {
  if (scope.level === 'all') return null;
  if (scope.staffIds.length === 0) return [];

  const ids = new Set<string>();

  const { data: byStaff } = await supabaseAdmin
    .from('center_assignments')
    .select('center_id')
    .in('staff_id', scope.staffIds)
    .eq('assignment_status', 'approved');
  for (const row of byStaff ?? []) {
    const centerId = (row as { center_id: string | null }).center_id;
    if (centerId) ids.add(centerId);
  }

  if (scope.level === 'team') {
    const { data: byManager } = await supabaseAdmin
      .from('center_assignments')
      .select('center_id')
      .in('manager_staff_id', scope.staffIds)
      .eq('assignment_status', 'approved');
    for (const row of byManager ?? []) {
      const centerId = (row as { center_id: string | null }).center_id;
      if (centerId) ids.add(centerId);
    }
  }

  return [...ids];
}

/**
 * Teacher ids (teacher_profiles.user_id) this scope may access, or `null` for unrestricted
 * (level === 'all'). Same shape and fail-closed contract as {@link allowedCenterIds}, over
 * the teacher_assignments table: a Manager matches staff_id (self + reps) OR manager_staff_id
 * (self at the manager level); a Rep matches staff_id only. Only 'approved' rows count.
 */
export async function allowedTeacherIds(
  supabaseAdmin: SupabaseClient,
  scope: InternalScope,
): Promise<string[] | null> {
  if (scope.level === 'all') return null;
  if (scope.staffIds.length === 0) return [];

  const ids = new Set<string>();

  const { data: byStaff } = await supabaseAdmin
    .from('teacher_assignments')
    .select('teacher_id')
    .in('staff_id', scope.staffIds)
    .eq('assignment_status', 'approved');
  for (const row of byStaff ?? []) {
    const teacherId = (row as { teacher_id: string | null }).teacher_id;
    if (teacherId) ids.add(teacherId);
  }

  if (scope.level === 'team') {
    const { data: byManager } = await supabaseAdmin
      .from('teacher_assignments')
      .select('teacher_id')
      .in('manager_staff_id', scope.staffIds)
      .eq('assignment_status', 'approved');
    for (const row of byManager ?? []) {
      const teacherId = (row as { teacher_id: string | null }).teacher_id;
      if (teacherId) ids.add(teacherId);
    }
  }

  return [...ids];
}
