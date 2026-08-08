import type { SupabaseClient } from '@supabase/supabase-js';
import { cairoDateKey, startOfUtcInstantForCairoCalendarDay } from '@/lib/cairo/day';

/**
 * `Merged-Admin-Accounts` §04 — the referral programme block and the ranked
 * top-referrers list.
 *
 * ## The ladder — ONE source, and this is it
 *
 *   month 1 → 25% · months 2 to 6 → 10% · month 7 onward → 5%
 *
 * Month 6 is 10%. Month 7 is 5%. The bands touch and do not overlap.
 *
 * `design/NEW-MODEL.md` and `design/NEW-FEATURES.md` both state this ladder, and
 * all four drawings that render it agree ("Months 2 to 6" / "الأشهر ٢ إلى ٦").
 *
 * It previously ran 10% through month 12, under design correction D2 ("live
 * wins, 10% for twelve months"). D2 was right when it was written on 29 July
 * and went stale on 6 August, when NEW-MODEL restated the 2-to-6 ladder. Ruled
 * back to the model by Eyad on 8 August. See `design/CHANGE-LOG.md` D2.
 *
 * **Read the rate from `rateForMonth()`. Do not re-derive it.** The old
 * `process-commission` route carried its own hardcoded copy of the ladder, so
 * the boundary existed in two places and only one of them was ever corrected —
 * which is exactly how a single month ends up paying the wrong rate on every
 * referral.
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
  { ratePct: 10, fromMonth: 2, toMonth: 6 },
  { ratePct: 5, fromMonth: 7, toMonth: null },
];

/**
 * The commission rate for a given month of a referral's life, as a fraction
 * (0.25 / 0.10 / 0.05). `monthsSinceActivation` is 1-based: the first paid month
 * is 1.
 *
 * Derived from COMMISSION_TIERS so the band boundaries exist in exactly one
 * place. Anything that needs a rate calls this; nothing re-implements the
 * ladder.
 *
 * Months at or beyond the last tier's `fromMonth` take that tier's rate, so the
 * open-ended tail needs no special case. A month below 1 is not a real referral
 * month and throws rather than silently paying the top rate.
 */
export function rateForMonth(monthsSinceActivation: number): number {
  if (!Number.isFinite(monthsSinceActivation) || monthsSinceActivation < 1) {
    throw new Error(`rateForMonth: months must be >= 1, got ${monthsSinceActivation}`);
  }
  for (const tier of COMMISSION_TIERS) {
    if (
      monthsSinceActivation >= tier.fromMonth &&
      (tier.toMonth === null || monthsSinceActivation <= tier.toMonth)
    ) {
      return tier.ratePct / 100;
    }
  }
  // Unreachable while the last tier is open-ended, and a loud failure rather
  // than a quiet default if someone ever closes it.
  throw new Error(`rateForMonth: no tier covers month ${monthsSinceActivation}`);
}

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
