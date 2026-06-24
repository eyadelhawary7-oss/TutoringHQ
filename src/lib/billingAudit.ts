/**
 * Append-only audit writes for money-critical billing events, uniform across
 * BOTH owner types (centers + teachers).
 *
 * The autocharge path already audits via the midnight-billing adapter's
 * `emitEvent`; this helper covers the finalizer / webhook / reconciliation paths
 * (invoice created, payment applied, invoice paid, payment failed, chargeback,
 * lock set/cleared, self-heal) which previously wrote nothing.
 *
 * Writes go to the existing `audit_log` table. `user_id` is null for these
 * system-initiated events (no human actor). Inserts only — never updates — so the
 * trail stays append-only. All failures are swallowed (audit must never break a
 * money path) but logged.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type BillingOwner = { ownerType: 'center' | 'teacher'; ownerId: string };

export type BillingAuditAction =
  | 'invoice_created'
  | 'invoice_payment_applied' // partial / underpayment credit
  | 'invoice_paid'
  | 'invoice_payment_failed'
  | 'invoice_chargeback'
  | 'invoice_lock_set'
  | 'invoice_lock_cleared'
  | 'reconciliation_self_heal'
  | 'reconciliation_mismatch_flagged';

type Row = Record<string, unknown>;

/** Derive the billing owner from an invoice row (owner_type + center_id/teacher_id). */
export function invoiceOwner(row: Row): BillingOwner | null {
  const ownerType = row.owner_type === 'teacher' ? 'teacher' : 'center';
  const id = ownerType === 'teacher' ? row.teacher_id : row.center_id;
  if (!id) return null;
  return { ownerType, ownerId: String(id) };
}

export async function logBillingEvent(
  supabase: SupabaseClient,
  action: BillingAuditAction,
  owner: BillingOwner,
  details: Record<string, unknown> = {},
): Promise<void> {
  try {
    await supabase.from('audit_log').insert({
      action,
      entity_type: 'billing',
      entity_id: owner.ownerId,
      center_id: owner.ownerType === 'center' ? owner.ownerId : null,
      user_id: null,
      details: { ownerType: owner.ownerType, ...details },
    });
  } catch (e) {
    console.error('[billingAudit] failed to log', action, e);
  }
}
