import { describe, it, expect } from 'vitest';
import {
  nextFreeBaselineTransition,
  teacherPrivateAccessByStatus,
  isTeacherPrivateLocked,
} from '@/lib/teacherFreeBaseline';

describe('teacher private access — truth table (mirrors SQL teacher_private_access)', () => {
  it('grants access for trialing and active', () => {
    expect(teacherPrivateAccessByStatus('trialing')).toBe(true);
    expect(teacherPrivateAccessByStatus('active')).toBe(true);
  });

  it('denies access for past_due and suspended (the free baseline / disciplinary)', () => {
    expect(teacherPrivateAccessByStatus('past_due')).toBe(false);
    expect(teacherPrivateAccessByStatus('suspended')).toBe(false);
  });

  it('cancelled keeps access only within the paid period', () => {
    expect(teacherPrivateAccessByStatus('cancelled', '2999-01-01T00:00:00Z')).toBe(true);
    expect(teacherPrivateAccessByStatus('cancelled', '2000-01-01T00:00:00Z')).toBe(false);
    expect(teacherPrivateAccessByStatus('cancelled', null)).toBe(false);
  });

  it('no/unknown status denies access', () => {
    expect(teacherPrivateAccessByStatus(null)).toBe(false);
    expect(teacherPrivateAccessByStatus(undefined)).toBe(false);
  });
});

describe('isTeacherPrivateLocked — the RLS chokepoint predicate', () => {
  it('a never-subscribed teacher (no row) is NOT locked (first-group trial can start)', () => {
    expect(isTeacherPrivateLocked(false, null)).toBe(false);
  });

  it('trialing/active with a row is NOT locked', () => {
    expect(isTeacherPrivateLocked(true, 'trialing')).toBe(false);
    expect(isTeacherPrivateLocked(true, 'active')).toBe(false);
  });

  it('past_due / suspended / expired-cancelled with a row ARE locked (free baseline)', () => {
    expect(isTeacherPrivateLocked(true, 'past_due')).toBe(true);
    expect(isTeacherPrivateLocked(true, 'suspended')).toBe(true);
    expect(isTeacherPrivateLocked(true, 'cancelled', '2000-01-01T00:00:00Z')).toBe(true);
  });
});

describe('nextFreeBaselineTransition — reliable drop-to-free-baseline', () => {
  it('trialing/active drop to past_due', () => {
    expect(nextFreeBaselineTransition('trialing')).toBe('past_due');
    expect(nextFreeBaselineTransition('active')).toBe('past_due');
  });

  it('already-free-baseline statuses are a no-op (idempotent)', () => {
    expect(nextFreeBaselineTransition('past_due')).toBeNull();
    expect(nextFreeBaselineTransition('suspended')).toBeNull();
    expect(nextFreeBaselineTransition('cancelled')).toBeNull();
  });
});
