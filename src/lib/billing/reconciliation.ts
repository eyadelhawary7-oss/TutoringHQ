/**
 * Nightly billing reconciliation — invoices <-> Paymob source of truth.
 *
 * Two scans over a bounded recent window (centers AND teachers, same `invoices`
 * machinery):
 *
 *   Scan A — "we think it's paid; does Paymob agree?"
 *     For each recently-paid Paymob invoice, ask Paymob. If Paymob does NOT show
 *     a successful transaction, flag `paid_without_paymob_success` for human
 *     review. NEVER auto-mutates money state in this direction.
 *
 *   Scan B — "Paymob took the money; did we finalize?"  (the webhook-missed case)
 *     For each recent unpaid invoice that carries a Paymob order, ask Paymob. If
 *     Paymob shows it paid, SELF-HEAL by calling the SAME idempotent finalizer
 *     the webhook uses — this only ever moves unpaid -> correctly-paid, never the
 *     reverse, and the finalizer no-ops if already applied. If the self-heal
 *     can't settle it, flag `paymob_paid_unfinalized` open for review.
 *
 * Everything is idempotent and safe to re-run: a healed invoice becomes 'paid'
 * and drops out of Scan B next run; open findings are de-duplicated by a partial
 * unique index (kind, invoice_id) WHERE status='open'. The decision logic is
 * injected (inquireOrder/finalize) so this module is fully unit-testable with no
 * network or DB.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PaymobOrderInquiryResult } from '@/lib/paymobOrderInquiry';
import { logBillingEvent, invoiceOwner, type BillingOwner } from '@/lib/billingAudit';

type Row = Record<string, unknown>;

export type ReconciliationKind =
  | 'paid_without_paymob_success'
  | 'paymob_paid_unfinalized';

export interface ReconciliationDeps {
  /** Query Paymob for an order's real state. */
  inquireOrder: (paymobOrderId: string) => Promise<PaymobOrderInquiryResult>;
  /** The idempotent finalizer the webhook uses (unpaid -> paid only). */
  finalize: (
    supabase: SupabaseClient,
    paymobOrderId: string,
    paymobTransactionId: string,
  ) => Promise<{ invoiceId: string; settled: boolean } | null>;
  /** Lookback window in days (default 7). Bounds the scan. */
  windowDays?: number;
  now?: () => Date;
}

export interface ReconciliationSummary {
  paidChecked: number;
  unpaidChecked: number;
  selfHealed: number;
  mismatchesFlagged: number;
  errors: number;
}

const PAID_STATUSES_TO_RECHECK = ['paid'];
const UNPAID_STATUSES_TO_HEAL = ['pending', 'overdue', 'failed'];

/**
 * Insert an OPEN review row, de-duplicated: a finding already open for the same
 * (kind, invoice_id) is left as-is (the partial unique index also enforces this,
 * so a racing insert is swallowed).
 */
async function flagOpenMismatch(
  supabase: SupabaseClient,
  kind: ReconciliationKind,
  invoiceId: string,
  owner: BillingOwner | null,
  fields: Partial<{
    paymob_order_id: string | null;
    paymob_transaction_id: string | null;
    expected_amount: number | null;
    paymob_amount: number | null;
    detail: Record<string, unknown>;
  }>,
): Promise<boolean> {
  const { data: existing } = await supabase
    .from('billing_reconciliation_reports')
    .select('id')
    .eq('kind', kind)
    .eq('invoice_id', invoiceId)
    .eq('status', 'open')
    .maybeSingle();
  if ((existing as Row | null)?.id) return false;

  const { error } = await supabase.from('billing_reconciliation_reports').insert({
    kind,
    owner_type: owner?.ownerType ?? null,
    owner_id: owner?.ownerId ?? null,
    invoice_id: invoiceId,
    status: 'open',
    paymob_order_id: fields.paymob_order_id ?? null,
    paymob_transaction_id: fields.paymob_transaction_id ?? null,
    expected_amount: fields.expected_amount ?? null,
    paymob_amount: fields.paymob_amount ?? null,
    detail: fields.detail ?? {},
  });
  // A racing insert hits the partial unique index — treat as already-flagged.
  if (error) return false;
  if (owner) {
    await logBillingEvent(supabase, 'reconciliation_mismatch_flagged', owner, {
      kind,
      invoiceId,
    });
  }
  return true;
}

/** Record a successful self-heal (the one safe auto-mutation) for the audit/report trail. */
async function recordSelfHeal(
  supabase: SupabaseClient,
  invoiceId: string,
  owner: BillingOwner | null,
  fields: { paymob_order_id: string | null; paymob_transaction_id: string | null },
): Promise<void> {
  await supabase.from('billing_reconciliation_reports').insert({
    kind: 'paymob_paid_unfinalized',
    owner_type: owner?.ownerType ?? null,
    owner_id: owner?.ownerId ?? null,
    invoice_id: invoiceId,
    status: 'self_healed',
    paymob_order_id: fields.paymob_order_id,
    paymob_transaction_id: fields.paymob_transaction_id,
    detail: { healedBy: 'reconciliation_cron' },
    resolved_at: new Date().toISOString(),
  });
  if (owner) {
    await logBillingEvent(supabase, 'reconciliation_self_heal', owner, { invoiceId });
  }
}

export async function reconcileRecentBilling(
  supabase: SupabaseClient,
  deps: ReconciliationDeps,
): Promise<ReconciliationSummary> {
  const summary: ReconciliationSummary = {
    paidChecked: 0,
    unpaidChecked: 0,
    selfHealed: 0,
    mismatchesFlagged: 0,
    errors: 0,
  };

  const now = deps.now?.() ?? new Date();
  const windowDays = deps.windowDays ?? 7;
  const cutoffIso = new Date(now.getTime() - windowDays * 86400_000).toISOString();
  // Date-only cutoff for the `date` columns, widened by ONE extra day. A bare
  // `cutoffIso.slice(0,10)` is a UTC calendar date; Cairo (UTC+2/+3) midnight
  // lands a few hours earlier, so the trailing edge of the window could drop a
  // boundary invoice. The +1 day margin guarantees full Cairo-day coverage.
  const cutoffDate = new Date(now.getTime() - (windowDays + 1) * 86400_000)
    .toISOString()
    .slice(0, 10);

  // --- Scan A: paid Paymob invoices — confirm Paymob agrees (no mutation) ---
  const { data: paidRows } = await supabase
    .from('invoices')
    .select(
      'id, owner_type, center_id, teacher_id, status, total_amount, paymob_order_id, paymob_transaction_id, payment_method, paid_at',
    )
    .in('status', PAID_STATUSES_TO_RECHECK)
    .eq('payment_method', 'paymob')
    .gte('paid_at', cutoffIso);

  for (const raw of (paidRows as Row[]) ?? []) {
    const orderId = String(raw.paymob_order_id ?? '').trim();
    if (!orderId) continue; // only Paymob-settled invoices are reconcilable here
    summary.paidChecked += 1;
    try {
      const inquiry = await deps.inquireOrder(orderId);
      if (inquiry.state !== 'paid') {
        const flagged = await flagOpenMismatch(
          supabase,
          'paid_without_paymob_success',
          String(raw.id),
          invoiceOwner(raw),
          {
            paymob_order_id: orderId,
            paymob_transaction_id: (raw.paymob_transaction_id as string) ?? null,
            expected_amount: Number(raw.total_amount ?? 0),
            detail: { paymobState: inquiry.state },
          },
        );
        if (flagged) summary.mismatchesFlagged += 1;
      }
    } catch (e) {
      summary.errors += 1;
      console.error('[reconciliation] scanA', raw.id, e);
    }
  }

  // --- Scan B: unpaid invoices with a Paymob order — self-heal if actually paid ---
  const { data: unpaidRows } = await supabase
    .from('invoices')
    .select(
      'id, owner_type, center_id, teacher_id, status, total_amount, paymob_order_id, paymob_transaction_id',
    )
    .in('status', UNPAID_STATUSES_TO_HEAL)
    .not('paymob_order_id', 'is', null)
    // Bound the window to ACTIONABLE recency, not the period START. A monthly
    // invoice's billing_period_start is ~a month before it falls due/gets paid,
    // so the old `billing_period_start >= cutoff` filter silently skipped
    // invoices that were actually due — and possibly Paymob-paid-but-unfinalized
    // — inside the window (the boundary gap). Catch anything recently CREATED or
    // recently DUE. Self-heal direction is unchanged: unpaid -> paid only.
    .or(`created_at.gte.${cutoffIso},due_date.gte.${cutoffDate}`);

  for (const raw of (unpaidRows as Row[]) ?? []) {
    const orderId = String(raw.paymob_order_id ?? '').trim();
    if (!orderId) continue;
    summary.unpaidChecked += 1;
    try {
      const inquiry = await deps.inquireOrder(orderId);
      if (inquiry.state !== 'paid') continue; // unpaid-and-Paymob-agrees → nothing to do

      // Paymob took the money but we never finalized (webhook lost). Safe direction:
      // run the SAME idempotent finalizer the webhook would have.
      const txnId = inquiry.transactionId ?? (raw.paymob_transaction_id as string) ?? '';
      const result = await deps.finalize(supabase, orderId, txnId);
      const owner = invoiceOwner(raw);
      if (result?.settled) {
        await recordSelfHeal(supabase, String(raw.id), owner, {
          paymob_order_id: orderId,
          paymob_transaction_id: txnId || null,
        });
        summary.selfHealed += 1;
      } else {
        // Finalizer couldn't settle it (partial / unexpected) — surface for review.
        const flagged = await flagOpenMismatch(
          supabase,
          'paymob_paid_unfinalized',
          String(raw.id),
          owner,
          {
            paymob_order_id: orderId,
            paymob_transaction_id: txnId || null,
            expected_amount: Number(raw.total_amount ?? 0),
            detail: { settled: result?.settled ?? null, finalizeReturned: result == null ? 'null' : 'unsettled' },
          },
        );
        if (flagged) summary.mismatchesFlagged += 1;
      }
    } catch (e) {
      summary.errors += 1;
      console.error('[reconciliation] scanB', raw.id, e);
    }
  }

  return summary;
}
