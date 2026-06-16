// src/types/ceoTeachers.ts
//
// Types for the super-admin (platform owner) teacher-side visibility section.
// Read-only: every field maps to a real column confirmed against the live
// database (teacher_subscriptions / teacher_profiles / student_groups / users).
// The "T-number" the brief mentions does not exist in the schema — teachers are
// identified by referral_code + display name + the is_test flag.

export const TEACHER_TIER_KEYS = ['teacher_299', 'teacher_699'] as const;
export type TeacherTierKey = (typeof TEACHER_TIER_KEYS)[number];

export const TEACHER_SUB_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'suspended',
  'cancelled',
] as const;
export type TeacherSubStatus = (typeof TEACHER_SUB_STATUSES)[number];

/** Subscriptions tab row. */
export interface CeoTeacherSubscriptionRow {
  teacher_id: string;
  display_name: string | null;
  referral_code: string | null;
  is_test: boolean;
  phone: string | null;
  plan_key: string | null;
  status: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  next_billing_at: string | null;
  free_months_credit: number;
  price_gross: number | null;
  referral_rewarded_at: string | null;
}

/** Referrals tab row (teacher→teacher loop; distinct from the center referral program). */
export interface CeoTeacherReferralRow {
  referee_id: string;
  referee_name: string | null;
  referee_code: string | null;
  referee_is_test: boolean;
  referrer_id: string | null;
  referrer_name: string | null;
  referrer_code: string | null;
  /** Conversion fires on the referee's first cleared charge (referral_rewarded_at set). */
  converted: boolean;
  rewarded_at: string | null;
  free_months_credit: number;
}

/** Teachers tab row (global list). */
export interface CeoTeacherRow {
  teacher_id: string;
  display_name: string | null;
  referral_code: string | null;
  subject: string | null;
  phone: string | null;
  is_test: boolean;
  plan_key: string | null;
  /** Subscription status if a row exists, else null (no private group yet). */
  status: string | null;
  created_at: string | null;
}

/** Attachments tab row (which teacher is attached to which center, at what cut). */
export interface CeoTeacherAttachmentRow {
  group_id: string;
  group_name: string | null;
  teacher_id: string;
  teacher_name: string | null;
  center_id: string | null;
  center_name: string | null;
  kind: string;
  center_cut_egp: number;
  fee_per_class: number | null;
  subject: string | null;
  status: string | null;
  /** Current attachment = a center group (kind === 'center'); private = detached/independent. */
  current: boolean;
}

/** Credits tab row (two-bucket blast credit balances). */
export interface CeoTeacherCreditRow {
  teacher_id: string;
  display_name: string | null;
  referral_code: string | null;
  is_test: boolean;
  subscription_credits: number;
  purchased_credits: number;
  total_credits: number;
}

export interface CeoTeacherSubsSummary {
  total: number;
  trialing: number;
  active: number;
  past_due: number;
  suspended: number;
  cancelled: number;
}

export interface CeoTeacherData {
  subscriptions: CeoTeacherSubscriptionRow[];
  subscriptions_summary: CeoTeacherSubsSummary;
  referrals: CeoTeacherReferralRow[];
  teachers: CeoTeacherRow[];
  attachments: CeoTeacherAttachmentRow[];
  credits: CeoTeacherCreditRow[];
  /** Monthly recurring revenue from billable teacher subscriptions (test teachers excluded). */
  teacher_mrr: number;
}
