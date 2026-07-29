import type { SupabaseClient } from '@supabase/supabase-js';
import { cairoDateKey, startOfUtcInstantForCairoCalendarDay } from '@/lib/cairo/day';

/**
 * `Merged-Admin-Accounts` §04 — the referral programme block and the ranked
 * top-referrers list.
 *
 * ## The ladder is the live one, not the drawn one
 *
 * `/api/referrals/process-commission` is the only thing that sets
 * `referral_commissions.commission_rate`, and it computes:
 *
 *   month 1 → 25% · months 2–12 → 10% · month 13 onward → 5%
 *
 * The design draws "months 2 to 6" and "month 7 onward". That is design
 * correction **D2 — live wins, 10% for twelve months**. These constants mirror
 * the live rule so the screen cannot drift from what actually gets paid; if the
 * rule ever changes, both move together or the test below fails.
 *
 * ## What is NOT here
 *
 * The design's **SIGNUP REWARD** row (a 100 EGP new-customer credit on the
 * referred account) has no column, no code path and no ledger entry anywhere in
 * the product. Omitted entirely rather than rendered with an invented number.
 *
 * Teachers do not earn commission. `grantReferralReward` pays **+1 free month
 * to each side** when a referred teacher clears their first real charge, so a
 * teacher referrer has free months earned, never an EGP balance owed. The
 * teacher rows carry that figure under its own label.
 */

export interface CommissionTier {
  ratePct: number;
  fromMonth: number;
  /** null = open-ended. */
  toMonth: number | null;
}

export const COMMISSION_TIERS: CommissionTier[] = [
  { ratePct: 25, fromMonth: 1, toMonth: 1 },
  { ratePct: 10, fromMonth: 2, toMonth: 12 },
  { ratePct: 5, fromMonth: 13, toMonth: null },
];

export interface ProgramSummary {
  paidThisMonth: number;
  paidLastMonth: number;
  /** Percent change month over month, or null when last month was zero. */
  paidGrowthPct: number | null;
  activeReferrers: number;
  newReferralsThisMonth: number;
  owedNow: number;
  tiers: CommissionTier[];
}

export interface TopReferrer {
  id: string;
  name: string | null;
  kind: 'center' | 'teacher';
  referred: number;
  active: number;
  /** EGP owed. Centres only — teachers are never owed cash. */
  owed: number | null;
  /** Free months earned. Teachers only. */
  freeMonths: number | null;
}

/** First UTC instant of the Cairo calendar month containing `now`, and of the one before it. */
export function cairoMonthBounds(now: Date = new Date()): {
  thisMonthStart: Date;
  lastMonthStart: Date;
  nextMonthStart: Date;
  thisMonthKey: string;
} {
  const key = cairoDateKey(now); // YYYY-MM-DD in Cairo
  const [y, m] = key.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');
  const first = (yy: number, mm: number) => `${yy}-${pad(mm)}-01`;
  const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  const next = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
  return {
    thisMonthStart: startOfUtcInstantForCairoCalendarDay(first(y, m)),
    lastMonthStart: startOfUtcInstantForCairoCalendarDay(first(prev.y, prev.m)),
    nextMonthStart: startOfUtcInstantForCairoCalendarDay(first(next.y, next.m)),
    thisMonthKey: `${y}-${pad(m)}`,
  };
}

export async function buildProgramSummary(
  supabaseAdmin: SupabaseClient,
  now: Date = new Date(),
): Promise<ProgramSummary> {
  const { thisMonthStart, lastMonthStart, nextMonthStart } = cairoMonthBounds(now);

  const [paidRes, owedRes, referralsRes] = await Promise.all([
    supabaseAdmin
      .from('referral_commissions')
      .select('commission_amount, paid_at')
      .eq('status', 'paid')
      .gte('paid_at', lastMonthStart.toISOString())
      .lt('paid_at', nextMonthStart.toISOString()),
    supabaseAdmin
      .from('referral_commissions')
      .select('commission_amount')
      .eq('status', 'withdrawable'),
    supabaseAdmin.from('referrals').select('referrer_center_id, status, created_at'),
  ]);

  let paidThisMonth = 0;
  let paidLastMonth = 0;
  for (const row of (paidRes.data ?? []) as { commission_amount: number; paid_at: string | null }[]) {
    if (!row.paid_at) continue;
    const at = new Date(row.paid_at);
    const amount = Number(row.commission_amount || 0);
    if (at >= thisMonthStart) paidThisMonth += amount;
    else paidLastMonth += amount;
  }

  const owedNow = ((owedRes.data ?? []) as { commission_amount: number }[]).reduce(
    (sum, r) => sum + Number(r.commission_amount || 0),
    0,
  );

  const referrals = (referralsRes.data ?? []) as {
    referrer_center_id: string | null;
    status: string | null;
    created_at: string | null;
  }[];

  const activeReferrers = new Set(
    referrals
      .filter((r) => r.status === 'active' || r.status === 'converted')
      .map((r) => r.referrer_center_id)
      .filter((x): x is string => !!x),
  ).size;

  const newReferralsThisMonth = referrals.filter(
    (r) => r.created_at && new Date(r.created_at) >= thisMonthStart,
  ).length;

  return {
    paidThisMonth,
    paidLastMonth,
    paidGrowthPct:
      paidLastMonth > 0
        ? Math.round(((paidThisMonth - paidLastMonth) / paidLastMonth) * 1000) / 10
        : null,
    activeReferrers,
    newReferralsThisMonth,
    owedNow,
    tiers: COMMISSION_TIERS,
  };
}

export async function buildTopReferrers(supabaseAdmin: SupabaseClient): Promise<TopReferrer[]> {
  const [referralsRes, commissionsRes, teacherProfilesRes] = await Promise.all([
    supabaseAdmin.from('referrals').select('referrer_center_id, status'),
    supabaseAdmin
      .from('referral_commissions')
      .select('referrer_center_id, commission_amount')
      .eq('status', 'withdrawable'),
    supabaseAdmin
      .from('teacher_profiles')
      .select('user_id, display_name, referred_by_teacher_id')
      .eq('is_test', false),
  ]);

  const referrals = (referralsRes.data ?? []) as {
    referrer_center_id: string | null;
    status: string | null;
  }[];
  const commissions = (commissionsRes.data ?? []) as {
    referrer_center_id: string | null;
    commission_amount: number;
  }[];
  const profiles = (teacherProfilesRes.data ?? []) as {
    user_id: string;
    display_name: string | null;
    referred_by_teacher_id: string | null;
  }[];

  // ── Centres ───────────────────────────────────────────────────────────────
  const byCenter = new Map<string, { referred: number; active: number; owed: number }>();
  const bump = (id: string) => {
    let e = byCenter.get(id);
    if (!e) {
      e = { referred: 0, active: 0, owed: 0 };
      byCenter.set(id, e);
    }
    return e;
  };
  for (const r of referrals) {
    if (!r.referrer_center_id) continue;
    const e = bump(r.referrer_center_id);
    e.referred += 1;
    if (r.status === 'active' || r.status === 'converted') e.active += 1;
  }
  for (const c of commissions) {
    if (!c.referrer_center_id) continue;
    bump(c.referrer_center_id).owed += Number(c.commission_amount || 0);
  }

  const centerIds = [...byCenter.keys()];
  const { data: centerRows } = centerIds.length
    ? await supabaseAdmin.from('centers').select('id, name').in('id', centerIds).eq('is_test', false)
    : { data: [] };
  const centerName = new Map(
    ((centerRows ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]),
  );

  const centers: TopReferrer[] = centerIds
    // A centre dropped by the is_test filter is a seed row, not a referrer.
    .filter((id) => centerName.has(id))
    .map((id) => {
      const e = byCenter.get(id) as { referred: number; active: number; owed: number };
      return {
        id,
        name: centerName.get(id) ?? null,
        kind: 'center' as const,
        referred: e.referred,
        active: e.active,
        owed: e.owed,
        freeMonths: null,
      };
    });

  // ── Teachers ──────────────────────────────────────────────────────────────
  // A teacher referrer earns free months, never cash, so `owed` stays null.
  const referredByTeacher = new Map<string, string[]>();
  for (const p of profiles) {
    if (!p.referred_by_teacher_id || p.referred_by_teacher_id === p.user_id) continue;
    const list = referredByTeacher.get(p.referred_by_teacher_id) ?? [];
    list.push(p.user_id);
    referredByTeacher.set(p.referred_by_teacher_id, list);
  }

  let teachers: TopReferrer[] = [];
  if (referredByTeacher.size > 0) {
    const nameByTeacher = new Map(profiles.map((p) => [p.user_id, p.display_name]));
    const refereeIds = [...referredByTeacher.values()].flat();
    // `referral_rewarded_at` is the durable marker grantReferralReward sets on
    // the referee once the reward actually landed — the only honest definition
    // of an "active" teacher referral.
    const { data: subRows } = await supabaseAdmin
      .from('teacher_subscriptions')
      .select('teacher_id, referral_rewarded_at')
      .in('teacher_id', refereeIds);
    const rewarded = new Set(
      ((subRows ?? []) as { teacher_id: string; referral_rewarded_at: string | null }[])
        .filter((s) => !!s.referral_rewarded_at)
        .map((s) => s.teacher_id),
    );

    teachers = [...referredByTeacher.entries()].map(([teacherId, referees]) => {
      const active = referees.filter((r) => rewarded.has(r)).length;
      return {
        id: teacherId,
        name: nameByTeacher.get(teacherId) ?? null,
        kind: 'teacher' as const,
        referred: referees.length,
        active,
        owed: null,
        // One free month per rewarded referee — grantReferralReward, Path A.
        freeMonths: active,
      };
    });
  }

  return [...centers, ...teachers].sort(
    (a, b) => (b.owed ?? 0) - (a.owed ?? 0) || b.referred - a.referred,
  );
}
