-- Phase 5 (underpayment handling): track cumulative confirmed receipts per invoice.
--
-- A wallet/manual payment can settle LESS than the invoice total. We must hold the
-- partial amount as credit toward the SAME invoice (never lose the customer's money)
-- and show only the remaining difference as due. `amount_received` is the single,
-- reliably-stored source of truth for "how much has actually been received against
-- this invoice" — the remaining balance is `total_amount - amount_received`.
--
-- `payment_amount` is intentionally NOT reused: it already carries the manual
-- payment-proof (Instapay) claim pending admin approval, a different concept.
--
-- Per-transaction idempotency for partial crediting lives in
-- `invoices.metadata.applied_txns` (jsonb array of Paymob transaction ids), so a
-- webhook delivered twice never double-counts a partial.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS amount_received NUMERIC NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.invoices.amount_received IS
  'Cumulative confirmed amount received via Paymob against this invoice (EGP). Remaining due = total_amount - amount_received. Partial payments are held here as credit toward the same invoice.';
