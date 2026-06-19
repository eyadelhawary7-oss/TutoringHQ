// src/lib/ceoTeachersView.ts
//
// Pure, client-side view helpers for the /ceo/teachers tabs: summary-card math
// and per-column filter predicates over rows ALREADY loaded from
// /api/ceo/teachers. No queries, no writes — display-only derivations so they
// can be unit-tested without a network or DB.

import type {
  CeoTeacherAttachmentRow,
  CeoTeacherCreditRow,
  CeoTeacherReferralRow,
  CeoTeacherRow,
  CeoTeacherSubscriptionRow,
} from '@/types/ceoTeachers';

/** Sentinel select value for a null/empty cell (e.g. teacher with no plan/subscription). */
export const NONE = '__none__';

const TIER_STANDARD = 'teacher_standard';
const TIER_PRO = 'teacher_pro';
const TIER_SCALE = 'teacher_scale';

// ── Generic matchers ─────────────────────────────────────────────────────────

/** Case-insensitive substring match; an empty query matches everything. */
export function textIncludes(value: string | null | undefined, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return String(value ?? '').toLowerCase().includes(q);
}

/** Substring match against several fields (e.g. teacher name OR referral_code). */
export function anyIncludes(values: Array<string | null | undefined>, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return values.some((v) => String(v ?? '').toLowerCase().includes(q));
}

/** Exact match for a fixed-value column; null/empty cells normalize to NONE. Empty filter = all. */
export function matchSelect(rowValue: string | null | undefined, filterValue: string): boolean {
  if (!filterValue) return true;
  const norm = rowValue == null || rowValue === '' ? NONE : rowValue;
  return norm === filterValue;
}

function numStr(n: number | null | undefined): string {
  return n == null ? '' : String(n);
}

/** Distinct present values for a select column, null/empty collapsed to NONE. Preserves first-seen order. */
export function presentValues<T>(rows: T[], get: (r: T) => string | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const v = get(r);
    const norm = v == null || v === '' ? NONE : v;
    if (!seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  return out;
}

// ── Summary cards (computed over ALL rows of a tab) ──────────────────────────

export interface TeacherSummary {
  total: number;
  notSet: number;
  standard: number;
  pro: number;
  scale: number;
}
export function teacherSummary(rows: CeoTeacherRow[]): TeacherSummary {
  return {
    total: rows.length,
    notSet: rows.filter(
      (r) => r.plan_key !== TIER_STANDARD && r.plan_key !== TIER_PRO && r.plan_key !== TIER_SCALE,
    ).length,
    standard: rows.filter((r) => r.plan_key === TIER_STANDARD).length,
    pro: rows.filter((r) => r.plan_key === TIER_PRO).length,
    scale: rows.filter((r) => r.plan_key === TIER_SCALE).length,
  };
}

export interface ReferralSummary {
  total: number;
  converted: number;
  pending: number;
  freeMonths: number;
}
export function referralSummary(rows: CeoTeacherReferralRow[]): ReferralSummary {
  return {
    total: rows.length,
    converted: rows.filter((r) => r.converted).length,
    pending: rows.filter((r) => !r.converted).length,
    freeMonths: rows.reduce((s, r) => s + (Number(r.free_months_credit) || 0), 0),
  };
}

export interface AttachmentSummary {
  total: number;
  current: number;
  detached: number;
}
export function attachmentSummary(rows: CeoTeacherAttachmentRow[]): AttachmentSummary {
  const current = rows.filter((r) => r.current).length;
  return {
    total: rows.length,
    current,
    detached: rows.length - current,
  };
}

export interface CreditSummary {
  withCredits: number;
  subscription: number;
  purchased: number;
}
export function creditSummary(rows: CeoTeacherCreditRow[]): CreditSummary {
  return {
    withCredits: rows.filter((r) => (Number(r.total_credits) || 0) > 0).length,
    subscription: rows.reduce((s, r) => s + (Number(r.subscription_credits) || 0), 0),
    purchased: rows.reduce((s, r) => s + (Number(r.purchased_credits) || 0), 0),
  };
}

// ── Per-tab filters ──────────────────────────────────────────────────────────

export interface SubscriptionFilters {
  teacher: string;
  tier: string;
  status: string;
  trialEnds: string;
  periodEnd: string;
  nextBilling: string;
  freeMonths: string;
}
export const EMPTY_SUBSCRIPTION_FILTERS: SubscriptionFilters = {
  teacher: '',
  tier: '',
  status: '',
  trialEnds: '',
  periodEnd: '',
  nextBilling: '',
  freeMonths: '',
};
export function filterSubscriptions(
  rows: CeoTeacherSubscriptionRow[],
  f: SubscriptionFilters,
): CeoTeacherSubscriptionRow[] {
  return rows.filter(
    (r) =>
      anyIncludes([r.display_name, r.referral_code], f.teacher) &&
      matchSelect(r.plan_key, f.tier) &&
      matchSelect(r.status, f.status) &&
      textIncludes(r.trial_ends_at, f.trialEnds) &&
      textIncludes(r.current_period_end, f.periodEnd) &&
      textIncludes(r.next_billing_at, f.nextBilling) &&
      textIncludes(numStr(r.free_months_credit), f.freeMonths),
  );
}

export interface ReferralFilters {
  referrer: string;
  referee: string;
  conversion: string; // '' | 'converted' | 'pending'
  rewardedAt: string;
  freeMonths: string;
}
export const EMPTY_REFERRAL_FILTERS: ReferralFilters = {
  referrer: '',
  referee: '',
  conversion: '',
  rewardedAt: '',
  freeMonths: '',
};
function matchConversion(converted: boolean, filter: string): boolean {
  if (!filter) return true;
  return filter === (converted ? 'converted' : 'pending');
}
export function filterReferrals(
  rows: CeoTeacherReferralRow[],
  f: ReferralFilters,
): CeoTeacherReferralRow[] {
  return rows.filter(
    (r) =>
      anyIncludes([r.referrer_name, r.referrer_code], f.referrer) &&
      anyIncludes([r.referee_name, r.referee_code], f.referee) &&
      matchConversion(r.converted, f.conversion) &&
      textIncludes(r.rewarded_at, f.rewardedAt) &&
      textIncludes(numStr(r.free_months_credit), f.freeMonths),
  );
}

export interface TeacherFilters {
  teacher: string;
  subject: string;
  phone: string;
  tier: string;
  status: string;
  joined: string;
}
export const EMPTY_TEACHER_FILTERS: TeacherFilters = {
  teacher: '',
  subject: '',
  phone: '',
  tier: '',
  status: '',
  joined: '',
};
export function filterTeachers(rows: CeoTeacherRow[], f: TeacherFilters): CeoTeacherRow[] {
  return rows.filter(
    (r) =>
      anyIncludes([r.display_name, r.referral_code], f.teacher) &&
      textIncludes(r.subject, f.subject) &&
      textIncludes(r.phone, f.phone) &&
      matchSelect(r.plan_key, f.tier) &&
      matchSelect(r.status, f.status) &&
      textIncludes(r.created_at, f.joined),
  );
}

export interface AttachmentFilters {
  teacher: string;
  center: string;
  group: string;
  cut: string;
  fee: string;
  state: string; // '' | 'current' | 'private'
}
export const EMPTY_ATTACHMENT_FILTERS: AttachmentFilters = {
  teacher: '',
  center: '',
  group: '',
  cut: '',
  fee: '',
  state: '',
};
function matchState(current: boolean, filter: string): boolean {
  if (!filter) return true;
  return filter === (current ? 'current' : 'private');
}
export function filterAttachments(
  rows: CeoTeacherAttachmentRow[],
  f: AttachmentFilters,
): CeoTeacherAttachmentRow[] {
  return rows.filter(
    (r) =>
      textIncludes(r.teacher_name, f.teacher) &&
      textIncludes(r.center_name, f.center) &&
      anyIncludes([r.group_name, r.subject], f.group) &&
      textIncludes(numStr(r.center_cut_egp), f.cut) &&
      textIncludes(numStr(r.fee_per_class), f.fee) &&
      matchState(r.current, f.state),
  );
}

export interface CreditFilters {
  teacher: string;
  subscription: string;
  purchased: string;
  total: string;
}
export const EMPTY_CREDIT_FILTERS: CreditFilters = {
  teacher: '',
  subscription: '',
  purchased: '',
  total: '',
};
export function filterCredits(rows: CeoTeacherCreditRow[], f: CreditFilters): CeoTeacherCreditRow[] {
  return rows.filter(
    (r) =>
      anyIncludes([r.display_name, r.referral_code], f.teacher) &&
      textIncludes(numStr(r.subscription_credits), f.subscription) &&
      textIncludes(numStr(r.purchased_credits), f.purchased) &&
      textIncludes(numStr(r.total_credits), f.total),
  );
}

/** True when any field of a filter object is a non-empty string (used to enable "clear"). */
export function hasActiveFilter(filters: object): boolean {
  return Object.values(filters).some((v) => typeof v === 'string' && v.trim() !== '');
}
