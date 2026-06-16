/**
 * Client-side view helpers for the /ceo/teachers tabs: summary-card math and
 * per-column filter predicates over already-loaded rows. Pure functions — no
 * network, no DB.
 *
 * Covers: card counts per tab; fixed-value select filters; text search incl.
 * teacher name OR referral_code; combined filters AND together; empty filters
 * (clear) restore all rows; an over-narrow filter yields zero rows (the
 * "no rows match" state).
 */
import { describe, it, expect } from 'vitest';
import {
  NONE,
  presentValues,
  hasActiveFilter,
  textIncludes,
  anyIncludes,
  matchSelect,
  teacherSummary,
  referralSummary,
  attachmentSummary,
  creditSummary,
  filterTeachers,
  filterReferrals,
  filterAttachments,
  filterCredits,
  filterSubscriptions,
  EMPTY_TEACHER_FILTERS,
  EMPTY_REFERRAL_FILTERS,
  EMPTY_ATTACHMENT_FILTERS,
  EMPTY_CREDIT_FILTERS,
  EMPTY_SUBSCRIPTION_FILTERS,
} from '@/lib/ceoTeachersView';
import type {
  CeoTeacherRow,
  CeoTeacherReferralRow,
  CeoTeacherAttachmentRow,
  CeoTeacherCreditRow,
  CeoTeacherSubscriptionRow,
} from '@/types/ceoTeachers';

// ── Fixtures ─────────────────────────────────────────────────────────────────
const teachers: CeoTeacherRow[] = [
  { teacher_id: 't1', display_name: 'Ahmed', referral_code: 'AHMED7X', subject: 'Math', phone: '+201000000001', is_test: false, plan_key: 'teacher_699', status: 'active', created_at: '2026-01-01T00:00:00Z' },
  { teacher_id: 't2', display_name: 'Sara', referral_code: 'SARA22', subject: 'Physics', phone: '+201000000002', is_test: false, plan_key: 'teacher_299', status: 'trialing', created_at: '2026-02-01T00:00:00Z' },
  { teacher_id: 't3', display_name: 'Omar', referral_code: 'OMAR9', subject: null, phone: null, is_test: true, plan_key: null, status: null, created_at: '2026-03-01T00:00:00Z' },
];

const referrals: CeoTeacherReferralRow[] = [
  { referee_id: 't2', referee_name: 'Sara', referee_code: 'SARA22', referee_is_test: false, referrer_id: 't1', referrer_name: 'Ahmed', referrer_code: 'AHMED7X', converted: true, rewarded_at: '2026-06-01T00:00:00Z', free_months_credit: 1 },
  { referee_id: 't3', referee_name: 'Omar', referee_code: 'OMAR9', referee_is_test: true, referrer_id: 't1', referrer_name: 'Ahmed', referrer_code: 'AHMED7X', converted: false, rewarded_at: null, free_months_credit: 0 },
];

const attachments: CeoTeacherAttachmentRow[] = [
  { group_id: 'g1', group_name: 'Center Group', teacher_id: 't1', teacher_name: 'Ahmed', center_id: 'c1', center_name: 'Center One', kind: 'center', center_cut_egp: 20, fee_per_class: 100, subject: 'Math', status: 'active', current: true },
  { group_id: 'g2', group_name: 'Private Group', teacher_id: 't1', teacher_name: 'Ahmed', center_id: null, center_name: null, kind: 'private', center_cut_egp: 0, fee_per_class: 150, subject: 'Math', status: 'active', current: false },
];

const credits: CeoTeacherCreditRow[] = [
  { teacher_id: 't1', display_name: 'Ahmed', referral_code: 'AHMED7X', is_test: false, subscription_credits: 100, purchased_credits: 50, total_credits: 150 },
  { teacher_id: 't2', display_name: 'Sara', referral_code: 'SARA22', is_test: false, subscription_credits: 0, purchased_credits: 0, total_credits: 0 },
];

const subscriptions: CeoTeacherSubscriptionRow[] = [
  { teacher_id: 't1', display_name: 'Ahmed', referral_code: 'AHMED7X', is_test: false, phone: null, plan_key: 'teacher_699', status: 'active', trial_ends_at: null, current_period_end: '2026-07-01T00:00:00Z', next_billing_at: '2026-07-01T00:00:00Z', free_months_credit: 1, price_gross: 699, referral_rewarded_at: '2026-06-01T00:00:00Z' },
  { teacher_id: 't2', display_name: 'Sara', referral_code: 'SARA22', is_test: false, phone: null, plan_key: 'teacher_299', status: 'trialing', trial_ends_at: '2026-06-20T00:00:00Z', current_period_end: '2026-06-20T00:00:00Z', next_billing_at: '2026-06-20T00:00:00Z', free_months_credit: 0, price_gross: 299, referral_rewarded_at: null },
];

// ── Generic matchers ─────────────────────────────────────────────────────────
describe('matchers', () => {
  it('textIncludes is case-insensitive and empty-query matches all', () => {
    expect(textIncludes('Ahmed', 'ahm')).toBe(true);
    expect(textIncludes('Ahmed', 'zzz')).toBe(false);
    expect(textIncludes(null, '')).toBe(true);
    expect(textIncludes(null, 'a')).toBe(false);
  });
  it('anyIncludes matches across fields (name OR code)', () => {
    expect(anyIncludes(['Ahmed', 'AHMED7X'], 'med7')).toBe(true);
    expect(anyIncludes(['Ahmed', 'AHMED7X'], 'sara')).toBe(false);
  });
  it('matchSelect treats empty as all and normalizes null to NONE', () => {
    expect(matchSelect('active', '')).toBe(true);
    expect(matchSelect('active', 'active')).toBe(true);
    expect(matchSelect('active', 'trialing')).toBe(false);
    expect(matchSelect(null, NONE)).toBe(true);
    expect(matchSelect('teacher_299', NONE)).toBe(false);
  });
  it('presentValues collapses null/empty to NONE, de-dups, preserves order', () => {
    expect(presentValues(teachers, (r) => r.plan_key)).toEqual(['teacher_699', 'teacher_299', NONE]);
  });
  it('hasActiveFilter detects any non-empty field', () => {
    expect(hasActiveFilter(EMPTY_TEACHER_FILTERS)).toBe(false);
    expect(hasActiveFilter({ ...EMPTY_TEACHER_FILTERS, teacher: 'a' })).toBe(true);
  });
});

// ── Summary cards ────────────────────────────────────────────────────────────
describe('summary cards', () => {
  it('teacherSummary: total / not-set / standard / pro', () => {
    expect(teacherSummary(teachers)).toEqual({ total: 3, notSet: 1, standard: 1, pro: 1 });
  });
  it('referralSummary: total / converted / pending / free months sum', () => {
    expect(referralSummary(referrals)).toEqual({ total: 2, converted: 1, pending: 1, freeMonths: 1 });
  });
  it('attachmentSummary: total / current / detached', () => {
    expect(attachmentSummary(attachments)).toEqual({ total: 2, current: 1, detached: 1 });
  });
  it('creditSummary: teachers-with-credits / bucket sums', () => {
    expect(creditSummary(credits)).toEqual({ withCredits: 1, subscription: 100, purchased: 50 });
  });
});

// ── Filters ──────────────────────────────────────────────────────────────────
describe('filters', () => {
  it('empty filters return all rows (clear restores)', () => {
    expect(filterTeachers(teachers, EMPTY_TEACHER_FILTERS)).toHaveLength(3);
    expect(filterReferrals(referrals, EMPTY_REFERRAL_FILTERS)).toHaveLength(2);
    expect(filterAttachments(attachments, EMPTY_ATTACHMENT_FILTERS)).toHaveLength(2);
    expect(filterCredits(credits, EMPTY_CREDIT_FILTERS)).toHaveLength(2);
    expect(filterSubscriptions(subscriptions, EMPTY_SUBSCRIPTION_FILTERS)).toHaveLength(2);
  });

  it('teacher text search matches name OR referral_code', () => {
    expect(filterTeachers(teachers, { ...EMPTY_TEACHER_FILTERS, teacher: 'sara' }).map((r) => r.teacher_id)).toEqual(['t2']);
    expect(filterTeachers(teachers, { ...EMPTY_TEACHER_FILTERS, teacher: 'ahmed7x' }).map((r) => r.teacher_id)).toEqual(['t1']);
  });

  it('teacher tier select narrows by fixed value (incl. NONE for no plan)', () => {
    expect(filterTeachers(teachers, { ...EMPTY_TEACHER_FILTERS, tier: 'teacher_299' }).map((r) => r.teacher_id)).toEqual(['t2']);
    expect(filterTeachers(teachers, { ...EMPTY_TEACHER_FILTERS, tier: NONE }).map((r) => r.teacher_id)).toEqual(['t3']);
  });

  it('combined filters AND together', () => {
    // subject "math" + tier Pro → only Ahmed; subject "math" + tier Standard → none.
    expect(filterTeachers(teachers, { ...EMPTY_TEACHER_FILTERS, subject: 'math', tier: 'teacher_699' }).map((r) => r.teacher_id)).toEqual(['t1']);
    expect(filterTeachers(teachers, { ...EMPTY_TEACHER_FILTERS, subject: 'math', tier: 'teacher_299' })).toHaveLength(0);
  });

  it('over-narrow filter yields zero rows (no-match state)', () => {
    expect(filterTeachers(teachers, { ...EMPTY_TEACHER_FILTERS, teacher: 'nobody' })).toHaveLength(0);
  });

  it('referral conversion select: converted vs pending', () => {
    expect(filterReferrals(referrals, { ...EMPTY_REFERRAL_FILTERS, conversion: 'converted' }).map((r) => r.referee_id)).toEqual(['t2']);
    expect(filterReferrals(referrals, { ...EMPTY_REFERRAL_FILTERS, conversion: 'pending' }).map((r) => r.referee_id)).toEqual(['t3']);
  });

  it('attachment state select: current vs private; group matches name OR subject', () => {
    expect(filterAttachments(attachments, { ...EMPTY_ATTACHMENT_FILTERS, state: 'current' }).map((r) => r.group_id)).toEqual(['g1']);
    expect(filterAttachments(attachments, { ...EMPTY_ATTACHMENT_FILTERS, state: 'private' }).map((r) => r.group_id)).toEqual(['g2']);
    expect(filterAttachments(attachments, { ...EMPTY_ATTACHMENT_FILTERS, group: 'private' }).map((r) => r.group_id)).toEqual(['g2']);
    expect(filterAttachments(attachments, { ...EMPTY_ATTACHMENT_FILTERS, center: 'one' }).map((r) => r.group_id)).toEqual(['g1']);
  });

  it('credit numeric contains-match on bucket values', () => {
    expect(filterCredits(credits, { ...EMPTY_CREDIT_FILTERS, subscription: '100' }).map((r) => r.teacher_id)).toEqual(['t1']);
    expect(filterCredits(credits, { ...EMPTY_CREDIT_FILTERS, teacher: 'sara' }).map((r) => r.teacher_id)).toEqual(['t2']);
  });

  it('subscription select + date contains-match', () => {
    expect(filterSubscriptions(subscriptions, { ...EMPTY_SUBSCRIPTION_FILTERS, status: 'active' }).map((r) => r.teacher_id)).toEqual(['t1']);
    expect(filterSubscriptions(subscriptions, { ...EMPTY_SUBSCRIPTION_FILTERS, periodEnd: '2026-07' }).map((r) => r.teacher_id)).toEqual(['t1']);
  });
});
