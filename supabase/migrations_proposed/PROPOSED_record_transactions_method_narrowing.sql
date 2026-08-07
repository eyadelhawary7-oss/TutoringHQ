-- ============================================================================
-- PROPOSED — NOT APPLIED. Bookkeeping, not a change of behaviour.
--
-- Outside supabase/migrations/ so nothing picks it up automatically. See
-- FINDINGS entry 52 for why that directory choice matters.
--
-- ============================================================================
-- WHAT THIS IS FOR: production already enforces this. The tree does not say so.
--
-- On 7 August 2026 the tuition narrowing was applied by hand and extended to a
-- THIRD constraint that the migration file did not carry. Verified by reading
-- pg_constraint back the same day, production now holds:
--
--   payments_method_check                        cash | instapay
--   teacher_profiles_default_payment_method_chk  NULL | cash | instapay
--   transactions_method_chk                      cash | instapay   <-- by hand
--
-- The first two are produced by
-- supabase/migrations/20260806120000_PROPOSAL_narrow_tuition_payment_methods.sql.
-- **Nothing in supabase/migrations/ produces the third.**
--
-- THE RESULTING STATE, and why CI does not catch it:
--   * A rebuild from supabase/migrations/ yields the OLD WIDE constraint —
--     card | wallet | apple_pay | google_pay | instapay | cash | vodafone_cash
--     | other.
--   * db/schema.snapshot:2566 still records that same wide definition.
--   * schema-drift compares the rebuild against the snapshot. They agree, so
--     the check PASSES — while BOTH disagree with production.
--
-- This is FINDINGS entry 39's warning arriving a third time: "anyone reading
-- the snapshot as a description of production will be wrong, and nothing in the
-- file says so." The first two instances came from proposals that were never
-- applied. This one is the reverse — applied to production and recorded
-- nowhere — which is the more dangerous direction, because the tree understates
-- what the database enforces rather than overstating it.
--
-- ============================================================================
-- APPLYING THIS IS A NO-OP AGAINST PRODUCTION. DROP IF EXISTS + ADD reproduces
-- the constraint that is already there. Its purpose is to make a rebuild from
-- migrations match production.
--
-- IT MUST MOVE WITH A SNAPSHOT REGENERATION. Moving this into
-- supabase/migrations/ changes what the CI rebuild produces, so
-- db/schema.snapshot must be regenerated in the SAME commit or schema-drift
-- fails on the next PR for a reason that looks unrelated to it.
--
-- Re-read pg_constraint before applying rather than trusting the definition
-- transcribed above (FINDINGS entry 30).
-- ============================================================================

BEGIN;

ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_method_chk;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_method_chk
  CHECK (
    (status = 'pending'::text
      AND (method IS NULL OR method = ANY (ARRAY['cash'::text, 'instapay'::text])))
    OR
    (status <> 'pending'::text
      AND method = ANY (ARRAY['cash'::text, 'instapay'::text]))
  );

COMMIT;

NOTIFY pgrst, 'reload schema';

-- AFTER APPLYING:
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = 'transactions_method_chk';
--   then regenerate db/schema.snapshot.
