import { describe, it, expect, beforeEach } from 'vitest';

import { cairoYmdToJsWeekday } from '@/lib/cairo/week';
import {
  countScheduledSessionsInMonth,
  projectNextMonthIncome,
  computeRevenue,
  attendanceRatePerGroup,
  attendanceForStudent,
  attendanceByDayOfWeek,
  studentsNotSeen,
  paymentRisk,
  requireTeacherPro,
  buildTeacherAnalytics,
  type PaidLessonRow,
  type FinishedSessionRow,
  type ScanRow,
  type ArByStudentRow,
} from '@/lib/teacherAnalytics';

// Deterministic "now": Cairo 2026-06-15 (current month June, next month July).
const NOW = new Date('2026-06-15T09:00:00Z');

// ---------------------------------------------------------------------------
// #1 Projection — schedule expansion + exceptions
// ---------------------------------------------------------------------------

describe('countScheduledSessionsInMonth (#1 projection)', () => {
  // A date whose weekday we reuse as the recurring slot, so the slot is
  // guaranteed to land on it (no manual weekday arithmetic).
  const dow = cairoYmdToJsWeekday('2026-07-06');
  const slots = [{ group_id: 'g', day_of_week: dow }];

  it('expands a weekly slot across the month (≥4 weeks)', () => {
    const base = countScheduledSessionsInMonth(slots, [], 2026, 7);
    expect(base).toBeGreaterThanOrEqual(4);
  });

  it('subtracts a cancelled occurrence in the window', () => {
    const base = countScheduledSessionsInMonth(slots, [], 2026, 7);
    const withCancel = countScheduledSessionsInMonth(
      slots,
      [{ group_id: 'g', exception_date: '2026-07-06', kind: 'cancelled', new_date: null }],
      2026,
      7,
    );
    expect(withCancel).toBe(base - 1);
  });

  it('a reschedule OUT of the window is a net −1', () => {
    const base = countScheduledSessionsInMonth(slots, [], 2026, 7);
    const out = countScheduledSessionsInMonth(
      slots,
      [{ group_id: 'g', exception_date: '2026-07-06', kind: 'rescheduled', new_date: '2026-08-03' }],
      2026,
      7,
    );
    expect(out).toBe(base - 1);
  });

  it('a reschedule WITHIN the window is net unchanged (moved, not removed)', () => {
    const base = countScheduledSessionsInMonth(slots, [], 2026, 7);
    const within = countScheduledSessionsInMonth(
      slots,
      [{ group_id: 'g', exception_date: '2026-07-06', kind: 'rescheduled', new_date: '2026-07-08' }],
      2026,
      7,
    );
    expect(within).toBe(base);
  });

  it('no slots → zero sessions', () => {
    expect(countScheduledSessionsInMonth([], [], 2026, 7)).toBe(0);
  });
});

describe('projectNextMonthIncome (#1)', () => {
  it('estimate = enrolled × fee_per_class × scheduled sessions', () => {
    const res = projectNextMonthIncome([
      { groupId: 'g1', name: 'A', feePerClass: 100, enrolled: 5, scheduledSessions: 4 },
      { groupId: 'g2', name: 'B', feePerClass: 80, enrolled: 0, scheduledSessions: 4 },
    ]);
    expect(res.groups[0].estimate).toBe(2000);
    expect(res.groups[1].estimate).toBe(0);
    expect(res.total).toBe(2000);
  });
});

// ---------------------------------------------------------------------------
// #2 / #3 Revenue (amount_billed)
// ---------------------------------------------------------------------------

describe('computeRevenue (#2 best/worst, #3 by group + trend)', () => {
  const groups = [
    { id: 'g1', name: 'A' },
    { id: 'g2', name: 'B' },
  ];
  const paid: PaidLessonRow[] = [
    { group_id: 'g1', amount_billed: 100, paid_at: '2026-06-10T08:00:00Z' }, // June
    { group_id: 'g1', amount_billed: 50, paid_at: '2026-06-12T08:00:00Z' }, // June
    { group_id: 'g1', amount_billed: 200, paid_at: '2026-05-10T08:00:00Z' }, // May (trend only)
  ];

  it('sums amount_billed per group for the current Cairo month, zero-filling idle groups', () => {
    const r = computeRevenue(paid, groups, NOW);
    const byId = new Map(r.byGroupThisMonth.map((g) => [g.groupId, g.revenue]));
    expect(byId.get('g1')).toBe(150);
    expect(byId.get('g2')).toBe(0);
  });

  it('best is the top group; worst can be an idle EGP 0 group', () => {
    const r = computeRevenue(paid, groups, NOW);
    expect(r.best?.groupId).toBe('g1');
    expect(r.best?.revenue).toBe(150);
    expect(r.worst?.groupId).toBe('g2');
    expect(r.worst?.revenue).toBe(0);
  });

  it('trend buckets amount_billed by Cairo paid_at month (June=150, May=200)', () => {
    const r = computeRevenue(paid, groups, NOW);
    const june = r.trend.find((m) => m.year === 2026 && m.month === 6);
    const may = r.trend.find((m) => m.year === 2026 && m.month === 5);
    expect(june?.revenue).toBe(150);
    expect(may?.revenue).toBe(200);
    expect(r.trend).toHaveLength(6);
  });

  it('empty teacher → empty by-group, null best/worst, zero-filled trend', () => {
    const r = computeRevenue([], [], NOW);
    expect(r.byGroupThisMonth).toEqual([]);
    expect(r.best).toBeNull();
    expect(r.worst).toBeNull();
    expect(r.trend.every((m) => m.revenue === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// #4 / #5 Attendance
// ---------------------------------------------------------------------------

describe('attendanceRatePerGroup (#4)', () => {
  const groups = [{ id: 'g1', name: 'A' }];
  const finished: FinishedSessionRow[] = [
    { id: 's1', group_id: 'g1', scheduled_at: '2026-06-06T09:00:00Z' },
    { id: 's2', group_id: 'g1', scheduled_at: '2026-06-13T09:00:00Z' },
  ];
  const scans: ScanRow[] = [
    { session_id: 's1', student_id: 'a', scanned_at: '2026-06-06T10:00:00Z' },
    { session_id: 's1', student_id: 'b', scanned_at: '2026-06-06T10:00:00Z' },
    { session_id: 's2', student_id: 'a', scanned_at: '2026-06-13T10:00:00Z' },
  ];

  it('rate = Σ distinct attendees ÷ (enrolled × finished sessions)', () => {
    const res = attendanceRatePerGroup(groups, finished, scans, new Map([['g1', 2]]));
    // (2 + 1) / (2 × 2) = 0.75
    expect(res[0].rate).toBe(0.75);
    expect(res[0].finishedSessions).toBe(2);
    expect(res[0].enrolled).toBe(2);
  });

  it('rate is null when there is nothing to measure (no finished sessions or no enrolled)', () => {
    expect(attendanceRatePerGroup(groups, [], scans, new Map([['g1', 2]]))[0].rate).toBeNull();
    expect(attendanceRatePerGroup(groups, finished, scans, new Map([['g1', 0]]))[0].rate).toBeNull();
  });

  it('rate is capped at 1 (guest scans never push a group over 100%)', () => {
    const res = attendanceRatePerGroup(groups, finished, scans, new Map([['g1', 1]]));
    // (2 + 1) / (1 × 2) = 1.5 → capped to 1
    expect(res[0].rate).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// attendanceForStudent — Merged-Teacher-Students §02 Attendance block
// ---------------------------------------------------------------------------
describe('attendanceForStudent', () => {
  const enrollments = [{ group_id: 'g1', joined_at: '2026-06-01T00:00:00Z' }];
  const finished: FinishedSessionRow[] = [
    { id: 's1', group_id: 'g1', scheduled_at: '2026-06-06T09:00:00Z' },
    { id: 's2', group_id: 'g1', scheduled_at: '2026-06-13T09:00:00Z' },
    { id: 's3', group_id: 'g1', scheduled_at: '2026-06-20T09:00:00Z' },
  ];

  it('rate = present ÷ finished sessions since enrollment', () => {
    const scans: ScanRow[] = [
      { session_id: 's1', student_id: 'a', scanned_at: null },
      { session_id: 's3', student_id: 'a', scanned_at: null },
    ];
    const res = attendanceForStudent('a', enrollments, finished, scans);
    expect(res).toEqual({ finishedSessions: 3, present: 2, rate: 0.67 });
  });

  it('never counts a session held before the student joined', () => {
    const lateJoin = [{ group_id: 'g1', joined_at: '2026-06-15T00:00:00Z' }];
    // Only s3 (20 June) is on/after the join date; s1 and s2 are excluded
    // entirely - the student cannot be marked absent for a class before they
    // enrolled.
    const scans: ScanRow[] = [{ session_id: 's3', student_id: 'a', scanned_at: null }];
    const res = attendanceForStudent('a', lateJoin, finished, scans);
    expect(res).toEqual({ finishedSessions: 1, present: 1, rate: 1 });
  });

  it('ignores another student\'s scans and a different group\'s sessions', () => {
    const scans: ScanRow[] = [
      { session_id: 's1', student_id: 'b', scanned_at: null }, // someone else
    ];
    const otherGroupSession: FinishedSessionRow[] = [
      ...finished,
      { id: 's9', group_id: 'g-other', scheduled_at: '2026-06-10T09:00:00Z' },
    ];
    const res = attendanceForStudent('a', enrollments, otherGroupSession, scans);
    expect(res.finishedSessions).toBe(3); // g-other not counted - not this student's group
    expect(res.present).toBe(0);
  });

  it('rate is null — not 0 — when there is no finished session yet to measure', () => {
    expect(attendanceForStudent('a', enrollments, [], []).rate).toBeNull();
  });
});

describe('attendanceByDayOfWeek (#5)', () => {
  const finished: FinishedSessionRow[] = [
    { id: 's1', group_id: 'g1', scheduled_at: '2026-06-06T09:00:00Z' }, // Saturday
    { id: 's2', group_id: 'g1', scheduled_at: '2026-06-13T09:00:00Z' }, // Saturday
    { id: 's3', group_id: 'g1', scheduled_at: '2026-06-07T09:00:00Z' }, // Sunday
  ];
  const scans: ScanRow[] = [
    { session_id: 's1', student_id: 'a', scanned_at: '2026-06-06T10:00:00Z' },
    { session_id: 's1', student_id: 'b', scanned_at: '2026-06-06T10:00:00Z' },
    { session_id: 's2', student_id: 'a', scanned_at: '2026-06-13T10:00:00Z' },
    { session_id: 's3', student_id: 'a', scanned_at: '2026-06-07T10:00:00Z' },
    { session_id: 's3', student_id: 'b', scanned_at: '2026-06-07T10:00:00Z' },
    { session_id: 's3', student_id: 'c', scanned_at: '2026-06-07T10:00:00Z' },
  ];

  it('buckets average attendance by Cairo weekday and picks highest/lowest', () => {
    const res = attendanceByDayOfWeek(finished, scans);
    expect(res.days).toHaveLength(2);
    // Saturday: (2 + 1) / 2 = 1.5 ; Sunday: 3 / 1 = 3
    expect(res.highest?.avgAttendance).toBe(3);
    expect(res.lowest?.avgAttendance).toBe(1.5);
    expect(res.highest?.jsWeekday).toBe(cairoYmdToJsWeekday('2026-06-07'));
    expect(res.lowest?.jsWeekday).toBe(cairoYmdToJsWeekday('2026-06-06'));
  });

  it('no finished sessions → empty', () => {
    const res = attendanceByDayOfWeek([], []);
    expect(res.days).toEqual([]);
    expect(res.highest).toBeNull();
    expect(res.lowest).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// #6 Students not seen 3+ weeks
// ---------------------------------------------------------------------------

describe('studentsNotSeen (#6)', () => {
  const roster = [
    { studentId: 'a', name: 'A' },
    { studentId: 'b', name: 'B' },
    { studentId: 'c', name: 'C' },
  ];

  it('flags >21 days and never-seen, sorted longest-unseen first', () => {
    const lastScan = new Map<string, string>([
      ['a', '2026-06-14T10:00:00Z'], // 1 day ago → not flagged
      ['b', '2026-05-01T10:00:00Z'], // 45 days ago → flagged
      // c never recorded → flagged, floats to the top
    ]);
    const res = studentsNotSeen(roster, lastScan, NOW);
    expect(res).toHaveLength(2);
    expect(res[0].studentId).toBe('c');
    expect(res[0].daysSince).toBeNull();
    expect(res[1].studentId).toBe('b');
    expect(res[1].daysSince).toBeGreaterThan(21);
  });

  it('everyone seen recently → empty', () => {
    const lastScan = new Map<string, string>([
      ['a', '2026-06-14T10:00:00Z'],
      ['b', '2026-06-10T10:00:00Z'],
      ['c', '2026-06-01T10:00:00Z'],
    ]);
    expect(studentsNotSeen(roster, lastScan, NOW)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// #7 Payment risk (ar_by_student)
// ---------------------------------------------------------------------------

describe('paymentRisk (#7)', () => {
  it('keeps outstanding>0 students, sorted by outstanding desc, names resolved', () => {
    const rows: ArByStudentRow[] = [
      { student_id: 'a', outstanding_amount: 300, unpaid_amount: 300, unpaid_count: 3 },
      { student_id: 'b', outstanding_amount: 0, unpaid_amount: 0, unpaid_count: 0 },
      { student_id: 'c', outstanding_amount: 100, unpaid_amount: 100, unpaid_count: 1 },
    ];
    const names = new Map<string, string | null>([
      ['a', 'Ahmed'],
      ['c', 'Carmen'],
    ]);
    const res = paymentRisk(rows, names);
    expect(res).toHaveLength(2);
    expect(res[0]).toEqual({ studentId: 'a', name: 'Ahmed', outstanding: 300, unpaidCount: 3 });
    expect(res[1].studentId).toBe('c');
  });
});

// ---------------------------------------------------------------------------
// Pro gate + orchestrator — chainable Supabase mock
// ---------------------------------------------------------------------------

type Result = { data: unknown; error: { message: string } | null };

function makeAdmin(queues: Record<string, Result[]>, selectCalls: { table: string; cols: string }[]) {
  const shift = (table: string): Result => queues[table]?.shift() ?? { data: null, error: null };
  return {
    from: (table: string) => {
      const builder: Record<string, unknown> = {
        select: (cols: string) => {
          selectCalls.push({ table, cols });
          return builder;
        },
        eq: () => builder,
        in: () => builder,
        gte: () => builder,
        lt: () => builder,
        order: () => builder,
        range: () => builder,
        maybeSingle: async () => shift(table),
        then: (f: (v: Result) => unknown, r?: (e: unknown) => unknown) =>
          Promise.resolve(shift(table)).then(f, r),
      };
      return builder;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('requireTeacherPro (gate)', () => {
  let selectCalls: { table: string; cols: string }[];
  beforeEach(() => {
    selectCalls = [];
  });

  it('Pro (teacher_pro) passes', async () => {
    const admin = makeAdmin({ teacher_subscriptions: [{ data: { plan_key: 'teacher_pro' }, error: null }] }, selectCalls);
    expect((await requireTeacherPro(admin, 'u1', 'test')).ok).toBe(true);
  });

  it('Standard (teacher_standard) → 403 ANALYTICS_PRO_ONLY', async () => {
    const admin = makeAdmin({ teacher_subscriptions: [{ data: { plan_key: 'teacher_standard' }, error: null }] }, selectCalls);
    const res = await requireTeacherPro(admin, 'u1', 'test');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.response.status).toBe(403);
      expect(((await res.response.json()) as { error: string }).error).toBe('ANALYTICS_PRO_ONLY');
    }
  });

  it('no subscription row → defaults to Standard → 403', async () => {
    const admin = makeAdmin({ teacher_subscriptions: [{ data: null, error: null }] }, selectCalls);
    const res = await requireTeacherPro(admin, 'u1', 'test');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(403);
  });

  it('DB error → 500 (an error is not a state)', async () => {
    const admin = makeAdmin({ teacher_subscriptions: [{ data: null, error: { message: 'down' } }] }, selectCalls);
    const res = await requireTeacherPro(admin, 'u1', 'test');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(500);
  });
});

describe('buildTeacherAnalytics (orchestrator)', () => {
  let selectCalls: { table: string; cols: string }[];
  beforeEach(() => {
    selectCalls = [];
  });

  it('empty teacher (no active groups) → all empty states, still reads ar_by_student', async () => {
    const admin = makeAdmin(
      {
        student_groups: [{ data: [], error: null }],
        ar_by_student: [{ data: [], error: null }],
      },
      selectCalls,
    );
    const res = await buildTeacherAnalytics(admin, 'u1', NOW);
    expect(res.hasAnyActivity).toBe(false);
    expect(res.projection.groups).toEqual([]);
    expect(res.attendanceByGroup).toEqual([]);
    expect(res.notSeen).toEqual([]);
    expect(res.paymentRisk).toEqual([]);
    // Revenue uses amount_billed + groups use fee_per_class + risk reads ar_by_student.
    expect(selectCalls.find((c) => c.table === 'student_groups')?.cols).toContain('fee_per_class');
    expect(selectCalls.some((c) => c.table === 'ar_by_student')).toBe(true);
  });

  it('seeded fixture: revenue=amount_billed, fee=fee_per_class, projection subtracts a cancelled exception', async () => {
    const dow = cairoYmdToJsWeekday('2026-07-06');
    const admin = makeAdmin(
      {
        student_groups: [{ data: [{ id: 'g1', name: 'A', fee_per_class: 100 }], error: null }],
        enrollments: [
          {
            data: [
              { group_id: 'g1', student_id: 'a', students: { id: 'a', name: 'Ahmed', is_guest: false } },
            ],
            error: null,
          },
        ],
        group_schedule: [{ data: [{ group_id: 'g1', day_of_week: dow }], error: null }],
        schedule_exceptions: [
          {
            data: [{ group_id: 'g1', exception_date: '2026-07-06', kind: 'cancelled', new_date: null }],
            error: null,
          },
        ],
        transactions: [
          { data: [{ group_id: 'g1', amount_billed: 150, paid_at: '2026-06-10T08:00:00Z' }], error: null },
        ],
        sessions: [
          {
            data: [{ id: 's1', group_id: 'g1', scheduled_at: '2026-06-06T09:00:00Z', status: 'finished' }],
            error: null,
          },
        ],
        attendance_scans: [
          { data: [{ session_id: 's1', student_id: 'a', scanned_at: '2026-06-06T10:00:00Z' }], error: null },
        ],
        ar_by_student: [
          { data: [{ student_id: 'a', outstanding_amount: 200, unpaid_amount: 200, unpaid_count: 2 }], error: null },
        ],
      },
      selectCalls,
    );

    const res = await buildTeacherAnalytics(admin, 'u1', NOW);

    const expectedSessions = countScheduledSessionsInMonth(
      [{ group_id: 'g1', day_of_week: dow }],
      [{ group_id: 'g1', exception_date: '2026-07-06', kind: 'cancelled', new_date: null }],
      2026,
      7,
    );
    expect(res.projection.month).toBe(7);
    expect(res.projection.groups[0].scheduledSessions).toBe(expectedSessions);
    expect(res.projection.total).toBe(100 * expectedSessions);

    // Revenue is amount_billed, current Cairo month.
    expect(res.revenue.byGroupThisMonth.find((g) => g.groupId === 'g1')?.revenue).toBe(150);
    expect(res.revenue.best?.revenue).toBe(150);

    // Attendance: 1 attendee / (1 enrolled × 1 finished) = 1.
    expect(res.attendanceByGroup[0].rate).toBe(1);
    expect(res.attendanceByDayOfWeek.highest?.avgAttendance).toBe(1);

    // Seen 9 days ago → not flagged.
    expect(res.notSeen).toEqual([]);

    // Payment risk from ar_by_student, name resolved from the roster.
    expect(res.paymentRisk).toEqual([
      { studentId: 'a', name: 'Ahmed', outstanding: 200, unpaidCount: 2 },
    ]);
    expect(res.hasAnyActivity).toBe(true);

    expect(selectCalls.find((c) => c.table === 'transactions')?.cols).toContain('amount_billed');
  });
});
