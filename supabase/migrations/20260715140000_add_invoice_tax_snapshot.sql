-- Add per-invoice VAT + processing-fee SNAPSHOT columns to public.invoices.
--
-- WHY: generateInvoicePdf selected invoices.subtotal and invoices.tax_amount —
-- columns that DO NOT EXIST — so every invoice/receipt PDF failed to render. VAT
-- was never stored: it was recomputed at render from a hardcoded 14% rate and
-- discarded, and the flat 20 EGP processing fee lived only in metadata. This
-- persists what was actually charged, at the rate in force when the invoice was
-- raised, so:
--   • the PDF reads stored values instead of recomputing (and no longer reads
--     the non-existent subtotal / tax_amount);
--   • Egypt changing the VAT rate never rewrites history — an OLD invoice always
--     reprints at ITS original stored rate (vat_rate is per-invoice);
--   • the processing fee is a first-class column, so the payment-confirmation
--     message can report the full amount charged (fee included).
--
-- COLUMN SEMANTICS (all VAT-inclusive, matching the live rendering + taxMath):
--   • vat_rate       — the VAT fraction used for THIS invoice (e.g. 0.14 = 14%).
--   • vat_amount     — the VAT slice already contained inside total_amount:
--                      total_amount × vat_rate / (1 + vat_rate). total_amount
--                      INCLUDES the processing fee, so the fee is treated as
--                      VAT-inclusive too (this equals what every customer-facing
--                      invoice already prints via buildCombinedInvoiceLines).
--   • processing_fee — the flat fee snapshotted at issue time (0 when none). Was
--                      previously only in metadata.processing_fee; that write is
--                      kept for backward-compat, this column is the source of truth.
--
-- SAFE AGAINST THE OLD CODE THAT IS LIVE WHEN THIS RUNS:
--   • ADD COLUMN … nullable, no default → instant, no table rewrite, brief lock
--     only. The old (currently-deployed) code never reads or writes these columns.
--   • The backfill only fills rows where the columns are NULL and derives figures
--     from already-present total_amount + metadata — no behaviour change for live
--     reads.
--   • The additive CHECK is created AFTER the backfill, so validation of existing
--     rows passes. It constrains only the three new columns; the existing
--     invoices_money_nonneg constraint is left untouched.
--
-- APPLY ORDER: this migration is SAFE to apply BEFORE the code deploy — the new
-- columns simply sit unused until the new code ships. It must NOT be applied
-- AFTER a deploy of code that writes these columns without the columns existing.
-- Recommended: apply this migration first, then deploy the code.
--
-- HELD — REQUIRES SIGN-OFF, NOT applied to production from the coding session.
-- Idempotent.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS vat_rate numeric,
  ADD COLUMN IF NOT EXISTS vat_amount numeric,
  ADD COLUMN IF NOT EXISTS processing_fee numeric;

-- Backfill existing invoices from data already on the row. VAT is the inclusive
-- slice of total_amount at 0.14 (the rate in force for every invoice raised to
-- date); the processing fee is lifted out of metadata.processing_fee (0 when
-- absent). Only touches rows still NULL, so re-running is a no-op.
-- VAT is the inclusive slice of the full total at 0.14 (the rate in force for
-- every invoice raised to date). Every component — charge, processing fee and card
-- delivery — is VAT-bearing, so the VAT base is the full total for every invoice
-- type with no carve-out.
UPDATE public.invoices
   SET processing_fee = COALESCE(NULLIF(metadata->>'processing_fee', '')::numeric, 0),
       vat_rate       = 0.14,
       vat_amount     = round(total_amount * 0.14 / 1.14, 2)
 WHERE vat_amount IS NULL
    OR vat_rate IS NULL
    OR processing_fee IS NULL;

-- Additive, non-negative guard for the new columns (vat_rate is a fraction in
-- [0,1]). Separate from invoices_money_nonneg so that constraint is not touched.
-- Runs after the backfill, so existing rows validate.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.invoices'::regclass
      AND conname = 'invoices_tax_snapshot_nonneg'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_tax_snapshot_nonneg CHECK (
        (vat_amount IS NULL OR vat_amount >= 0)
        AND (processing_fee IS NULL OR processing_fee >= 0)
        AND (vat_rate IS NULL OR (vat_rate >= 0 AND vat_rate <= 1))
      );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
