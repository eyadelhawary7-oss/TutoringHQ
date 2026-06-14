import { describe, it, expect, beforeEach } from 'vitest';

import {
  STANDARD_STUDENT_CAP,
  countActiveNonGuestStudents,
  requireTeacherUnderCap,
  selfEnrollWouldExceedCap,
} from '@/lib/teacherCap';

// Per-table result queues + a tiny chainable builder. Every filter returns the
// builder; awaiting (then) or maybeSingle resolves the next queued result for
// the table. eq calls are recorded so we can assert the guest filter is applied.
type Result = { data: unknown; error: { message: string } | null };

const queues: Record<string, Result[]> = {
  teacher_subscriptions: [],
  student_groups: [],
  enrollments: [],
};
const eqCalls: { table: string; col: string; val: unknown }[] = [];

function shift(table: string): Result {
  return queues[table]?.shift() ?? { data: null, error: null };
}

const admin = {
  from: (table: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        eqCalls.push({ table, col, val });
        return builder;
      },
      in: () => builder,
      maybeSingle: async () => shift(table),
      then: (f: (v: Result) => unknown, r?: (e: unknown) => unknown) =>
        Promise.resolve(shift(table)).then(f, r),
    };
    return builder;
  },
} as unknown as Parameters<typeof requireTeacherUnderCap>[0];

const TEACHER = 'user-1';

function enrollments(n: number, opts?: { phone?: string; from?: number }) {
  const start = opts?.from ?? 0;
  return Array.from({ length: n }, (_, i) => ({
    student_id: `s-${start + i}`,
    students: { is_guest: false, phone: opts?.phone ?? `0100000${start + i}`, center_id: null },
  }));
}

beforeEach(() => {
  for (const k of Object.keys(queues)) queues[k] = [];
  eqCalls.length = 0;
});

describe('countActiveNonGuestStudents', () => {
  it('counts distinct student_ids and filters guests out at the DB layer', async () => {
    queues.student_groups = [{ data: [{ id: 'g-1' }, { id: 'g-2' }], error: null }];
    queues.enrollments = [
      {
        // Same student in two groups appears twice -> counted once.
        data: [
          { student_id: 's-1' },
          { student_id: 's-1' },
          { student_id: 's-2' },
        ],
        error: null,
      },
    ];

    const count = await countActiveNonGuestStudents(admin, TEACHER);

    expect(count).toBe(2);
    // The guest exclusion is pushed to the query, mirroring the roster gate.
    expect(eqCalls).toContainEqual({ table: 'enrollments', col: 'students.is_guest', val: false });
    expect(eqCalls).toContainEqual({ table: 'student_groups', col: 'status', val: 'active' });
  });

  it('returns 0 when the teacher has no active groups (no enrollment query)', async () => {
    queues.student_groups = [{ data: [], error: null }];

    const count = await countActiveNonGuestStudents(admin, TEACHER);

    expect(count).toBe(0);
    expect(eqCalls.some((c) => c.table === 'enrollments')).toBe(false);
  });
});

describe('requireTeacherUnderCap', () => {
  it('Pro (teacher_699) is never capped, even at 75 students (no count query)', async () => {
    queues.teacher_subscriptions = [{ data: { plan_key: 'teacher_699' }, error: null }];

    const res = await requireTeacherUnderCap(admin, TEACHER, 'test');

    expect(res.ok).toBe(true);
    // Short-circuits before counting: student_groups is never read.
    expect(eqCalls.some((c) => c.table === 'student_groups')).toBe(false);
  });

  it('Standard at exactly 60 is NOT locked (at the line, not over it)', async () => {
    queues.teacher_subscriptions = [{ data: { plan_key: 'teacher_299' }, error: null }];
    queues.student_groups = [{ data: [{ id: 'g-1' }], error: null }];
    queues.enrollments = [{ data: enrollments(STANDARD_STUDENT_CAP), error: null }];

    const res = await requireTeacherUnderCap(admin, TEACHER, 'test');

    expect(res.ok).toBe(true);
  });

  it('Standard at 61 is locked -> 403 OVER_CAP_LOCKED', async () => {
    queues.teacher_subscriptions = [{ data: { plan_key: 'teacher_299' }, error: null }];
    queues.student_groups = [{ data: [{ id: 'g-1' }], error: null }];
    queues.enrollments = [{ data: enrollments(STANDARD_STUDENT_CAP + 1), error: null }];

    const res = await requireTeacherUnderCap(admin, TEACHER, 'test');

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.response.status).toBe(403);
      expect(((await res.response.json()) as { code: string }).code).toBe('OVER_CAP_LOCKED');
    }
  });

  it('Standard at 75 is locked -> 403 OVER_CAP_LOCKED', async () => {
    queues.teacher_subscriptions = [{ data: { plan_key: 'teacher_299' }, error: null }];
    queues.student_groups = [{ data: [{ id: 'g-1' }], error: null }];
    queues.enrollments = [{ data: enrollments(75), error: null }];

    const res = await requireTeacherUnderCap(admin, TEACHER, 'test');

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(403);
  });

  it('a DB error denies but as 500 CAP_CHECK_FAILED, never a false OVER_CAP_LOCKED', async () => {
    queues.teacher_subscriptions = [{ data: null, error: { message: 'db down' } }];

    const res = await requireTeacherUnderCap(admin, TEACHER, 'test');

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.response.status).toBe(500);
      expect(((await res.response.json()) as { code: string }).code).toBe('CAP_CHECK_FAILED');
    }
  });
});

describe('selfEnrollWouldExceedCap (loophole fix)', () => {
  it('Pro teacher is never blocked', async () => {
    queues.teacher_subscriptions = [{ data: { plan_key: 'teacher_699' }, error: null }];

    expect(await selfEnrollWouldExceedCap(admin, TEACHER, '01099999999')).toBe(false);
  });

  it('Standard under the cap (59) allows a brand-new head', async () => {
    queues.teacher_subscriptions = [{ data: { plan_key: 'teacher_299' }, error: null }];
    queues.student_groups = [{ data: [{ id: 'g-1' }], error: null }];
    queues.enrollments = [{ data: enrollments(59), error: null }];

    expect(await selfEnrollWouldExceedCap(admin, TEACHER, '01099999999')).toBe(false);
  });

  it('Standard at the cap (60) BLOCKS a brand-new head', async () => {
    queues.teacher_subscriptions = [{ data: { plan_key: 'teacher_299' }, error: null }];
    queues.student_groups = [{ data: [{ id: 'g-1' }], error: null }];
    queues.enrollments = [{ data: enrollments(60), error: null }];

    expect(await selfEnrollWouldExceedCap(admin, TEACHER, '01099999999')).toBe(true);
  });

  it('Standard at the cap (60) ALLOWS an already-enrolled student re-submitting', async () => {
    queues.teacher_subscriptions = [{ data: { plan_key: 'teacher_299' }, error: null }];
    queues.student_groups = [{ data: [{ id: 'g-1' }], error: null }];
    // 60 heads, one of which carries the re-submitting phone -> already counted.
    const rows = enrollments(60);
    (rows[0].students as { phone: string }).phone = '01055550000';
    queues.enrollments = [{ data: rows, error: null }];

    expect(await selfEnrollWouldExceedCap(admin, TEACHER, '01055550000')).toBe(false);
  });
});
