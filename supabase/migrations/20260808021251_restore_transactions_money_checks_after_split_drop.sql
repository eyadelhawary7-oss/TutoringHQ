-- ============================================================================
-- APPLIED TO PRODUCTION 8 August 2026, recorded as version 20260808021251.
-- Version read back from supabase_migrations.schema_migrations, not inferred
-- from this filename (FINDINGS entry 21).
--
-- Companion to 20260808020632_drop_split_model_columns.sql. Apply after it.
-- ============================================================================
-- WHY THIS EXISTS: DROP COLUMN cascaded, and took two money guards with it.
--
-- Postgres drops any CHECK constraint that references a dropped column. The
-- seven split-model columns were named in two of them, so dropping the columns
-- silently removed both. The proposal did not mention this, and it was found
-- only by diffing the rebuilt schema snapshot against the committed one — the
-- drop itself reported nothing.
--
-- What was lost:
--
--   transactions_customer_sum_chk
--     CHECK (kind <> 'lesson' OR (lesson_fee + customer_commission_amt
--                                 + processing_fee_amt) = amount_billed)
--
--   transactions_nonneg_chk
--     CHECK (lesson_fee >= 0 AND customer_commission_amt >= 0
--            AND processing_fee_amt >= 0 AND amount_billed >= 0
--            AND teacher_commission_amt >= 0 AND teacher_net >= 0
--            AND platform_gross >= 0 AND platform_net >= 0
--            AND snap_vat_amount >= 0 AND settlement_retry_count >= 0)
--
-- The commission terms are gone for good — there is no percentage of tuition
-- (design/NEW-MODEL.md). The REST are not: without these the ledger had no
-- non-negativity guard on lesson_fee, processing_fee_amt, amount_billed or
-- snap_vat_amount, and no total invariant on a lesson row. A money table
-- accepting a negative fee is a regression, and it would have shipped silently.
--
-- Re-added narrowed to the surviving columns. Verified against all 3 live rows
-- BEFORE applying: sum invariant held on 3 of 3, non-negativity on 3 of 3.
--
-- VERIFIED AFTER APPLYING, read back from pg_get_constraintdef:
--   transactions_customer_sum_chk
--     CHECK (((kind <> 'lesson'::text) OR ((lesson_fee + processing_fee_amt) = amount_billed)))
--   transactions_nonneg_chk
--     CHECK (((lesson_fee >= (0)::numeric) AND (processing_fee_amt >= (0)::numeric)
--             AND (amount_billed >= (0)::numeric) AND (snap_vat_amount >= (0)::numeric)
--             AND (settlement_retry_count >= 0)))
-- ============================================================================

BEGIN;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_nonneg_chk CHECK (
    lesson_fee >= 0
    AND processing_fee_amt >= 0
    AND amount_billed >= 0
    AND snap_vat_amount >= 0
    AND settlement_retry_count >= 0
  );

-- A lesson's billed total is the fee plus the processing fee. There is no
-- customer commission term any more.
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_customer_sum_chk CHECK (
    kind <> 'lesson'
    OR (lesson_fee + processing_fee_amt) = amount_billed
  );

COMMIT;
