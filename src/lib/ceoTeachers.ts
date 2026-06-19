// src/lib/ceoTeachers.ts
//
// Read-only data layer for the super-admin teacher-side visibility section and
// the combined owner dashboard top-line. Owner-scoped (sees ALL teachers across
// every center) — callers MUST gate with requireSuperAdminApi before invoking,
// because the service-role client bypasses RLS.
//
// No writes here. The two owner actions (comp a subscription, fix a referral)
// are deferred to a follow-up; both reduce to a future-only free_months_credit
// increment + audit_log row.

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CeoTeacherAttachmentRow,
  CeoTeacherCreditRow,
  CeoTeacherData,
  CeoTeacherReferralRow,
  CeoTeacherRow,
  CeoTeacherSubsSummary,
  CeoTeacherSubscriptionRow,
} from '@/types/ceoTeachers';
import type { CeoTeacherCombined } from '@/types/ceo';

/** Monthly gross price per teacher tier (matches platform_config; price_gross is preferred when present). */
const TIER_MONTHLY_GROSS: Record<string, number> = {
  teacher_standard: 499,
  teacher_pro: 999,
  teacher_scale: 2499,
};

/** A teacher subscription contributes to MRR while it is being billed. Mirrors the center rule (['active','overdue']). */
export function isBillableTeacherStatus(status: string | null | undefined): boolean {
  return status === 'active' || status === 'past_due';
}

/** Resolve a subscription's monthly gross: the snapshotted price_gross, else the tier default. */
export function teacherMonthlyGross(
  planKey: string | null | undefined,
  priceGross: number | null | undefined,
): number {
  const snap = Number(priceGross ?? 0);
  if (Number.isFinite(snap) && snap > 0) return snap;
  return TIER_MONTHLY_GROSS[String(planKey ?? '')] ?? 0;
}

type MrrSubInput = {
  plan_key: string | null;
  status: string | null;
  price_gross: number | null;
};

/**
 * Pure MRR sum over already-filtered subscriptions (caller excludes test teachers).
 * Only billable statuses count.
 */
export function computeTeacherMrr(subs: ReadonlyArray<MrrSubInput>): number {
  let total = 0;
  for (const s of subs) {
    if (isBillableTeacherStatus(s.status)) {
      total += teacherMonthlyGross(s.plan_key, s.price_gross);
    }
  }
  return Math.round(total);
}

/** Pure status breakdown for the subscriptions tab summary. */
export function summarizeTeacherSubs(
  subs: ReadonlyArray<{ status: string | null }>,
): CeoTeacherSubsSummary {
  const summary: CeoTeacherSubsSummary = {
    total: subs.length,
    trialing: 0,
    active: 0,
    past_due: 0,
    suspended: 0,
    cancelled: 0,
  };
  for (const s of subs) {
    switch (s.status) {
      case 'trialing':
        summary.trialing += 1;
        break;
      case 'active':
        summary.active += 1;
        break;
      case 'past_due':
        summary.past_due += 1;
        break;
      case 'suspended':
        summary.suspended += 1;
        break;
      case 'cancelled':
        summary.cancelled += 1;
        break;
      default:
        break;
    }
  }
  return summary;
}

// ── Raw row shapes (live schema) ─────────────────────────────────────────────

interface ProfileRow {
  user_id: string;
  display_name: string | null;
  referral_code: string | null;
  is_test: boolean | null;
  subject: string | null;
  plan_key: string | null;
  created_at: string | null;
  blast_credits_subscription: number | null;
  blast_credits_purchased: number | null;
  referred_by_teacher_id: string | null;
}

interface SubRow {
  teacher_id: string;
  plan_key: string | null;
  status: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  next_billing_at: string | null;
  free_months_credit: number | null;
  price_gross: number | null;
  referral_rewarded_at: string | null;
}

interface GroupRow {
  id: string;
  name: string | null;
  teacher_id: string | null;
  center_id: string | null;
  kind: string | null;
  center_cut_egp: number | null;
  fee_per_class: number | null;
  subject: string | null;
  status: string | null;
}

interface UserRow {
  id: string;
  phone: string | null;
  name: string | null;
}

interface CenterRow {
  id: string;
  name: string | null;
}

const PROFILE_COLS =
  'user_id, display_name, referral_code, is_test, subject, plan_key, created_at, blast_credits_subscription, blast_credits_purchased, referred_by_teacher_id';
const SUB_COLS =
  'teacher_id, plan_key, status, trial_ends_at, current_period_end, next_billing_at, free_months_credit, price_gross, referral_rewarded_at';
const GROUP_COLS =
  'id, name, teacher_id, center_id, kind, center_cut_egp, fee_per_class, subject, status';

/**
 * Full read for the five teacher-side tabs. Includes test teachers (flagged via
 * is_test) so the owner can see everything; only the MRR figure excludes them
 * (finance correctness — admin aggregates default is_test = false).
 */
export async function getCeoTeacherData(
  supabase: SupabaseClient,
): Promise<CeoTeacherData> {
  const [profilesRes, subsRes, groupsRes] = await Promise.all([
    supabase.from('teacher_profiles').select(PROFILE_COLS),
    supabase.from('teacher_subscriptions').select(SUB_COLS),
    supabase.from('student_groups').select(GROUP_COLS).not('teacher_id', 'is', null),
  ]);

  const profiles = (profilesRes.data ?? []) as ProfileRow[];
  const subs = (subsRes.data ?? []) as SubRow[];
  const groups = (groupsRes.data ?? []) as GroupRow[];

  const teacherIds = profiles.map((p) => p.user_id);
  const centerIds = Array.from(
    new Set(groups.map((g) => g.center_id).filter((id): id is string => !!id)),
  );

  const [usersRes, centersRes] = await Promise.all([
    supabase.from('users').select('id, phone, name').in('id', teacherIds.length ? teacherIds : ['']),
    supabase.from('centers').select('id, name').in('id', centerIds.length ? centerIds : ['']),
  ]);

  const users = (usersRes.data ?? []) as UserRow[];
  const centers = (centersRes.data ?? []) as CenterRow[];

  const profileById = new Map(profiles.map((p) => [p.user_id, p]));
  const userById = new Map(users.map((u) => [u.id, u]));
  const centerById = new Map(centers.map((c) => [c.id, c]));
  const subByTeacher = new Map(subs.map((s) => [s.teacher_id, s]));
  const testTeacherIds = new Set(
    profiles.filter((p) => p.is_test).map((p) => p.user_id),
  );

  const nameOf = (teacherId: string): string | null =>
    profileById.get(teacherId)?.display_name ?? userById.get(teacherId)?.name ?? null;

  // ── Subscriptions ──────────────────────────────────────────────────────────
  const subscriptions: CeoTeacherSubscriptionRow[] = subs
    .map((s) => {
      const p = profileById.get(s.teacher_id);
      const u = userById.get(s.teacher_id);
      return {
        teacher_id: s.teacher_id,
        display_name: p?.display_name ?? u?.name ?? null,
        referral_code: p?.referral_code ?? null,
        is_test: !!p?.is_test,
        phone: u?.phone ?? null,
        plan_key: s.plan_key,
        status: s.status,
        trial_ends_at: s.trial_ends_at,
        current_period_end: s.current_period_end,
        next_billing_at: s.next_billing_at,
        free_months_credit: Number(s.free_months_credit ?? 0),
        price_gross: s.price_gross != null ? Number(s.price_gross) : null,
        referral_rewarded_at: s.referral_rewarded_at,
      };
    })
    .sort((a, b) => Number(a.is_test) - Number(b.is_test));

  const subscriptions_summary = summarizeTeacherSubs(subs);

  // MRR excludes test teachers.
  const teacher_mrr = computeTeacherMrr(
    subs.filter((s) => !testTeacherIds.has(s.teacher_id)),
  );

  // ── Referrals (teacher→teacher) ────────────────────────────────────────────
  const referrals: CeoTeacherReferralRow[] = profiles
    .filter((p) => !!p.referred_by_teacher_id)
    .map((refereeProfile) => {
      const refereeSub = subByTeacher.get(refereeProfile.user_id);
      const referrerId = refereeProfile.referred_by_teacher_id;
      const referrerProfile = referrerId ? profileById.get(referrerId) : null;
      return {
        referee_id: refereeProfile.user_id,
        referee_name: refereeProfile.display_name ?? nameOf(refereeProfile.user_id),
        referee_code: refereeProfile.referral_code ?? null,
        referee_is_test: !!refereeProfile.is_test,
        referrer_id: referrerId ?? null,
        referrer_name: referrerProfile?.display_name ?? (referrerId ? nameOf(referrerId) : null),
        referrer_code: referrerProfile?.referral_code ?? null,
        converted: !!refereeSub?.referral_rewarded_at,
        rewarded_at: refereeSub?.referral_rewarded_at ?? null,
        free_months_credit: Number(refereeSub?.free_months_credit ?? 0),
      };
    });

  // ── Teachers (global list) ─────────────────────────────────────────────────
  const teachers: CeoTeacherRow[] = profiles
    .map((p) => {
      const u = userById.get(p.user_id);
      const sub = subByTeacher.get(p.user_id);
      return {
        teacher_id: p.user_id,
        display_name: p.display_name ?? u?.name ?? null,
        referral_code: p.referral_code ?? null,
        subject: p.subject ?? null,
        phone: u?.phone ?? null,
        is_test: !!p.is_test,
        plan_key: sub?.plan_key ?? p.plan_key ?? null,
        status: sub?.status ?? null,
        created_at: p.created_at ?? null,
      };
    })
    .sort((a, b) => Number(a.is_test) - Number(b.is_test));

  // ── Attachments ────────────────────────────────────────────────────────────
  const attachments: CeoTeacherAttachmentRow[] = groups
    .filter((g): g is GroupRow & { teacher_id: string } => !!g.teacher_id)
    .map((g) => ({
      group_id: g.id,
      group_name: g.name ?? null,
      teacher_id: g.teacher_id,
      teacher_name: nameOf(g.teacher_id),
      center_id: g.center_id ?? null,
      center_name: g.center_id ? (centerById.get(g.center_id)?.name ?? null) : null,
      kind: g.kind ?? 'private',
      center_cut_egp: Number(g.center_cut_egp ?? 0),
      fee_per_class: g.fee_per_class != null ? Number(g.fee_per_class) : null,
      subject: g.subject ?? null,
      status: g.status ?? null,
      current: g.kind === 'center',
    }))
    // Current center attachments first.
    .sort((a, b) => Number(b.current) - Number(a.current));

  // ── Credits ────────────────────────────────────────────────────────────────
  const credits: CeoTeacherCreditRow[] = profiles
    .map((p) => {
      const sub = Number(p.blast_credits_subscription ?? 0);
      const purchased = Number(p.blast_credits_purchased ?? 0);
      return {
        teacher_id: p.user_id,
        display_name: p.display_name ?? userById.get(p.user_id)?.name ?? null,
        referral_code: p.referral_code ?? null,
        is_test: !!p.is_test,
        subscription_credits: sub,
        purchased_credits: purchased,
        total_credits: sub + purchased,
      };
    })
    .sort((a, b) => b.total_credits - a.total_credits);

  return {
    subscriptions,
    subscriptions_summary,
    referrals,
    teachers,
    attachments,
    credits,
    teacher_mrr,
  };
}

/**
 * Teacher-side aggregates for the combined owner dashboard top-line. Test
 * teachers are excluded from MRR and counts (finance correctness). `centerMrr`
 * is passed in by the dashboard route so the combined figure stays a single
 * source of truth.
 */
export async function getTeacherDashboardCombined(
  supabase: SupabaseClient,
  centerMrr: number,
): Promise<CeoTeacherCombined> {
  const [subsRes, profilesRes] = await Promise.all([
    supabase.from('teacher_subscriptions').select('teacher_id, plan_key, status, price_gross'),
    supabase.from('teacher_profiles').select('user_id, is_test'),
  ]);

  const subs = (subsRes.data ?? []) as Array<
    MrrSubInput & { teacher_id: string }
  >;
  const profiles = (profilesRes.data ?? []) as Array<{ user_id: string; is_test: boolean | null }>;

  const testIds = new Set(profiles.filter((p) => p.is_test).map((p) => p.user_id));
  const nonTestSubs = subs.filter((s) => !testIds.has(s.teacher_id));

  const teacherMrr = computeTeacherMrr(nonTestSubs);
  const teacherActiveSubs = nonTestSubs.filter((s) => s.status === 'active').length;
  const teacherTrials = nonTestSubs.filter((s) => s.status === 'trialing').length;
  const totalTeachers = profiles.filter((p) => !p.is_test).length;

  const center = Math.round(Number(centerMrr) || 0);
  return {
    center_mrr: center,
    teacher_mrr: teacherMrr,
    combined_mrr: center + teacherMrr,
    teacher_active_subs: teacherActiveSubs,
    teacher_trials: teacherTrials,
    total_teachers: totalTeachers,
  };
}
