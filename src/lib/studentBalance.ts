/**
 * Student balance — the SINGLE source of truth for "what a student owes".
 *
 * DEFINITION (see PR / docs): a student's balance is
 *
 *     balance = (Σ per attended session of that session's group fee) − (logged payments)
 *
 * where
 *   • chargeable session = an attendance_scans row for the student that is
 *                        attended (`status` != 'absent'), NOT a fee-exempt
 *                        admission (`payment_status_at_scan` != 'admitted'), NOT
 *                        explicitly waived (`billable` is not false), and whose
 *                        group is a CENTER group (`kind='center'`). Teacher-private
 *                        (kind='private', billable=true) attendance is billed by
 *                        the teacher-private engine and is NOT counted here.
 *   • session fee      = student_groups.fee_per_class — the authoritative single
 *                        per-group price. (NOT student_groups.fee, which is dead
 *                        leftover: only mirrored from fee_per_class on dashboard
 *                        create and 0 for groups made any other way — reading it
 *                        undercharges to 0.) students.fee is a NULL-in-practice
 *                        fallback for a group-less scan; unresolved fee → 0.
 *   • logged payments  = SUM(payments.amount) for the student whose `status` is a
 *                        real collection state (see PAID_PAYMENT_STATUSES). Both
 *                        'confirmed' (cash / verified) and 'pending' (logged
 *                        digital, not yet reconciled) count — nothing auto-confirms
 *                        pending, so gating on 'confirmed' would overstate debt
 *                        forever. The 'late'-fee assessment rows and any
 *                        void/refund states are intentionally excluded.
 *
 * A positive balance is money owed; a NEGATIVE balance is a CREDIT (overpayment).
 * We never floor at zero — screens render the credit.
 *
 * There is deliberately NO stored `students.balance_due` column (it never
 * existed — selecting it made PostgREST 400 the whole query). Every screen must
 * compute through this helper so the number can never disagree between screens.
 *
 * The helper is ISOMORPHIC: pass the server admin client (server routes / crons)
 * or the browser client (client components, RLS-scoped) — same math either way.
 * It is SET-BASED: a fixed number of bulk queries regardless of how many students
 * a screen lists, so listing many students never becomes N+1.
 */

/** Payment statuses that count as money collected against the balance. */
export const PAID_PAYMENT_STATUSES = ['confirmed', 'pending', 'paid'] as const;

/** Attendance-scan status that is NOT chargeable (student was marked absent). */
export const NON_CHARGEABLE_SCAN_STATUS = 'absent';

/** payment_status_at_scan meaning a fee-exempt admission (attended, do not charge). */
export const EXEMPT_SCAN_STATUS = 'admitted';

export type StudentBalance = {
  studentId: string;
  /** Σ per attended session of its group fee */
  charge: number;
  /** SUM of logged payments */
  paid: number;
  /** charge − paid; negative = credit (overpayment) */
  balance: number;
};

/** Round to 2 decimal places (money). */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * The pure balance formula — the ONE place the arithmetic lives, so it can be
 * unit-tested without a database and can never drift from what screens show.
 * `charge` is the already-summed session fees; `paid` the summed payments.
 */
export function computeBalance(charge: number, paid: number): number {
  return round2((Number(charge) || 0) - (Number(paid) || 0));
}

type BalanceQuery = {
  /** Restrict to one center (preferred for "list many students" screens). */
  centerId?: string;
  /** Restrict to specific students (RLS still applies). */
  studentIds?: string[];
  /** Exclude soft-deactivated students (is_active === false). NULL is kept. */
  activeOnly?: boolean;
};

// Accept any Supabase client (server admin OR browser) — structural, so it
// matches whatever schema generics a given client carries. We only use `.from`.
type AnySupabase = { from: (table: string) => { select: (columns: string) => unknown } };

// Each PostgREST builder is chainable (returns itself) and awaitable.
type Builder = {
  eq: (col: string, val: unknown) => Builder;
  in: (col: string, vals: readonly unknown[]) => Builder;
  then: (r: (v: { data: unknown }) => unknown) => unknown;
};
type Db = { from: (t: string) => { select: (c: string) => unknown } };

/**
 * Compute balances for a set of students. Set-based: students, attendance
 * scans, the referenced groups' fees, and payments are each fetched in one bulk
 * query, then folded in memory. Returns a Map keyed by student id; students with
 * no scans/payments still appear (balance 0).
 *
 * Provide `centerId` and/or `studentIds`. Passing neither returns an empty map
 * (we never scan the whole table unscoped).
 */
export async function getStudentBalances(
  supabase: AnySupabase,
  query: BalanceQuery,
): Promise<Map<string, StudentBalance>> {
  const { centerId, studentIds, activeOnly } = query;
  const out = new Map<string, StudentBalance>();
  if (!centerId && (!studentIds || studentIds.length === 0)) return out;

  const db = supabase as unknown as Db;
  const build = (table: string, cols: string): Builder =>
    db.from(table).select(cols) as unknown as Builder;

  // 1) Students — the row set. (No per-student fee: students.fee is 0.00/unused;
  //    the charge is the scan's CENTER-group fee_per_class, below.)
  let sQ = build('students', 'id, is_active');
  if (centerId) sQ = sQ.eq('center_id', centerId);
  if (studentIds && studentIds.length > 0) sQ = sQ.in('id', studentIds);
  const studentRows = (((await sQ) as { data?: unknown }).data ?? []) as {
    id: string;
    is_active?: boolean | null;
  }[];

  for (const s of studentRows) {
    if (activeOnly && s.is_active === false) continue; // keep true + legacy NULL
    out.set(s.id, { studentId: s.id, charge: 0, paid: 0, balance: 0 });
  }
  if (out.size === 0) return out;
  const ids = Array.from(out.keys());

  // 2) Attendance scans. The charge is the SNAPSHOTTED per-session price
  //    (attendance_scans.charged_fee), written by the scanner/checklist at scan
  //    time — NOT re-derived from the live group price — so editing a group's
  //    price or deleting the group does NOT rewrite recorded history. A scan
  //    contributes its charged_fee unless it is absent or a teacher-private row
  //    (billable=true, billed by the teacher-private engine). Fee-exempt / waived
  //    / re-scan rows carry charged_fee = 0/NULL, so they contribute nothing.
  let scanQ = build('attendance_scans', 'student_id, status, charged_fee, billable').in(
    'student_id',
    ids,
  );
  if (centerId) scanQ = scanQ.eq('center_id', centerId);
  const scanRows = (((await scanQ) as { data?: unknown }).data ?? []) as {
    student_id: string;
    status: string | null;
    charged_fee: number | null;
    billable: boolean | null;
  }[];

  // 3) Payments — sum logged collections (confirmed + pending + paid) per student.
  let payQ = build('payments', 'student_id, amount, status')
    .in('student_id', ids)
    .in('status', PAID_PAYMENT_STATUSES);
  if (centerId) payQ = payQ.eq('center_id', centerId);
  const payRows = (((await payQ) as { data?: unknown }).data ?? []) as {
    student_id: string;
    amount: number | null;
    status: string;
  }[];

  // Fold: charge = Σ snapshotted charged_fee; paid = Σ payments; balance = charge − paid.
  const charge = new Map<string, number>();
  for (const scan of scanRows) {
    if (scan.status === NON_CHARGEABLE_SCAN_STATUS) continue; // absent
    if (scan.billable === true) continue; // teacher-private — billed separately
    charge.set(scan.student_id, (charge.get(scan.student_id) ?? 0) + (Number(scan.charged_fee) || 0));
  }
  const paidTotal = new Map<string, number>();
  for (const p of payRows) {
    paidTotal.set(p.student_id, (paidTotal.get(p.student_id) ?? 0) + (Number(p.amount) || 0));
  }

  for (const id of ids) {
    const c = round2(charge.get(id) ?? 0);
    const paid = round2(paidTotal.get(id) ?? 0);
    out.set(id, { studentId: id, charge: c, paid, balance: computeBalance(c, paid) });
  }
  return out;
}

/** Convenience: one student's balance (0 if unknown). */
export async function getStudentBalance(supabase: AnySupabase, studentId: string): Promise<number> {
  const map = await getStudentBalances(supabase, { studentIds: [studentId] });
  return map.get(studentId)?.balance ?? 0;
}

/**
 * Total OUTSTANDING (money owed to the center) across a set of balances:
 * sum of POSITIVE balances only — credits (negative balances) are not netted
 * against other students' debt.
 */
export function sumOutstanding(balances: Iterable<StudentBalance>): number {
  let total = 0;
  for (const b of balances) total += Math.max(0, b.balance);
  return round2(total);
}
