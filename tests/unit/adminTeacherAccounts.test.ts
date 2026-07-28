import { describe, it, expect } from 'vitest';
import { buildAdminTeacherRows } from '@/lib/adminTeacherAccounts';

/**
 * The admin solo-teacher account list.
 *
 * The named regression here is the first test: an account list driven by
 * `teacher_subscriptions` silently drops every teacher who never subscribed. On
 * the live catalog that was 2 of 3 accounts, and the screen would have looked
 * perfectly correct while showing a third of the customer base.
 */

const T1 = '11111111-1111-1111-1111-111111111111';
const T2 = '22222222-2222-2222-2222-222222222222';

describe('buildAdminTeacherRows', () => {
  it('includes a teacher who has no subscription row at all', () => {
    const rows = buildAdminTeacherRows({
      profiles: [
        { user_id: T1, display_name: 'Subscribed', is_test: false },
        { user_id: T2, display_name: 'Never subscribed', is_test: false },
      ],
      subs: [{ teacher_id: T1, plan_key: 'teacher_standard', status: 'active', price_gross: 499 }],
      users: [],
      groups: [],
      members: [],
    });

    expect(rows.map((r) => r.id).sort()).toEqual([T1, T2].sort());

    const unsubscribed = rows.find((r) => r.id === T2)!;
    // Not a subscriber is a state, not missing data: no tier, zero MRR (not
    // null, so callers can sum), and a status that says so.
    expect(unsubscribed.tier).toBeNull();
    expect(unsubscribed.monthlyMrr).toBe(0);
    expect(unsubscribed.status).toBe('inactive');
    expect(unsubscribed.nextChargeCairoDay).toBeNull();
  });

  it('counts a student in several of one teacher groups exactly once', () => {
    const rows = buildAdminTeacherRows({
      profiles: [{ user_id: T1, display_name: 'Busy', is_test: false }],
      subs: [],
      users: [],
      groups: [
        { id: 'g1', teacher_id: T1 },
        { id: 'g2', teacher_id: T1 },
        { id: 'g3', teacher_id: T1 },
      ],
      members: [
        { student_id: 's1', group_id: 'g1' },
        { student_id: 's1', group_id: 'g2' },
        { student_id: 's1', group_id: 'g3' },
        { student_id: 's2', group_id: 'g2' },
      ],
    });

    expect(rows[0].studentCount).toBe(2);
    expect(rows[0].groupCount).toBe(3);
  });

  it('never attributes another teacher students or groups', () => {
    const rows = buildAdminTeacherRows({
      profiles: [
        { user_id: T1, display_name: 'One', is_test: false },
        { user_id: T2, display_name: 'Two', is_test: false },
      ],
      subs: [],
      users: [],
      groups: [
        { id: 'g1', teacher_id: T1 },
        { id: 'g2', teacher_id: T2 },
        // A centre group with no teacher must belong to nobody.
        { id: 'g3', teacher_id: null },
      ],
      members: [
        { student_id: 's1', group_id: 'g1' },
        { student_id: 's2', group_id: 'g2' },
        { student_id: 's3', group_id: 'g2' },
        { student_id: 's4', group_id: 'g3' },
      ],
    });

    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(T1)!.studentCount).toBe(1);
    expect(byId.get(T2)!.studentCount).toBe(2);
    expect(byId.get(T1)!.groupCount).toBe(1);
    expect(byId.get(T2)!.groupCount).toBe(1);
  });

  it('maps subscription status onto the shared vocabulary the filter chips use', () => {
    const rows = buildAdminTeacherRows({
      profiles: [
        { user_id: T1, display_name: 'Trialling', is_test: false },
        { user_id: T2, display_name: 'Behind', is_test: false },
      ],
      subs: [
        { teacher_id: T1, plan_key: 'teacher_standard', status: 'trialing', price_gross: 499 },
        { teacher_id: T2, plan_key: 'teacher_pro', status: 'past_due', price_gross: 999 },
      ],
      users: [],
      groups: [],
      members: [],
    });

    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(T1)!.status).toBe('trial');
    expect(byId.get(T2)!.status).toBe('overdue');
  });

  it('prefers the profile display name and falls back to the user name', () => {
    const rows = buildAdminTeacherRows({
      profiles: [
        { user_id: T1, display_name: 'Profile name', is_test: false },
        { user_id: T2, display_name: null, is_test: false },
      ],
      subs: [],
      users: [
        { id: T1, name: 'User name', phone: '+201000000001' },
        { id: T2, name: 'User name only', phone: '+201000000002' },
      ],
      groups: [],
      members: [],
    });

    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(T1)!.name).toBe('Profile name');
    expect(byId.get(T2)!.name).toBe('User name only');
    expect(byId.get(T1)!.phone).toBe('+201000000001');
  });

  it('sorts test accounts last so a seeded row never heads the list', () => {
    const rows = buildAdminTeacherRows({
      profiles: [
        { user_id: T1, display_name: 'Test earner', is_test: true },
        { user_id: T2, display_name: 'Real, smaller', is_test: false },
      ],
      subs: [
        { teacher_id: T1, plan_key: 'teacher_scale', status: 'active', price_gross: 9999 },
        { teacher_id: T2, plan_key: 'teacher_standard', status: 'active', price_gross: 499 },
      ],
      users: [],
      groups: [],
      members: [],
    });

    expect(rows.map((r) => r.id)).toEqual([T2, T1]);
  });
});
