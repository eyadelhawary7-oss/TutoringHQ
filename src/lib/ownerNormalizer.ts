// src/lib/ownerNormalizer.ts
//
// Pure, display-only normalization that projects the two distinct billing
// models — centers (inline billing on `centers`) and teachers
// (`teacher_subscriptions` + `teacher_profiles` + `users`) — onto ONE
// `UnifiedAccount` shape so the admin money screens can render a combined
// Centers / Teachers / All view without duplicating field-mapping logic.
//
// This module NEVER touches the money engine. It only reads/maps rows.
//   - Center MRR keeps flowing through `getImpliedMonthlyMrr` (status + is_test
//     aware; 0 for suspended/test).
//   - Teacher monthly figure keeps flowing through `teacherMonthlyGross`
//     (snapshotted price_gross, else the tier default).
// The two pricing ladders are intentionally NOT merged.
//
// Dates are normalized to a Cairo calendar day (YYYY-MM-DD):
//   - center `next_payment_due` is a DATE column (already a Cairo-intended
//     calendar day) → passed through.
//   - teacher `next_billing_at` is timestamptz → converted via `cairoDateKey`.

import { cairoDateKey } from '@/lib/cairo/day';
import { getImpliedMonthlyMrr } from '@/lib/pricing';
import { teacherMonthlyGross } from '@/lib/ceoTeachers';

export type OwnerType = 'center' | 'teacher';

/**
 * Small shared status vocabulary for the combined screens. Center and teacher
 * native statuses are mapped onto this so a single badge/filter works for both.
 */
export type UnifiedStatus =
  | 'trial'
  | 'active'
  | 'overdue'
  | 'suspended'
  | 'churned'
  | 'inactive';

export interface UnifiedAccount {
  ownerType: OwnerType;
  ownerId: string;
  name: string | null;
  phone: string | null;
  /** Pricing tier — center `plan` or teacher `plan_key`. Ladders kept distinct. */
  tier: string | null;
  /** center: getImpliedMonthlyMrr (0 for suspended/test). teacher: teacherMonthlyGross. */
  monthlyMrr: number;
  /** center `billing_period` | teacher `billing_interval`. */
  cadence: string | null;
  /** Next charge normalized to a Cairo calendar day (YYYY-MM-DD) or null. */
  nextChargeCairoDay: string | null;
  unifiedStatus: UnifiedStatus;
  isTest: boolean;
  /** center `last_payment_date` | teacher `last_payment_at`, raw. */
  lastPaymentAt: string | null;
}

// ── Canonical invoice amount ─────────────────────────────────────────────────

/**
 * Canonical invoice amount = `payment_amount ?? total_amount ?? 0`.
 *
 * `invoices.payment_amount` is NULL on engine-generated invoices AND on every
 * teacher invoice — only `total_amount` is populated there. Reading raw
 * `payment_amount` makes those invoices count as 0. Route every combined
 * revenue/invoice read through this (or the SQL equivalent
 * `COALESCE(payment_amount, total_amount)`).
 *
 * Nullish semantics: a real `payment_amount` of 0 stays 0 (does not fall
 * through to `total_amount`).
 */
export function invoiceAmount(
  row:
    | { payment_amount?: number | string | null; total_amount?: number | string | null }
    | null
    | undefined,
): number {
  const pa = row?.payment_amount;
  if (pa != null) {
    const n = Number(pa);
    if (Number.isFinite(n)) return n;
  }
  const ta = row?.total_amount;
  if (ta != null) {
    const n = Number(ta);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

// ── Date normalization ───────────────────────────────────────────────────────

/** Center DATE columns are already Cairo-intended calendar days. */
function centerDateToCairoDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return cairoDateKey(d);
}

/** Teacher timestamptz → Cairo calendar day. */
function instantToCairoDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return cairoDateKey(d);
}

// ── Status mapping ───────────────────────────────────────────────────────────

/** Center `status` + `billing_status` → unified status. */
export function centerUnifiedStatus(
  status: string | null | undefined,
  billingStatus: string | null | undefined,
): UnifiedStatus {
  const s = (status ?? '').toLowerCase();
  const b = (billingStatus ?? '').toLowerCase();
  if (s === 'suspended') return 'suspended';
  if (s === 'churned' || s === 'cancelled') return 'churned';
  if (s === 'deleted' || s === 'inactive') return 'inactive';
  if (b === 'overdue') return 'overdue';
  return 'active';
}

/** Teacher subscription status → unified status. */
export function teacherUnifiedStatus(status: string | null | undefined): UnifiedStatus {
  switch ((status ?? '').toLowerCase()) {
    case 'trialing':
      return 'trial';
    case 'active':
      return 'active';
    case 'past_due':
      return 'overdue';
    case 'suspended':
      return 'suspended';
    case 'cancelled':
      return 'churned';
    default:
      return 'inactive';
  }
}

// ── Row shapes (loose — only the fields the mappers read) ─────────────────────

export interface CenterAccountRow {
  id: string;
  name?: string | null;
  phone?: string | null;
  plan?: string | null;
  all_in_price?: number | null;
  billing_period?: string | null;
  billing_type?: string | null;
  status?: string | null;
  billing_status?: string | null;
  next_payment_due?: string | null;
  last_payment_date?: string | null;
  is_early_adopter?: boolean | null;
  early_adopter_price?: number | null;
  is_test?: boolean | null;
}

export interface TeacherSubRow {
  teacher_id: string;
  plan_key?: string | null;
  status?: string | null;
  price_gross?: number | null;
  billing_interval?: string | null;
  next_billing_at?: string | null;
  last_payment_at?: string | null;
}

export interface TeacherProfileRow {
  user_id?: string;
  display_name?: string | null;
  is_test?: boolean | null;
}

export interface TeacherUserRow {
  id?: string;
  phone?: string | null;
  name?: string | null;
}

// ── Mappers ──────────────────────────────────────────────────────────────────

export function normalizeCenter(row: CenterAccountRow): UnifiedAccount {
  return {
    ownerType: 'center',
    ownerId: row.id,
    name: row.name ?? null,
    phone: row.phone ?? null,
    tier: row.plan ?? null,
    monthlyMrr: getImpliedMonthlyMrr({
      plan: row.plan,
      all_in_price: row.all_in_price,
      billing_period: row.billing_period,
      status: row.status,
      billing_type: row.billing_type,
      is_early_adopter: row.is_early_adopter,
      early_adopter_price: row.early_adopter_price,
      id: row.id,
      is_test: row.is_test,
    }),
    cadence: row.billing_period ?? null,
    nextChargeCairoDay: centerDateToCairoDay(row.next_payment_due),
    unifiedStatus: centerUnifiedStatus(row.status, row.billing_status),
    isTest: !!row.is_test,
    lastPaymentAt: row.last_payment_date ?? null,
  };
}

export function normalizeTeacher(
  sub: TeacherSubRow,
  profile?: TeacherProfileRow | null,
  user?: TeacherUserRow | null,
): UnifiedAccount {
  return {
    ownerType: 'teacher',
    ownerId: sub.teacher_id,
    name: profile?.display_name ?? user?.name ?? null,
    phone: user?.phone ?? null,
    tier: sub.plan_key ?? null,
    monthlyMrr: teacherMonthlyGross(sub.plan_key, sub.price_gross),
    cadence: sub.billing_interval ?? null,
    nextChargeCairoDay: instantToCairoDay(sub.next_billing_at),
    unifiedStatus: teacherUnifiedStatus(sub.status),
    isTest: !!profile?.is_test,
    lastPaymentAt: sub.last_payment_at ?? null,
  };
}

// ── Owner-type request parsing (shared by the money routes) ──────────────────

export type OwnerFilter = 'center' | 'teacher' | 'all';

/** Parse the `owner_type` query param. Absent/unknown → 'center' (preserves today's behavior). */
export function parseOwnerFilter(request: Request): OwnerFilter {
  const raw = (new URL(request.url).searchParams.get('owner_type') || '').toLowerCase();
  if (raw === 'teacher') return 'teacher';
  if (raw === 'all') return 'all';
  return 'center';
}

/** Whether an invoice/account of the given owner type belongs in the filtered view. */
export function ownerMatchesFilter(
  rowOwnerType: string | null | undefined,
  filter: OwnerFilter,
): boolean {
  if (filter === 'all') return true;
  const ot = rowOwnerType === 'teacher' ? 'teacher' : 'center';
  return ot === filter;
}
