-- Backfill repo record for card_orders lifecycle columns.
--
-- These three columns (refund_status, cancelled_at, cancellation_reason) were
-- applied directly via the Supabase dashboard at some point and exist in
-- production, but no migration file in this repo declares them. This file
-- captures their definitions idempotently so a clean rebuild matches prod.
--
-- Source of truth for shape:
--   * production information_schema (all three nullable, no defaults)
--   * src/lib/cardOrderState.ts — writes `refund_status` ∈ {pending, approved,
--     paid, rejected, NULL}, and on the `cancelled_before_payment` event sets
--     cancelled_at = now() ISO and cancellation_reason = caller-provided text.
--
-- Adds the same CHECK constraint that production carries on refund_status.

BEGIN;

ALTER TABLE public.card_orders
  ADD COLUMN IF NOT EXISTS refund_status text NULL;

ALTER TABLE public.card_orders
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz NULL;

ALTER TABLE public.card_orders
  ADD COLUMN IF NOT EXISTS cancellation_reason text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.card_orders'::regclass
      AND conname = 'card_orders_refund_status_check'
  ) THEN
    ALTER TABLE public.card_orders
      ADD CONSTRAINT card_orders_refund_status_check
      CHECK (
        refund_status IS NULL
        OR refund_status = ANY (ARRAY['pending'::text, 'approved'::text, 'paid'::text, 'rejected'::text])
      );
  END IF;
END $$;

COMMIT;
