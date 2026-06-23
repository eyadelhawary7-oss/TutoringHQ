import { describe, it, expect } from 'vitest';
import {
  resolveTeacherPrivateView,
  isTeacherPrivateLocked,
} from '@/lib/teacherPrivateView';

describe('resolveTeacherPrivateView — teacher private-engine lock', () => {
  it('a locked (lapsed) teacher sees the lock summary, NOT the records', () => {
    const view = resolveTeacherPrivateView({ hasPrivateAccess: false, state: 'lapsed' });
    expect(view).toBe('lock_summary');
    expect(isTeacherPrivateLocked({ hasPrivateAccess: false, state: 'lapsed' })).toBe(true);
  });

  it('an active teacher sees the records (full private access)', () => {
    expect(resolveTeacherPrivateView({ hasPrivateAccess: true, state: 'unified' })).toBe('records');
    expect(isTeacherPrivateLocked({ hasPrivateAccess: true, state: 'unified' })).toBe(false);
  });

  it('a never-subscribed (free-zone) teacher keeps the upsell, never the lock summary', () => {
    const view = resolveTeacherPrivateView({ hasPrivateAccess: false, state: 'center_only' });
    expect(view).toBe('upsell');
    // Free zone is unaffected: a center-only teacher is never locked.
    expect(isTeacherPrivateLocked({ hasPrivateAccess: false, state: 'center_only' })).toBe(false);
  });

  it('hasPrivateAccess always wins (records) regardless of state', () => {
    expect(resolveTeacherPrivateView({ hasPrivateAccess: true, state: 'lapsed' })).toBe('records');
    expect(resolveTeacherPrivateView({ hasPrivateAccess: true, state: 'center_only' })).toBe('records');
  });
});
