// src/lib/repriceSubscriptionInvoice.ts
//
// Reprice an existing PENDING subscription invoice to a new tier's base price,
// for the "day zero" upgrade rule: when a center upgrades on or after
// next_payment_due, there is no separate proration charge — the renewal
// invoice already sitting in `invoices` (created by subscriptionBillingCron at
// next_payment_due - 7) is changed to the new tier's price and the customer
// pays that. One invoice per period (never a second charge for the same
// renewal), and the flat processing fee already snapshotted on the invoice is
// REUSED, never re-derived from current config — a mid-cycle fee-config
// change must not silently change what an in-flight invoice charges.
//
// Refuses (does not silently skip) when amount_received > 0: a partial
// payment already received against the OLD total makes "what does the
// customer now owe" a policy question, not a computation this module should
// guess at.

import type { SupabaseClient } from '@supabase/supabase-js';
import { round2 } from '@/lib/invoiceBalance';
import { buildInvoiceTaxSnapshot } from '@/lib/processingFee';

export type RepriceRefusalCode =
  | 'PARTIAL_PAYMENT_RECEIVED'
  | 'INVALID_NEW_BASE'
  | 'INVOICE_NOT_FOUND'
  | 'INVOICE_NOT_SUBSCRIPTION'
  | 'INVOICE_NOT_PAYABLE'
  | 'UPDATE_FAILED';

export interface SubscriptionInvoiceRepriceCalc {
  base: number;
  fee: number;
  total: number;
  vatAmount: number;
  vatRate: number;
}

export type RepriceCalcResult =
  | { ok: true; value: SubscriptionInvoiceRepriceCalc }
  | { ok: false; code: RepriceRefusalCode; message: string };

/**
 * Pure: compute the new base/fee/total/VAT snapshot for repricing to `newBase`.
 * `existingFee` is the fee ALREADY on the invoice (its `processing_fee` column /
 * `metadata.processing_fee`) — this never calls getProcessingFeeConfig, so an
 * in-flight invoice keeps the fee it was created with regardless of later
 * config changes. Refuses when `amountReceived > 0` rather than guessing how a
 * partial payment against the old total should carry over to the new one.
 */
export function computeSubscriptionInvoiceReprice(input: {
  newBase: number;
  existingFee: number;
  existingVatRate?: number | null;
  amountReceived: number;
}): RepriceCalcResult {
  const received = Math.max(0, round2(Number(input.amountReceived) || 0));
  if (received > 0) {
    return {
      ok: false,
      code: 'PARTIAL_PAYMENT_RECEIVED',
      message:
        `Cannot reprice: ${received} EGP has already been received against this invoice. ` +
        'Refusing rather than guessing a policy for partial payment + reprice.',
    };
  }

  const base = round2(Number(input.newBase));
  if (!Number.isFinite(base) || base <= 0) {
    return {
      ok: false,
      code: 'INVALID_NEW_BASE',
      message: 'New tier base price must be a positive number.',
    };
  }

  const fee = Math.max(0, round2(Number(input.existingFee) || 0));
  const total = round2(base + fee);
  const vatRate =
    input.existingVatRate != null && Number.isFinite(Number(input.existingVatRate))
      ? Number(input.existingVatRate)
      : undefined;
  const snapshot = buildInvoiceTaxSnapshot({ total, fee, vatRate });

  return {
    ok: true,
    value: { base, fee, total, vatAmount: snapshot.vat_amount, vatRate: snapshot.vat_rate },
  };
}

export type RepriceInvoiceResult =
  | { ok: true; invoiceId: string; base: number; fee: number; total: number }
  | { ok: false; code: RepriceRefusalCode; message: string };

/**
 * Reprice a specific subscription invoice (by id + center_id) to `newBase` and
 * persist it: base_amount, total_amount, the VAT snapshot, and BOTH the
 * `processing_fee` column and `metadata.processing_fee` (kept in sync, mirroring
 * how the invoice was created). Clears `paymob_order_id` / `paymob_iframe_url`
 * unconditionally on a successful reprice — a cached checkout iframe for the
 * OLD total must never be handed back to the customer for the NEW total
 * (see the matching guard in /api/invoices/[id]/pay).
 *
 * Only ever touches an invoice that is `invoice_type = 'subscription'` and
 * `status` in (pending, overdue, failed) — the shapes a renewal invoice can be
 * in while still unpaid. Anything else is refused, not coerced.
 */
export async function repriceSubscriptionInvoice(
  supabaseAdmin: SupabaseClient,
  params: { invoiceId: string; centerId: string; newBase: number },
): Promise<RepriceInvoiceResult> {
  const { data, error } = await supabaseAdmin
    .from('invoices')
    .select('id, center_id, invoice_type, status, amount_received, processing_fee, vat_rate, metadata')
    .eq('id', params.invoiceId)
    .eq('center_id', params.centerId)
    .maybeSingle();

  if (error || !data) {
    return {
      ok: false,
      code: 'INVOICE_NOT_FOUND',
      message: `Subscription invoice ${params.invoiceId} not found for this center.`,
    };
  }

  const row = data as {
    id: string;
    invoice_type: string | null;
    status: string | null;
    amount_received: number | string | null;
    processing_fee: number | string | null;
    vat_rate: number | string | null;
    metadata: unknown;
  };

  if (row.invoice_type !== 'subscription') {
    return {
      ok: false,
      code: 'INVOICE_NOT_SUBSCRIPTION',
      message: `Invoice ${params.invoiceId} is invoice_type=${row.invoice_type ?? 'null'}, not 'subscription'.`,
    };
  }

  if (row.status !== 'pending' && row.status !== 'overdue' && row.status !== 'failed') {
    return {
      ok: false,
      code: 'INVOICE_NOT_PAYABLE',
      message: `Invoice ${params.invoiceId} is status=${row.status ?? 'null'}, not pending/overdue/failed.`,
    };
  }

  const existingMeta = (row.metadata && typeof row.metadata === 'object' ? row.metadata : {}) as Record<
    string,
    unknown
  >;
  // The `processing_fee` column is the source of truth (set alongside
  // buildInvoiceTaxSnapshot at creation); metadata.processing_fee is kept as a
  // duplicate for the render helpers that read from metadata. Fall back to the
  // metadata copy only if the column is unexpectedly null.
  const existingFee =
    row.processing_fee != null ? Number(row.processing_fee) : Number(existingMeta.processing_fee ?? 0);

  const calc = computeSubscriptionInvoiceReprice({
    newBase: params.newBase,
    existingFee,
    existingVatRate: row.vat_rate != null ? Number(row.vat_rate) : null,
    amountReceived: Number(row.amount_received ?? 0),
  });
  if (!calc.ok) return calc;

  const { base, fee, total, vatAmount, vatRate } = calc.value;

  const { error: updErr } = await supabaseAdmin
    .from('invoices')
    .update({
      base_amount: base,
      total_amount: total,
      processing_fee: fee,
      vat_amount: vatAmount,
      vat_rate: vatRate,
      metadata: { ...existingMeta, processing_fee: fee },
      paymob_order_id: null,
      paymob_iframe_url: null,
    })
    .eq('id', params.invoiceId)
    .eq('center_id', params.centerId);

  if (updErr) {
    return {
      ok: false,
      code: 'UPDATE_FAILED',
      message: `Failed to persist reprice for invoice ${params.invoiceId}: ${updErr.message}`,
    };
  }

  return { ok: true, invoiceId: params.invoiceId, base, fee, total };
}
