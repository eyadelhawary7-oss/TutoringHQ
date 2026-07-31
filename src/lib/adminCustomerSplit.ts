import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * `Merged-Admin-Platform` §01 CUSTOMERS and §02's All / Centers / Teachers
 * segment.
 *
 * TutoringHQ serves two customer types and the overview API only ever knew
 * about one. Everything here is the teacher half plus the totals that need both
 * halves; the centre figures already exist in `/api/admin/overview` and are
 * passed in rather than recomputed, so the two screens cannot disagree.
 *
 * TABLES, confirmed against `information_schema` AND `pg_constraint` on 29 July:
 *  - `teacher_profiles` (user_id, display_name, is_test, created_at)
 *  - `teacher_subscriptions` (teacher_id, plan_key, status, price_gross)
 *      status ∈ trialing | active | past_due | suspended | cancelled
 *      plan_key ∈ teacher_standard | teacher_pro | teacher_scale
 *  - `student_groups` (id, teacher_id, center_id, kind, status)
 *  - `enrollments` (group_id → student_groups.id, student_id, status)
 *
 * ⚠ `student_groups`, NOT `groups`. `public.groups` exists with a plausible
 * shape and holds zero rows; every group FK in the product points at
 * `student_groups`. That decoy already cost one shipped bug (#223) — the column
 * names all matched and the query silently returned nothing.
 */

/** Which teacher subscription statuses count as a paying customer. Mirrors `isBillableTeacherStatus`. */
export function isBillableTeacherStatus(status: string | null | undefined): boolean {
  return status === 'active' || status === 'past_due';
}

export interface CustomerSegment {
  accounts: number;
  students: number;
  /** Monthly recurring revenue, EGP. */
  mrr: number;
}

export interface CustomerSplit {
  centers: CustomerSegment;
  teachers: CustomerSegment;
  totalStudents: number;
  totalMrr: number;
  totalAccounts: number;
  /** Accounts of either kind created since the start of the current Cairo month. */
  newAccountsThisMonth: number;
  /** Centres on a trial plus teachers with status `trialing`. */
  onTrial: number;
}

type TeacherProfile = { user_id: string; is_test: boolean | null; created_at: string | null };
type TeacherSub = { teacher_id: string; status: string | null; price_gross: number | string | null };

/**
 * A teacher's students are those enrolled in groups they run. `kind='private'`
 * is the solo-teacher shape; a teacher also teaching at a centre has
 * `kind='center'` groups whose students belong to that CENTRE, not to them —
 * counting those here would double-count them against the centre segment.
 */
export function teacherStudentCount(
  groups: { id: string; teacher_id: string | null; kind: string | null }[],
  enrollments: { group_id: string; student_id: string }[],
): number {
  const privateGroupIds = new Set(
    groups.filter((g) => g.teacher_id && g.kind === 'private').map((g) => g.id),
  );
  if (privateGroupIds.size === 0) return 0;
  // Distinct students: one student in two of a teacher's groups is one student.
  const seen = new Set<string>();
  for (const e of enrollments) {
    if (privateGroupIds.has(e.group_id)) seen.add(e.student_id);
  }
  return seen.size;
}

export function teacherMrr(subs: TeacherSub[]): number {
  return subs
    .filter((s) => isBillableTeacherStatus(s.status))
    .reduce((sum, s) => sum + Number(s.price_gross || 0), 0);
}

export async function fetchCustomerSplit(
  supabaseAdmin: SupabaseClient,
  centerSegment: CustomerSegment & { newThisMonth: number; onTrial: number },
  monthStart: Date,
): Promise<CustomerSplit> {
  const [profilesRes, subsRes, groupsRes] = await Promise.all([
    supabaseAdmin.from('teacher_profiles').select('user_id, is_test, created_at').eq('is_test', false),
    supabaseAdmin.from('teacher_subscriptions').select('teacher_id, status, price_gross'),
    supabaseAdmin
      .from('student_groups')
      .select('id, teacher_id, kind')
      .not('teacher_id', 'is', null)
      .eq('status', 'active'),
  ]);

  const profiles = (profilesRes.data ?? []) as TeacherProfile[];
  const liveTeacherIds = new Set(profiles.map((p) => p.user_id));

  // A subscription whose teacher_profile is a test row is a test subscription.
  const subs = ((subsRes.data ?? []) as TeacherSub[]).filter((s) => liveTeacherIds.has(s.teacher_id));
  const groups = ((groupsRes.data ?? []) as { id: string; teacher_id: string | null; kind: string | null }[])
    .filter((g) => g.teacher_id && liveTeacherIds.has(g.teacher_id));

  const groupIds = groups.map((g) => g.id);
  const { data: enrollmentRows } = groupIds.length
    ? await supabaseAdmin
        .from('enrollments')
        .select('group_id, student_id')
        .in('group_id', groupIds)
        .eq('status', 'active')
    : { data: [] };

  const teacherStudents = teacherStudentCount(
    groups,
    (enrollmentRows ?? []) as { group_id: string; student_id: string }[],
  );

  const billableTeachers = subs.filter((s) => isBillableTeacherStatus(s.status)).length;
  const trialingTeachers = subs.filter((s) => s.status === 'trialing').length;
  const newTeachersThisMonth = profiles.filter(
    (p) => p.created_at && new Date(p.created_at) >= monthStart,
  ).length;

  const teachers: CustomerSegment = {
    accounts: billableTeachers,
    students: teacherStudents,
    mrr: teacherMrr(subs),
  };

  return {
    centers: {
      accounts: centerSegment.accounts,
      students: centerSegment.students,
      mrr: centerSegment.mrr,
    },
    teachers,
    totalStudents: centerSegment.students + teachers.students,
    totalMrr: centerSegment.mrr + teachers.mrr,
    totalAccounts: centerSegment.accounts + teachers.accounts,
    newAccountsThisMonth: centerSegment.newThisMonth + newTeachersThisMonth,
    onTrial: centerSegment.onTrial + trialingTeachers,
  };
}

/**
 * §01 REVENUE MIX — where the money came from, not just how much.
 *
 * Built from `invoices` actually PAID inside the current Cairo month, grouped
 * by `invoice_type`. The design draws the three sources under an MRR hero as if
 * they decompose it; they do not. Subscriptions and the parent pack recur,
 * WhatsApp packs are a one-time top-up, so summing all three into "monthly
 * recurring revenue" would be wrong. Paid-this-month by source is the honest
 * figure with a real column behind it, and it is what this returns.
 *
 * `invoice_type` values are the live `VALID_INVOICE_TYPES` set from
 * `/api/admin/centers/[id]`, not invented labels.
 */
export type RevenueMixKey = 'subscriptions' | 'addons' | 'whatsapp_packs' | 'other';

const INVOICE_TYPE_TO_MIX: Record<string, RevenueMixKey> = {
  base_subscription: 'subscriptions',
  subscription: 'subscriptions',
  plan_upgrade_difference: 'subscriptions',
  pack_billing: 'addons',
  whatsapp_addon: 'whatsapp_packs',
  announcement_settlement: 'whatsapp_packs',
  announcement_cap: 'whatsapp_packs',
};

export interface RevenueMixRow {
  key: RevenueMixKey;
  amount: number;
}

/**
 * A source with no paid invoice this month is OMITTED, not sent as zero — a
 * zero row reads as "we earned nothing there", which is a claim, where absence
 * is just absence. `other` collects setup fees, late fees and reactivations so
 * the rows always reconcile to the month's paid total.
 */
export function buildRevenueMix(
  paidInvoices: { invoice_type: string | null; total_amount: number | string | null }[],
): RevenueMixRow[] {
  const totals = new Map<RevenueMixKey, number>();
  for (const inv of paidInvoices) {
    const key = INVOICE_TYPE_TO_MIX[inv.invoice_type ?? ''] ?? 'other';
    totals.set(key, (totals.get(key) ?? 0) + Number(inv.total_amount || 0));
  }
  const order: RevenueMixKey[] = ['subscriptions', 'addons', 'whatsapp_packs', 'other'];
  return order
    .filter((k) => totals.has(k))
    .map((k) => ({ key: k, amount: totals.get(k) as number }));
}

/** Paid invoices inside [monthStart, nextMonthStart) — the window the mix covers. */
export async function fetchPaidInvoicesForMonth(
  supabaseAdmin: SupabaseClient,
  monthStart: Date,
  nextMonthStart: Date,
): Promise<{ invoice_type: string | null; total_amount: number | string | null }[]> {
  const { data, error } = await supabaseAdmin
    .from('invoices')
    .select('invoice_type, total_amount')
    .eq('status', 'paid')
    .gte('paid_at', monthStart.toISOString())
    .lt('paid_at', nextMonthStart.toISOString());
  if (error) return [];
  return (data ?? []) as { invoice_type: string | null; total_amount: number | string | null }[];
}

/**
 * §02 TOP BY REVENUE — active student count per centre, for a specific set of
 * IDs. Same filter as the §01 CUSTOMERS split's centre row
 * (`center_id IS NOT NULL AND is_active = true`), kept as its own query rather
 * than reused from there because only the ranked top-N rows are ever
 * rendered, not every centre.
 */
export async function fetchCenterStudentCounts(
  supabaseAdmin: SupabaseClient,
  centerIds: string[],
): Promise<Record<string, number>> {
  if (centerIds.length === 0) return {};
  const { data } = await supabaseAdmin
    .from('students')
    .select('center_id')
    .in('center_id', centerIds)
    .eq('is_active', true);
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as { center_id: string | null }[]) {
    if (!row.center_id) continue;
    counts[row.center_id] = (counts[row.center_id] ?? 0) + 1;
  }
  return counts;
}

/**
 * §02 TOP BY REVENUE and BY PLAN — both customer types in one ranking.
 *
 * The design's list mixes centres and solo teachers, so the rows carry a `kind`
 * and the caller labels them. Amounts are MRR, which is what the design's
 * column shows.
 */
export interface TopAccount {
  id: string;
  name: string | null;
  kind: 'center' | 'teacher';
  plan: string | null;
  students: number | null;
  mrr: number;
}

export interface PlanCount {
  plan: string;
  accounts: number;
}

export function rankTopAccounts(accounts: TopAccount[], limit = 5): TopAccount[] {
  return [...accounts].sort((a, b) => b.mrr - a.mrr).slice(0, limit);
}

/**
 * Plan mix across both types. Centre plans and teacher plans are different
 * ladders (solo/nano/starter/… vs teacher_standard/teacher_pro/teacher_scale)
 * and are NOT merged into one bucket — a "Pro" that means two different prices
 * on two different ladders is a number nobody can act on.
 */
export function buildPlanMix(
  centerPlans: Record<string, number>,
  teacherSubs: { plan_key: string | null; status: string | null }[],
): PlanCount[] {
  const rows: PlanCount[] = Object.entries(centerPlans)
    .filter(([, n]) => n > 0)
    .map(([plan, accounts]) => ({ plan, accounts }));

  const byTeacherPlan = new Map<string, number>();
  for (const s of teacherSubs) {
    if (!isBillableTeacherStatus(s.status) || !s.plan_key) continue;
    byTeacherPlan.set(s.plan_key, (byTeacherPlan.get(s.plan_key) ?? 0) + 1);
  }
  for (const [plan, accounts] of byTeacherPlan) rows.push({ plan, accounts });

  return rows.sort((a, b) => b.accounts - a.accounts);
}
