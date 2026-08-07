/**
 * Student STANDING — the four states Merged-Center-Students §01/§03 draw on a
 * roster row and on the detail header (Paid / At risk / Overdue / New), plus the
 * one fact live had nowhere: **the age of the oldest still-unpaid charge**.
 *
 * Every ageing string in that design file needs it:
 *   §01 row meta        "owes 300 EGP"
 *   §02 balance card    "12 days overdue · since 01/07/2026"
 *   §03 amber alert     "3 behind · 900 EGP · oldest 4 days"
 *   §03 row money col   "300 EGP / 4 days"
 *   §03 hero hint       "2 sessions unpaid · oldest 18/07"
 *
 * `getStudentBalances` returns only a net scalar, so none of the above could be
 * derived from it.
 *
 * THERE IS NO PER-CHARGE SETTLEMENT LEDGER AND THIS DOES NOT ADD ONE. No column,
 * table or constraint is introduced. The open-charge age is a FIFO fold over
 * columns that already physically exist (verified in information_schema on
 * project lczmjpnbuhnsislcvzar):
 *
 *   attendance_scans.{student_id, scanned_at, session_date, charged_fee, status, billable}
 *   payments.{student_id, amount, paid_at, status}
 *   students.{id, created_at, is_active}
 *
 * The exclusions are byte-for-byte the ones `studentBalance.ts` applies (absent
 * scans skipped, teacher-private `billable=true` skipped, payments filtered to
 * `payments.confirmed`) and the net figure comes from `computeBalance` in that
 * module — imported, not re-implemented — so the two can never disagree.
 *
 * DAY ARITHMETIC IS CAIRO, NOT `new Date()`. `startOfCairoDay` anchors both ends
 * of every delta; the unit suite runs TZ=UTC precisely to catch a regression here.
 *
 * NOT derived from `students.payment_status`: that column is 'unpaid' on 100% of
 * live rows and no code path maintains it.
 */

import { startOfCairoDay } from '@/lib/cairo/day';
import { computeBalance, isNonCollection } from '@/lib/studentBalance';

/**
 * Days a positive balance must have been outstanding before "At risk" becomes
 * "Overdue". Config point: `platform_config.student_overdue_after_days` (a
 * key/value row — no DDL). This is the code default when the row is absent,
 * which it is today.
 */
export const OVERDUE_AFTER_DAYS = 7;

/**
 * Days a student stays "New" after signup — and only while they have neither
 * been charged nor paid. Config point: `platform_config.student_new_for_days`.
 */
export const NEW_STUDENT_DAYS = 7;

export type Standing = 'paid' | 'at_risk' | 'overdue' | 'new';

export type StudentStandingRow = {
  studentId: string;
  /** Σ chargeable snapshotted session fees (same fold as studentBalance). */
  charge: number;
  /** Σ logged payments (confirmed + pending + paid). */
  paid: number;
  /** charge − paid via computeBalance; negative = credit. */
  balance: number;
  /** ISO date of the oldest charge FIFO leaves uncovered, or null when settled. */
  oldestUnpaidAt: string | null;
  /** Cairo-day age of `oldestUnpaidAt`, or null when settled. */
  oldestUnpaidDays: number | null;
  /** How many charges FIFO leaves wholly or partly uncovered. */
  openChargeCount: number;
  /** attendance_scans rows with status='absent' — the §01 "missed 3" segment. */
  absentCount: number;
  /** students.created_at, for the `new` window. */
  createdAt: string | null;
};

export type StandingThresholds = {
  overdueAfterDays?: number;
  newStudentDays?: number;
};

/** Round to 2dp (money) — same rule as studentBalance. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Whole Cairo calendar days from `iso` to `now`, never negative.
 *
 * `startOfCairoDay` returns noon UTC on the Cairo calendar date, so the
 * difference between two of them is always an exact multiple of a day — no
 * DST/offset drift, and no dependence on the process timezone.
 */
export function cairoDaysSince(iso: string | Date, now: Date = new Date()): number {
  const from = startOfCairoDay(typeof iso === 'string' ? new Date(iso) : iso).getTime();
  const to = startOfCairoDay(now).getTime();
  if (!Number.isFinite(from)) return 0;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

/**
 * Which of the design's four standings a row is in.
 *
 *   new      — signed up inside NEW_STUDENT_DAYS AND never charged or paid.
 *              A student who has already been charged is not "new" however
 *              recently they joined; the badge would otherwise hide a debt.
 *   paid     — balance <= 0 (zero, or a credit).
 *   overdue  — owes, and the oldest open charge is >= OVERDUE_AFTER_DAYS old.
 *   at_risk  — owes, but not yet that old.
 */
export function deriveStanding(
  row: Pick<StudentStandingRow, 'charge' | 'paid' | 'balance' | 'oldestUnpaidDays' | 'createdAt'>,
  now: Date = new Date(),
  thresholds: StandingThresholds = {},
): Standing {
  const overdueAfter = thresholds.overdueAfterDays ?? OVERDUE_AFTER_DAYS;
  const newFor = thresholds.newStudentDays ?? NEW_STUDENT_DAYS;

  if (
    row.createdAt &&
    row.charge === 0 &&
    row.paid === 0 &&
    cairoDaysSince(row.createdAt, now) < newFor
  ) {
    return 'new';
  }
  if (row.balance <= 0) return 'paid';
  if ((row.oldestUnpaidDays ?? 0) >= overdueAfter) return 'overdue';
  return 'at_risk';
}

/** Standings that mean "this student owes money" — the §03 Behind segment. */
export function isBehind(standing: Standing): boolean {
  return standing === 'at_risk' || standing === 'overdue';
}

// Structural client type — matches the server admin client AND the browser
// client, exactly as studentBalance.ts does. Only `.from().select()` is used.
type AnySupabase = { from: (table: string) => { select: (columns: string) => unknown } };
type Builder = {
  eq: (col: string, val: unknown) => Builder;
  in: (col: string, vals: readonly unknown[]) => Builder;
  then: (r: (v: { data: unknown }) => unknown) => unknown;
};
type Db = { from: (t: string) => { select: (c: string) => unknown } };

type ChargeRow = { at: string; amount: number };

/**
 * FIFO: walk charges oldest-first against the pool of money collected. The first
 * charge the pool cannot fully cover is the OPEN charge, and its date is the
 * ageing anchor every "N days overdue" string in the design reads.
 *
 * Exported for the unit suite — the arithmetic is the part worth testing without
 * a database, same argument as `computeBalance`.
 */
export function foldOpenCharges(
  charges: ChargeRow[],
  paidTotal: number,
): { oldestUnpaidAt: string | null; openChargeCount: number } {
  let pool = round2(paidTotal);
  let oldestUnpaidAt: string | null = null;
  let openChargeCount = 0;

  const ordered = [...charges]
    .filter((c) => c.amount > 0 && Boolean(c.at))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  for (const c of ordered) {
    if (pool >= c.amount - 0.005) {
      pool = round2(pool - c.amount);
      continue;
    }
    if (oldestUnpaidAt === null) oldestUnpaidAt = c.at;
    openChargeCount += 1;
    pool = 0;
  }
  return { oldestUnpaidAt, openChargeCount };
}

/**
 * Standings for a set of students. Set-based — four bulk queries regardless of
 * roster size, folded in memory, so a 500-student roster is not N+1.
 *
 * Pass `centerId` and/or `studentIds`; passing neither returns an empty map
 * (never scan the table unscoped).
 */
export async function getStudentStandings(
  supabase: AnySupabase,
  query: { centerId?: string; studentIds?: string[]; activeOnly?: boolean },
  now: Date = new Date(),
): Promise<Map<string, StudentStandingRow>> {
  const { centerId, studentIds, activeOnly } = query;
  const out = new Map<string, StudentStandingRow>();
  if (!centerId && (!studentIds || studentIds.length === 0)) return out;

  const db = supabase as unknown as Db;
  const build = (table: string, cols: string): Builder =>
    db.from(table).select(cols) as unknown as Builder;

  let sQ = build('students', 'id, is_active, created_at');
  if (centerId) sQ = sQ.eq('center_id', centerId);
  if (studentIds && studentIds.length > 0) sQ = sQ.in('id', studentIds);
  const studentRows = (((await sQ) as { data?: unknown }).data ?? []) as {
    id: string;
    is_active?: boolean | null;
    created_at?: string | null;
  }[];

  for (const s of studentRows) {
    if (activeOnly && s.is_active === false) continue;
    out.set(s.id, {
      studentId: s.id,
      charge: 0,
      paid: 0,
      balance: 0,
      oldestUnpaidAt: null,
      oldestUnpaidDays: null,
      openChargeCount: 0,
      absentCount: 0,
      createdAt: s.created_at ?? null,
    });
  }
  if (out.size === 0) return out;
  const ids = Array.from(out.keys());

  let scanQ = build(
    'attendance_scans',
    'student_id, status, charged_fee, billable, scanned_at, session_date',
  ).in('student_id', ids);
  if (centerId) scanQ = scanQ.eq('center_id', centerId);
  const scanRows = (((await scanQ) as { data?: unknown }).data ?? []) as {
    student_id: string;
    status: string | null;
    charged_fee: number | null;
    billable: boolean | null;
    scanned_at: string | null;
    session_date: string | null;
  }[];

  // `confirmed` is authoritative, matching studentBalance.ts. Standing and
  // balance MUST read the same definition of collected money — a student whose
  // balance says settled while standing says overdue is the screen
  // contradicting itself, and that is what two filters guarantee eventually.
  let payQ = build('payments', 'student_id, amount, confirmed, status, paid_at')
    .in('student_id', ids)
    .eq('confirmed', true);
  if (centerId) payQ = payQ.eq('center_id', centerId);
  const payRows = (((await payQ) as { data?: unknown }).data ?? []) as {
    student_id: string;
    amount: number | null;
    confirmed: boolean | null;
    status: string | null;
  }[];

  const chargesByStudent = new Map<string, ChargeRow[]>();
  const chargeTotal = new Map<string, number>();
  const absents = new Map<string, number>();
  for (const scan of scanRows) {
    if (scan.status === 'absent') {
      absents.set(scan.student_id, (absents.get(scan.student_id) ?? 0) + 1);
      continue; // absent is not chargeable — same rule as studentBalance.ts
    }
    if (scan.billable === true) continue; // teacher-private, billed elsewhere
    const amount = Number(scan.charged_fee) || 0;
    chargeTotal.set(scan.student_id, (chargeTotal.get(scan.student_id) ?? 0) + amount);
    const at = scan.session_date ?? scan.scanned_at;
    if (!at) continue;
    const list = chargesByStudent.get(scan.student_id) ?? [];
    list.push({ at, amount });
    chargesByStudent.set(scan.student_id, list);
  }

  const paidTotals = new Map<string, number>();
  for (const p of payRows) {
    // Same rule as studentBalance: confirmed says money arrived, status says
    // what the row is. Keep these two folds identical or standing and balance
    // drift apart again.
    if (isNonCollection(p.status)) continue;
    paidTotals.set(p.student_id, (paidTotals.get(p.student_id) ?? 0) + (Number(p.amount) || 0));
  }

  for (const id of ids) {
    const prev = out.get(id)!;
    const charge = round2(chargeTotal.get(id) ?? 0);
    const paid = round2(paidTotals.get(id) ?? 0);
    const { oldestUnpaidAt, openChargeCount } = foldOpenCharges(
      chargesByStudent.get(id) ?? [],
      paid,
    );
    out.set(id, {
      ...prev,
      charge,
      paid,
      balance: computeBalance(charge, paid),
      oldestUnpaidAt,
      oldestUnpaidDays: oldestUnpaidAt ? cairoDaysSince(oldestUnpaidAt, now) : null,
      openChargeCount,
      absentCount: absents.get(id) ?? 0,
    });
  }
  return out;
}
