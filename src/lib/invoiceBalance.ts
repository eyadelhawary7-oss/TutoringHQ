// src/lib/invoiceBalance.ts
//
// Pure, client-safe money-math for invoice underpayment (Phase 5).
//
// A wallet / manual payment can settle LESS than the invoice total. The partial
// amount is held as credit toward the SAME invoice (never lost) and the invoice
// shows only the REMAINING difference as due, payable via the same Pay-now button.
//
// Invariants this module guarantees:
//   - remaining = max(0, total - received)              (never negative)
//   - one invoice, one processing fee: the fee lives inside `total`, so topping up
//     `remaining` never adds a second fee — there is nothing here that re-derives a
//     fee, and no percentage is ever applied to anything.
//   - per-transaction idempotency: a Paymob transaction id already credited is
//     never counted twice (a webhook delivered twice cannot double-count).
//
// This module is PURE (no Supabase, no Date) so it is exhaustively unit-tested.

/** Half a piaster — tolerance for float drift when comparing EGP amounts. */
const SETTLE_EPSILON = 0.005;

export function round2(n: number): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

/** Non-negative remaining balance still due on the invoice. */
export function remainingBalance(total: number, received: number): number {
  const t = Math.max(0, round2(total));
  const r = Math.max(0, round2(received));
  return Math.max(0, round2(t - r));
}

/** True once enough has been received to satisfy the invoice total. */
export function isInvoiceSettled(total: number, received: number): boolean {
  const t = Math.max(0, round2(total));
  if (t <= 0) return false; // a zero/invalid total is never "settled" via payment
  const r = Math.max(0, round2(received));
  return r + SETTLE_EPSILON >= t;
}

export interface PaymentApplication {
  /** The txn id was already credited to this invoice — no change applied. */
  alreadyApplied: boolean;
  /** Cumulative received after applying this payment (to persist). */
  newReceived: number;
  /** Remaining due after applying this payment. */
  remaining: number;
  /** Whether the invoice is now fully satisfied (→ mark paid + unlock). */
  settled: boolean;
  /** The applied-transaction list to persist (deduped, txn appended). */
  appliedTxns: string[];
}

/**
 * Decide how a single confirmed Paymob receipt applies to an invoice.
 *
 * Idempotent: if `txnId` is already in `appliedTxns`, the payment is treated as a
 * duplicate and nothing changes (the current balance is reported). Otherwise the
 * amount is added to the cumulative received and the invoice settles only when the
 * cumulative reaches the full total.
 *
 * @param amountPaid The amount confirmed received in THIS transaction (EGP).
 */
export function applyPaymentToInvoice(opts: {
  total: number;
  received: number;
  appliedTxns?: readonly string[] | null;
  txnId?: string | null;
  amountPaid: number;
}): PaymentApplication {
  const total = Math.max(0, round2(opts.total));
  const received = Math.max(0, round2(opts.received));
  const existing = (opts.appliedTxns ?? []).map(String).filter((s) => s.length > 0);
  const txnId = opts.txnId != null ? String(opts.txnId).trim() : '';

  if (txnId && existing.includes(txnId)) {
    return {
      alreadyApplied: true,
      newReceived: received,
      remaining: remainingBalance(total, received),
      settled: isInvoiceSettled(total, received),
      appliedTxns: existing,
    };
  }

  const amountPaid = Math.max(0, round2(opts.amountPaid));
  const newReceived = round2(received + amountPaid);
  const appliedTxns = txnId ? [...existing, txnId] : existing;

  return {
    alreadyApplied: false,
    newReceived,
    remaining: remainingBalance(total, newReceived),
    settled: isInvoiceSettled(total, newReceived),
    appliedTxns,
  };
}

/** Read the applied-transaction list off an invoice metadata blob, safely. */
export function readAppliedTxns(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== 'object') return [];
  const raw = (metadata as { applied_txns?: unknown }).applied_txns;
  if (!Array.isArray(raw)) return [];
  return raw.map(String).filter((s) => s.length > 0);
}
