import { describe, it, expect } from 'vitest';
import { evaluateCenterGate, type CenterGateRow } from '@/lib/centerAccessGate';

// The gate is the one request-time decision every centre-side API route inherits.
// These cases lock down two things the audit cared about: precedence (blacklist >
// suspended > single-day lock) and, most importantly, that the LOCK half only fires
// when the lockout policy is active (the auto-charge interlock). A past-due unpaid
// centre must NOT read as locked while the policy is inactive.
describe('evaluateCenterGate precedence + interlock gating', () => {
  // next_payment_due far in the past + unpaid => centerIsLockedNow(row) is true today.
  const lockEligible: CenterGateRow = {
    status: 'active',
    is_blacklisted: false,
    billing_status: 'active',
    next_payment_due: '2020-01-01',
    auto_suspend_at: null,
  };

  it('returns null for a missing centre row (caller runs its own not-found path)', () => {
    expect(evaluateCenterGate(null, true)).toBeNull();
  });

  it('blacklist beats everything, regardless of the lock policy', () => {
    expect(evaluateCenterGate({ ...lockEligible, is_blacklisted: true }, false)).toBe('blacklisted');
    expect(evaluateCenterGate({ ...lockEligible, is_blacklisted: true }, true)).toBe('blacklisted');
  });

  it('suspended status returns suspended even when the lock policy is inactive', () => {
    expect(evaluateCenterGate({ ...lockEligible, status: 'suspended' }, false)).toBe('suspended');
  });

  it('a past-due unpaid centre is locked ONLY when the policy is active (interlock)', () => {
    expect(evaluateCenterGate(lockEligible, true)).toBe('locked');
    // Interlock off / HELD / kill switch => policyActive false => nothing locks.
    expect(evaluateCenterGate(lockEligible, false)).toBeNull();
  });

  it('a paid centre is never locked', () => {
    expect(evaluateCenterGate({ ...lockEligible, billing_status: 'paid' }, true)).toBeNull();
  });
});
