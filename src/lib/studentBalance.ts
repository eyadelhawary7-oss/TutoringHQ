/**
 * Student balance — the SINGLE source of truth for "what a student owes".
 *
 * DEFINITION (see PR / docs): a student's balance is
 *
 *     balance = (Σ per attended session of that session's group fee) − (logged payments)
 *
 * where
 *   • attended session = an attendance_scans row for the student whose `status`
 *                        is NOT 'absent' (present, or legacy NULL). Absent excluded.
 *   • session fee      = the fee of the scan's group (student_groups.fee), which
 *                        is the authoritative per-session price the scanner charges
 *                        (ScanTab: `grp?.fee ?? student.fee ?? 0`). students.fee is
 *                        only a legacy fallback for a group-less scan (it is NULL in
 *                        practice); a scan with no resolvable fee contributes 0.
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

  // 1) Students — set the row set, plus each student's legacy fallback fee.
  let sQ = build('students', 'id, fee, is_active');
  if (centerId) sQ = sQ.eq('center_id', centerId);
  if (studentIds && studentIds.length > 0) sQ = sQ.in('id', studentIds);
  const studentRows = (((await sQ) as { data?: unknown }).data ?? []) as {
    id: string;
    fee: number | null;
    is_active?: boolean | null;
  }[];

  const fallbackFee = new Map<string, number>();
  for (const s of studentRows) {
    if (activeOnly && s.is_active === false) continue; // keep true + legacy NULL
    fallbackFee.set(s.id, Number(s.fee) || 0);
    out.set(s.id, { studentId: s.id, charge: 0, paid: 0, balance: 0 });
  }
  if (out.size === 0) return out;
  const ids = Array.from(out.keys());

  // 2) Attendance scans — attended (status != 'absent') carry their group_id.
  let scanQ = build('attendance_scans', 'student_id, status, group_id').in('student_id', ids);
  if (centerId) scanQ = scanQ.eq('center_id', centerId);
  const scanRows = (((await scanQ) as { data?: unknown }).data ?? []) as {
    student_id: string;
    status: string | null;
    group_id: string | null;
  }[];
  const attended = scanRows.filter((s) => s.status !== NON_CHARGEABLE_SCAN_STATUS);

  // 3) Group fees for exactly the groups those scans reference (per-session price).
  const groupIds = Array.from(
    new Set(attended.map((s) => s.group_id).filter((g): g is string => !!g)),
  );
  const groupFee = new Map<string, number>();
  if (groupIds.length > 0) {
    const gRows = (((await build('student_groups', 'id, fee').in('id', groupIds)) as {
      data?: unknown;
    }).data ?? []) as { id: string; fee: number | null }[];
    for (const g of gRows) groupFee.set(g.id, Number(g.fee) || 0);
  }

  // 4) Payments — sum logged collections (confirmed + pending + paid) per student.
  let payQ = build('payments', 'student_id, amount, status')
    .in('student_id', ids)
    .in('status', PAID_PAYMENT_STATUSES);
  if (centerId) payQ = payQ.eq('center_id', centerId);
  const payRows = (((await payQ) as { data?: unknown }).data ?? []) as {
    student_id: string;
    amount: number | null;
    status: string;
  }[];

  // Fold: charge = Σ session group-fees; paid = Σ payments; balance = charge − paid.
  const charge = new Map<string, number>();
  for (const scan of attended) {
    const fee =
      (scan.group_id != null ? groupFee.get(scan.group_id) : undefined) ??
      fallbackFee.get(scan.student_id) ??
      0;
    charge.set(scan.student_id, (charge.get(scan.student_id) ?? 0) + fee);
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
