// src/lib/exportEntitlement.ts
//
// W4 — CUSTOMER data-export entitlement. Exports of a customer's own bulk data
// (dashboard Excel, payments CSV, analytics P&L CSV, teacher income CSV) are a
// PAID feature during the free trial. This module is the single source of truth
// for "may this customer export?" so the four gated surfaces stay in lock-step.
//
// Safe-default rule (fail toward ACCESS): wrongly gating a paying customer is far
// worse than a trial user getting one export. So:
//   - a brand-new trial signup (center summer_status='enrolled' / teacher
//     subscription status='trialing') with zero paid invoices → GATED.
//   - a converted customer (center summer_status='paid' / teacher status='active')
//     → ACCESS.
//   - the `hasEverPaid` OR-clause guarantees an existing paying customer who was
//     swept into the Aug-16 free runway (momentarily 'enrolled') is NEVER gated.
//   - any DB uncertainty resolving `hasEverPaid` fails OPEN (grants access) — see
//     ownerHasEverPaidInvoice.
//
// NOTE: this module must NEVER be imported by the legal PDPL data-rights channel
// (privacy-request) or by any financial-document PDF/receipt route (invoice,
// receipt, payout). Those are customer entitlements and stay ungated by design.

import type { SupabaseClient } from '@supabase/supabase-js';

/** Center-side export access. Enrolled/invoiced (trial) blocks unless the owner has ever paid. */
export function centerHasExportAccess(params: {
  summer_status: string | null | undefined;
  hasEverPaid: boolean;
}): boolean {
  if (params.hasEverPaid === true) return true;
  return params.summer_status !== 'enrolled' && params.summer_status !== 'invoiced';
}

/** Teacher-side export access. Trialing blocks unless the teacher has ever paid. */
export function teacherHasExportAccess(params: {
  subscriptionStatus: string | null | undefined;
  hasEverPaid: boolean;
}): boolean {
  if (params.hasEverPaid === true) return true;
  return params.subscriptionStatus !== 'trialing';
}

export type ExportOwner =
  | { ownerType: 'center'; centerId: string }
  | { ownerType: 'teacher'; teacherId: string };

/**
 * Has this owner (center or teacher) ever paid an invoice? True iff at least one
 * `invoices` row exists with the matching owner_type + owner id and status='paid'.
 *
 * Fail-open: a query error returns TRUE (treat as "has paid" → grants access),
 * per the safe-default rule above — a DB blip must never gate a real payer.
 */
export async function ownerHasEverPaidInvoice(
  admin: SupabaseClient,
  owner: ExportOwner,
): Promise<boolean> {
  let query = admin
    .from('invoices')
    .select('id')
    .eq('owner_type', owner.ownerType)
    .eq('status', 'paid')
    .limit(1);
  query =
    owner.ownerType === 'center'
      ? query.eq('center_id', owner.centerId)
      : query.eq('teacher_id', owner.teacherId);

  const { data, error } = await query;
  if (error) {
    // Uncertain → fail toward ACCESS (grant). Never gate a payer on a DB error.
    return true;
  }
  return Array.isArray(data) && data.length > 0;
}
