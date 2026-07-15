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
 * same way it runs against PostgREST); the in-JS absent/teacher-private
 * exclusion and the charged_fee sum are the helper's own logic and run
 * unchanged.
 *
 * NOTE: the helper no longer queries `student_groups` at all — the per-session
 * charge is the SNAPSHOTTED `attendance_scans.charged_fee`, written by the
 * scanner/checklist at scan time. So fixtures put the price on each scan, and
 * there is deliberately no group-price lookup to mock.
 */
function makeClient(data: {
  students?: { id: string; is_active?: boolean | null }[];
  attendance_scans?: {
    student_id: string;
    status: string | null;
    charged_fee?: number | null;
    billable?: boolean | null;
    group_id?: string | null;
  }[];
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
const balanceOf = (m: Map<string, StudentBalance>) => m.get(S)?.balance;
/** An attended, chargeable center scan carrying its snapshotted price. */
const present = (charged_fee = 100, group_id: string | null = 'grp-1') => ({
  student_id: S,
  status: 'present',
  charged_fee,
  group_id,
});

describe('computeBalance (pure formula: charge − paid)', () => {
  it('zero → 0', () => expect(computeBalance(0, 0)).toBe(0));
  it('unpaid → charge', () => expect(computeBalance(300, 0)).toBe(300));
  it('partial → charge − paid', () => expect(computeBalance(300, 100)).toBe(200));
  it('overpayment → negative (credit), not floored', () => expect(computeBalance(100, 250)).toBe(-150));
  it('rounds money to 2dp', () => expect(computeBalance(99.999, 0)).toBe(100));
});

describe('getStudentBalances (set-based, snapshotted charged_fee model)', () => {
  it('CASE 1 — zero sessions: no scans, no payments → balance 0', async () => {
    const m = await getStudentBalances(
      makeClient({ students: [{ id: S }], attendance_scans: [], payments: [] }),
      { centerId: 'c1' },
    );
    expect(m.get(S)).toMatchObject({ charge: 0, paid: 0, balance: 0 });
  });

  it('CASE 2 — unpaid sessions: 3 attended @ snapshot 100, nothing paid → 300 owed', async () => {
    const m = await getStudentBalances(
      makeClient({
        students: [{ id: S }],
        attendance_scans: [present(), present(), { ...present(), status: null }], // legacy NULL status counts
        payments: [],
      }),
      { centerId: 'c1' },
    );
    expect(m.get(S)).toMatchObject({ charge: 300, paid: 0, balance: 300 });
  });

  it('CASE 3 — partial payment: 3 attended (300) − 100 paid → 200 owed', async () => {
    const m = await getStudentBalances(
      makeClient({
        students: [{ id: S }],
        attendance_scans: [present(), present(), present()],
        payments: [{ student_id: S, amount: 100, status: 'confirmed' }],
      }),
      { centerId: 'c1' },
    );
    expect(balanceOf(m)).toBe(200);
  });

  it('CASE 4 — overpayment shows a CREDIT: 1 attended (100) − 250 paid → −150', async () => {
    const m = await getStudentBalances(
      makeClient({
        students: [{ id: S }],
        attendance_scans: [present()],
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
        students: [{ id: S }],
        attendance_scans: [present(), { ...present(), status: 'absent' }, present()],
        // a 'late'-fee assessment row must NOT be treated as a payment/credit
        payments: [{ student_id: S, amount: 50, status: 'late' }],
      }),
      { centerId: 'c1' },
    );
    expect(m.get(S)).toMatchObject({ charge: 200, paid: 0, balance: 200 });
  });

  it('per-session snapshot: sessions with different snapshotted prices sum each price', async () => {
    const m = await getStudentBalances(
      makeClient({
        students: [{ id: S }],
        attendance_scans: [present(100, 'grp-1'), present(150, 'grp-2')],
        payments: [],
      }),
      { centerId: 'c1' },
    );
    expect(m.get(S)).toMatchObject({ charge: 250, balance: 250 });
  });

  it('a fee-exempt / free admission (charged_fee 0) contributes nothing', async () => {
    const m = await getStudentBalances(
      makeClient({
        students: [{ id: S }],
        attendance_scans: [present(100), { ...present(0), payment_status_at_scan: 'admitted' } as never],
        payments: [],
      }),
      { centerId: 'c1' },
    );
    expect(m.get(S)).toMatchObject({ charge: 100, balance: 100 });
  });

  it('a NULL charged_fee (unresolved / unpriced) contributes nothing, never NaN', async () => {
    const m = await getStudentBalances(
      makeClient({
        students: [{ id: S }],
        attendance_scans: [present(100), { student_id: S, status: 'present', charged_fee: null }],
        payments: [],
      }),
      { centerId: 'c1' },
    );
    expect(m.get(S)).toMatchObject({ charge: 100, balance: 100 });
  });

  it('activeOnly excludes soft-deactivated students', async () => {
    const m = await getStudentBalances(
      makeClient({
        students: [
          { id: S, is_active: true },
          { id: 'gone', is_active: false },
        ],
        attendance_scans: [present(), { student_id: 'gone', status: 'present', charged_fee: 100 }],
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

describe('getStudentBalances — non-chargeable scans excluded from the center charge', () => {
  it('teacher-private attendance (billable=true) is NOT charged to the center balance', async () => {
    const m = await getStudentBalances(
      makeClient({
        students: [{ id: S }],
        attendance_scans: [
          present(100), // center group, chargeable
          { student_id: S, status: 'present', group_id: 'priv-1', billable: true, charged_fee: 700 },
        ],
        payments: [],
      }),
      { centerId: 'c1' },
    );
    // Only the center session (100) is charged; the private 700 is the teacher engine's.
    expect(m.get(S)).toMatchObject({ charge: 100, balance: 100 });
  });
});

describe('snapshot makes history non-destructive to group price edits / deletion', () => {
  it('PRICE EDIT — editing the group price does NOT move an already-recorded charge', async () => {
    // The scan was recorded at charged_fee 100. The group's LIVE fee_per_class is
    // now 999 — but the helper never reads the group, it sums the snapshot. So the
    // recorded charge stays 100 regardless of the new price.
    const m = await getStudentBalances(
      makeClient({
        students: [{ id: S }],
        attendance_scans: [present(100, 'grp-1')], // snapshot frozen at 100
        payments: [],
      }),
      { centerId: 'c1' },
    );
    expect(m.get(S)).toMatchObject({ charge: 100, balance: 100 });
  });

  it('GROUP DELETE — the debt survives after the group is deleted (group_id → NULL)', async () => {
    // attendance_scans.group_id_fkey is ON DELETE SET NULL, so deleting the group
    // nulls the scan's group_id. Under the old live-price join that zeroed the
    // debt; with the snapshot the charged_fee is intact, so the debt survives.
    const m = await getStudentBalances(
      makeClient({
        students: [{ id: S }],
        attendance_scans: [{ student_id: S, status: 'present', group_id: null, charged_fee: 100 }],
        payments: [],
      }),
      { centerId: 'c1' },
    );
    expect(m.get(S)).toMatchObject({ charge: 100, balance: 100 });
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
