/**
 * Pure owner-normalization for the combined admin money screens.
 *
 * Covers:
 *  - invoiceAmount canonical helper (the teacher/engine `payment_amount` NULL bug).
 *  - normalizeCenter / normalizeTeacher field mapping, keeping the two pricing
 *    ladders distinct.
 *  - unifiedStatus mappings for both models.
 *  - Cairo-day normalization (center DATE passthrough, teacher timestamptz).
 *  - owner-filter request parsing + matching.
 */
import { describe, it, expect } from 'vitest';
import {
  invoiceAmount,
  normalizeCenter,
  normalizeTeacher,
  centerUnifiedStatus,
  teacherUnifiedStatus,
  parseOwnerFilter,
  ownerMatchesFilter,
} from '@/lib/ownerNormalizer';
import { getImpliedMonthlyMrr, PLANS } from '@/lib/pricing';
import { teacherMonthlyGross } from '@/lib/ceoTeachers';

describe('invoiceAmount (canonical)', () => {
  it('prefers payment_amount when present', () => {
    expect(invoiceAmount({ payment_amount: 500, total_amount: 999 })).toBe(500);
  });
  it('falls back to total_amount when payment_amount is NULL (engine/teacher invoices)', () => {
    expect(invoiceAmount({ payment_amount: null, total_amount: 999 })).toBe(999);
    expect(invoiceAmount({ total_amount: 1234 })).toBe(1234);
  });
  it('keeps a real payment_amount of 0 as 0 (nullish, not falsy)', () => {
    expect(invoiceAmount({ payment_amount: 0, total_amount: 999 })).toBe(0);
  });
  it('returns 0 when both are missing/null', () => {
    expect(invoiceAmount({ payment_amount: null, total_amount: null })).toBe(0);
    expect(invoiceAmount({})).toBe(0);
    expect(invoiceAmount(null)).toBe(0);
  });
  it('coerces numeric strings', () => {
    expect(invoiceAmount({ payment_amount: '750.5' })).toBe(750.5);
    expect(invoiceAmount({ payment_amount: null, total_amount: '999' })).toBe(999);
  });
});

describe('centerUnifiedStatus', () => {
  it('maps suspended / churned / cancelled / overdue / active', () => {
    expect(centerUnifiedStatus('suspended', 'paid')).toBe('suspended');
    expect(centerUnifiedStatus('churned', 'paid')).toBe('churned');
    expect(centerUnifiedStatus('cancelled', 'paid')).toBe('churned');
    expect(centerUnifiedStatus('deleted', 'paid')).toBe('inactive');
    expect(centerUnifiedStatus('active', 'overdue')).toBe('overdue');
    expect(centerUnifiedStatus('active', 'paid')).toBe('active');
    expect(centerUnifiedStatus(null, null)).toBe('active');
  });
  it('suspended account wins over an overdue billing_status', () => {
    expect(centerUnifiedStatus('suspended', 'overdue')).toBe('suspended');
  });
});

describe('teacherUnifiedStatus', () => {
  it('maps trialing→trial, past_due→overdue, cancelled→churned', () => {
    expect(teacherUnifiedStatus('trialing')).toBe('trial');
    expect(teacherUnifiedStatus('active')).toBe('active');
    expect(teacherUnifiedStatus('past_due')).toBe('overdue');
    expect(teacherUnifiedStatus('suspended')).toBe('suspended');
    expect(teacherUnifiedStatus('cancelled')).toBe('churned');
    expect(teacherUnifiedStatus(null)).toBe('inactive');
    expect(teacherUnifiedStatus('weird')).toBe('inactive');
  });
});

describe('normalizeCenter', () => {
  it('maps fields and derives MRR via getImpliedMonthlyMrr (active starter)', () => {
    const acct = normalizeCenter({
      id: 'c1',
      name: 'Center One',
      phone: '01000000000',
      plan: 'starter',
      all_in_price: null,
      billing_period: 'quarterly',
      status: 'active',
      billing_status: 'paid',
      next_payment_due: '2026-07-15',
      last_payment_date: '2026-04-15',
      is_test: false,
    });
    expect(acct.ownerType).toBe('center');
    expect(acct.ownerId).toBe('c1');
    expect(acct.name).toBe('Center One');
    expect(acct.phone).toBe('01000000000');
    expect(acct.tier).toBe('starter');
    expect(acct.cadence).toBe('quarterly');
    expect(acct.nextChargeCairoDay).toBe('2026-07-15'); // DATE passthrough
    expect(acct.unifiedStatus).toBe('active');
    expect(acct.isTest).toBe(false);
    expect(acct.lastPaymentAt).toBe('2026-04-15');
    expect(acct.monthlyMrr).toBe(PLANS.starter.quarterlyAllIn);
    expect(acct.monthlyMrr).toBe(
      getImpliedMonthlyMrr({
        plan: 'starter',
        all_in_price: null,
        billing_period: 'quarterly',
        status: 'active',
        is_test: false,
      }),
    );
  });

  it('suspended center → MRR 0 and unifiedStatus suspended', () => {
    const acct = normalizeCenter({
      id: 'c2',
      plan: 'pro',
      all_in_price: 4499,
      billing_period: 'quarterly',
      status: 'suspended',
      billing_status: 'overdue',
    });
    expect(acct.monthlyMrr).toBe(0);
    expect(acct.unifiedStatus).toBe('suspended');
  });

  it('is_test center → MRR 0 (test exclusion via pricing helper)', () => {
    const acct = normalizeCenter({
      id: 'c3',
      plan: 'starter',
      all_in_price: 4499,
      billing_period: 'quarterly',
      status: 'active',
      is_test: true,
    });
    expect(acct.monthlyMrr).toBe(0);
    expect(acct.isTest).toBe(true);
  });
});

describe('normalizeTeacher', () => {
  const sub = {
    teacher_id: 't1',
    plan_key: 'teacher_pro',
    status: 'active',
    price_gross: 999,
    billing_interval: 'monthly',
    next_billing_at: '2026-07-01T09:00:00.000Z',
    last_payment_at: '2026-06-01T09:00:00.000Z',
  };
  const profile = { user_id: 't1', display_name: 'Ahmed', is_test: false };
  const user = { id: 't1', phone: '+201000000001', name: 'Ahmed U' };

  it('maps fields and derives monthly figure via teacherMonthlyGross', () => {
    const acct = normalizeTeacher(sub, profile, user);
    expect(acct.ownerType).toBe('teacher');
    expect(acct.ownerId).toBe('t1');
    expect(acct.name).toBe('Ahmed');
    expect(acct.phone).toBe('+201000000001');
    expect(acct.tier).toBe('teacher_pro');
    expect(acct.cadence).toBe('monthly');
    expect(acct.unifiedStatus).toBe('active');
    expect(acct.isTest).toBe(false);
    expect(acct.lastPaymentAt).toBe('2026-06-01T09:00:00.000Z');
    expect(acct.nextChargeCairoDay).toBe('2026-07-01'); // timestamptz → Cairo day
    expect(acct.monthlyMrr).toBe(999);
    expect(acct.monthlyMrr).toBe(teacherMonthlyGross('teacher_pro', 999));
  });

  it('falls back to tier default when price_gross missing, and to user name/phone', () => {
    const acct = normalizeTeacher(
      { teacher_id: 't2', plan_key: 'teacher_standard', status: 'past_due', price_gross: null },
      { user_id: 't2', display_name: null, is_test: true },
      { id: 't2', phone: '+201000000002', name: 'Sara U' },
    );
    expect(acct.name).toBe('Sara U'); // display_name null → user.name
    expect(acct.monthlyMrr).toBe(499); // tier default
    expect(acct.unifiedStatus).toBe('overdue'); // past_due
    expect(acct.isTest).toBe(true);
    expect(acct.nextChargeCairoDay).toBeNull();
  });

  it('keeps teacher tier distinct from center ladder (no cross-mapping)', () => {
    const acct = normalizeTeacher(
      { teacher_id: 't3', plan_key: 'teacher_scale', status: 'trialing', price_gross: 2499 },
      { user_id: 't3', display_name: 'Scale Teacher', is_test: false },
      null,
    );
    expect(acct.tier).toBe('teacher_scale');
    expect(acct.unifiedStatus).toBe('trial');
    // teacherMonthlyGross returns the raw tier figure regardless of trial status.
    expect(acct.monthlyMrr).toBe(2499);
    expect(acct.phone).toBeNull();
  });
});

describe('parseOwnerFilter / ownerMatchesFilter', () => {
  const req = (q: string) => new Request(`https://x.test/api/admin/billing${q}`);

  it('defaults to center when absent or unknown', () => {
    expect(parseOwnerFilter(req(''))).toBe('center');
    expect(parseOwnerFilter(req('?owner_type=nonsense'))).toBe('center');
    expect(parseOwnerFilter(req('?owner_type=CENTER'))).toBe('center');
  });
  it('parses teacher and all', () => {
    expect(parseOwnerFilter(req('?owner_type=teacher'))).toBe('teacher');
    expect(parseOwnerFilter(req('?owner_type=all'))).toBe('all');
  });
  it('matches by owner type, treating null owner_type as center', () => {
    expect(ownerMatchesFilter('center', 'center')).toBe(true);
    expect(ownerMatchesFilter(null, 'center')).toBe(true);
    expect(ownerMatchesFilter('teacher', 'center')).toBe(false);
    expect(ownerMatchesFilter('teacher', 'teacher')).toBe(true);
    expect(ownerMatchesFilter('center', 'teacher')).toBe(false);
    expect(ownerMatchesFilter('teacher', 'all')).toBe(true);
    expect(ownerMatchesFilter('center', 'all')).toBe(true);
  });
});
