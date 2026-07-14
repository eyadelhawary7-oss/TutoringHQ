import { describe, it, expect } from 'vitest';
import {
  computeBalance,
  getStudentBalances,
  sumOutstanding,
  PAID_PAYMENT_STATUSES,
  type StudentBalance,
} from '@/lib/studentBalance';

/**
 * A faithful minimal Supabase stub: `from(table).select(...)` returns a
 * chainable, awaitable builder resolving to the preset rows for that table.
 * It honours `.in('status', ...)` (so the payments allow-list is exercised the
 * same way it runs against PostgREST); the in-JS absent-exclusion and the
 * group-fee lookup are the helper's own logic and run unchanged.
 */
function makeClient(data: {
  students?: { id: string; fee: number | null; is_active?: boolean | null }[];
  attendance_scans?: { student_id: string; status: string | null; group_id: string | null }[];
  student_groups?: { id: string; fee: number | null }[];
  payments?: { student_id: string; amount: number | null; status: string }[];
}) {
  return {
    from(table: string) {
      let statusFilter: readonly unknown[] | null = null;
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: (col: string, vals: readonly unknown[]) => {
          if (col === 'status') statusFilter = vals;
          return builder;
        },
        then: (resolve: (v: { data: unknown; error: null }) => unknown) => {
          let rows = (data as Record<string, { status?: string }[]>)[table] ?? [];
          if (statusFilter) rows = rows.filter((r) => statusFilter!.includes(r.status));
          return resolve({ data: rows, error: null });
        },
      };
      return builder;
    },
  } as unknown as Parameters<typeof getStudentBalances>[0];
}

const S = 'stu-1';
const G = 'grp-1'; // group fee 100
const balanceOf = (m: Map<string, StudentBalance>) => m.get(S)?.balance;
const groups = [{ id: G, fee: 100 }];
const present = (group: string | null = G) => ({ student_id: S, status: 'present', group_id: group });

describe('computeBalance (pure formula: charge − paid)', () => {
  it('zero → 0', () => expect(computeBalance(0, 0)).toBe(0));
  it('unpaid → charge', () => expect(computeBalance(300, 0)).toBe(300));
  it('partial → charge − paid', () => expect(computeBalance(300, 100)).toBe(200));
  it('overpayment → negative (credit), not floored', () => expect(computeBalance(100, 250)).toBe(-150));
  it('rounds money to 2dp', () => expect(computeBalance(99.999, 0)).toBe(100));
});

describe('getStudentBalances (set-based, group-fee model)', () => {
  it('CASE 1 — zero sessions: no scans, no payments → balance 0', async () => {
    const m = await getStudentBalances(
      makeClient({ students: [{ id: S, fee: null }], attendance_scans: [], student_groups: groups, payments: [] }),
      { centerId: 'c1' },
    );
    expect(m.get(S)).toMatchObject({ charge: 0, paid: 0, balance: 0 });
  });

  it('CASE 2 — unpaid sessions: 3 attended @ group fee 100, nothing paid → 300 owed', async () => {
    const m = await getStudentBalances(
      makeClient({
        students: [{ id: S, fee: null }],
        attendance_scans: [present(), present(), { ...present(), status: null }], // legacy NULL counts
        student_groups: groups,
        payments: [],
      }),
      { centerId: 'c1' },
    );
    expect(m.get(S)).toMatchObject({ charge: 300, paid: 0, balance: 300 });
  });

  it('CASE 3 — partial payment: 3 attended (300) − 100 paid → 200 owed', async () => {
    const m = await getStudentBalances(
      makeClient({
        students: [{ id: S, fee: null }],
        attendance_scans: [present(), present(), present()],
        student_groups: groups,
        payments: [{ student_id: S, amount: 100, status: 'confirmed' }],
      }),
      { centerId: 'c1' },
    );
    expect(balanceOf(m)).toBe(200);
  });

  it('CASE 4 — overpayment shows a CREDIT: 1 attended (100) − 250 paid → −150', async () => {
    const m = await getStudentBalances(
      makeClient({
        students: [{ id: S, fee: null }],
        attendance_scans: [present()],
        student_groups: groups,
        // confirmed + pending both count (pending is logged money)
        payments: [
          { student_id: S, amount: 150, status: 'confirmed' },
          { student_id: S, amount: 100, status: 'pending' },
        ],
      }),
      { centerId: 'c1' },
    );
    expect(balanceOf(m)).toBe(-150);
  });

  it('CASE 5 — absent excluded (and late-fee row excluded): 3 scans, 1 absent → 2 charged', async () => {
    const m = await getStudentBalances(
      makeClient({
        students: [{ id: S, fee: null }],
        attendance_scans: [present(), { ...present(), status: 'absent' }, present()],
        student_groups: groups,
        // a 'late'-fee assessment row must NOT be treated as a payment/credit
        payments: [{ student_id: S, amount: 50, status: 'late' }],
      }),
      { centerId: 'c1' },
    );
    expect(m.get(S)).toMatchObject({ charge: 200, paid: 0, balance: 200 });
  });

  it('per-session group fee: sessions across two groups charge each group’s fee', async () => {
    const m = await getStudentBalances(
      makeClient({
        students: [{ id: S, fee: null }],
        attendance_scans: [present(G), present('grp-2')],
        student_groups: [
          { id: G, fee: 100 },
          { id: 'grp-2', fee: 150 },
        ],
        payments: [],
      }),
      { centerId: 'c1' },
    );
    expect(m.get(S)).toMatchObject({ charge: 250, balance: 250 });
  });

  it('activeOnly excludes soft-deactivated students', async () => {
    const m = await getStudentBalances(
      makeClient({
        students: [
          { id: S, fee: null, is_active: true },
          { id: 'gone', fee: null, is_active: false },
        ],
        attendance_scans: [present(), { student_id: 'gone', status: 'present', group_id: G }],
        student_groups: groups,
        payments: [],
      }),
      { centerId: 'c1', activeOnly: true },
    );
    expect(m.has('gone')).toBe(false);
    expect(m.get(S)?.balance).toBe(100);
  });

  it('empty scope (no centerId, no ids) → empty map, no table scan', async () => {
    const m = await getStudentBalances(makeClient({}), {});
    expect(m.size).toBe(0);
  });
});

describe('sumOutstanding — credits are not netted against debt', () => {
  it('sums only positive balances', () => {
    const rows: StudentBalance[] = [
      { studentId: 'a', charge: 300, paid: 100, balance: 200 },
      { studentId: 'b', charge: 100, paid: 250, balance: -150 }, // credit, ignored
      { studentId: 'c', charge: 0, paid: 0, balance: 0 },
    ];
    expect(sumOutstanding(rows)).toBe(200);
  });
});

describe('PAID_PAYMENT_STATUSES', () => {
  it('counts confirmed + pending + paid, excludes late/void', () => {
    expect([...PAID_PAYMENT_STATUSES]).toEqual(['confirmed', 'pending', 'paid']);
    expect((PAID_PAYMENT_STATUSES as readonly string[]).includes('late')).toBe(false);
  });
});
