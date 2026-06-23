import { describe, it, expect } from 'vitest';
import {
  resolveTeacherPrivateView,
  isTeacherPrivateGated,
} from '@/lib/teacherPrivateView';

describe('resolveTeacherPrivateView — lapsed teacher drops to the free tier', () => {
  it('a lapsed teacher resolves to the free tier (private gated), NOT the records', () => {
    const view = resolveTeacherPrivateView({ hasPrivateAccess: false, state: 'lapsed' });
    expect(view).toBe('resubscribe');
    // Private engine is gated → free tier (no records, no summary screen).
    expect(isTeacherPrivateGated(view)).toBe(true);
    expect(view).not.toBe('records');
  });

  it('a lapsed teacher is gated the SAME as a never-subscribed teacher (full drop to free tier)', () => {
    const lapsed = resolveTeacherPrivateView({ hasPrivateAccess: false, state: 'lapsed' });
    const centerOnly = resolveTeacherPrivateView({ hasPrivateAccess: false, state: 'center_only' });
    // Both are gated to the free tier; only the message differs (resubscribe vs upsell).
    expect(isTeacherPrivateGated(lapsed)).toBe(true);
    expect(isTeacherPrivateGated(centerOnly)).toBe(true);
  });

  it('a never-subscribed teacher keeps the trial upsell, unchanged', () => {
    expect(resolveTeacherPrivateView({ hasPrivateAccess: false, state: 'center_only' })).toBe('upsell');
  });

  it('an active teacher sees the records (full private access)', () => {
    expect(resolveTeacherPrivateView({ hasPrivateAccess: true, state: 'unified' })).toBe('records');
    expect(isTeacherPrivateGated('records')).toBe(false);
  });

  it('resubscribing restores access: the gate flips false→true, same data behind it', () => {
    const before = resolveTeacherPrivateView({ hasPrivateAccess: false, state: 'lapsed' });
    const after = resolveTeacherPrivateView({ hasPrivateAccess: true, state: 'lapsed' });
    // Lapse only gates access; the helper never depends on / mutates the data.
    // Once teacher_private_access passes again, the records return.
    expect(before).toBe('resubscribe'); // gated while unpaid (data preserved, just hidden)
    expect(after).toBe('records'); // paid again → full access restored
  });

  it('there is no summary-screen / lock view for teachers (removed)', () => {
    const views = [
      resolveTeacherPrivateView({ hasPrivateAccess: false, state: 'lapsed' }),
      resolveTeacherPrivateView({ hasPrivateAccess: false, state: 'center_only' }),
      resolveTeacherPrivateView({ hasPrivateAccess: true, state: 'unified' }),
    ];
    expect(views).not.toContain('lock_summary');
  });
});
