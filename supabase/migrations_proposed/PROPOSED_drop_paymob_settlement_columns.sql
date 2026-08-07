-- ============================================================================
-- PROPOSED — NOT APPLIED, NOT SCHEDULED. Requires Eyad's approval.
--
-- Outside supabase/migrations/ so no tool, branch preview, or CI step picks it
-- up. To apply, move it into supabase/migrations/ with a timestamped name and
-- regenerate db/schema.snapshot in the same commit.
--
-- ============================================================================
-- WHY THIS IS A SEPARATE FILE FROM THE 90/10 DROP.
--
-- Ruled by Eyad, 7 August 2026: these columns and the commission columns died
-- for DIFFERENT REASONS, so they get different migrations.
--
--   PROPOSED_drop_split_model_columns.sql  — the COMMISSION SPLIT. The platform
--       took a percentage of tuition. It does not.
--   this file                              — PAYMOB SPLIT SETTLEMENT. The
--       platform received tuition, held it, and remitted it on a cycle. It
--       never receives it at all now.
--
-- Different rollback stories. Reviving a commission would mean pricing again;
-- reviving settlement would mean the platform touching tuition again, which is
-- the one thing design/NEW-MODEL.md rules out outright. Bundling them would
-- make the second impossible to reverse without the first.
--
-- ============================================================================
-- EVIDENCE, re-run against the live catalog on 7 August 2026.
--
-- NOT ONE OF THESE FIVE HAS A REAL CODE REFERENCE. Counted over src/ with
-- comment lines excluded:
--
--   settlement_status          0 refs   NOT NULL DEFAULT 'not_applicable'
--   expected_settlement_at     0 refs   populated on 0 of 3 rows
--   settled_at                 1 ref, and it is INSIDE A COMMENT
--                                       (dashboard/page.tsx:661, a note that
--                                       reads "transactions: 3 rows,
--                                       settled_at populated on 0 of them")
--   settlement_retry_count     0 refs
--   paymob_split_ref           0 refs   populated on 0 of 3 rows
--
-- So unlike the commission drop, THIS ONE NEEDS NO CODE PR AT ALL. Nothing
-- selects these columns, nothing writes them, and no RPC mentions them:
-- pg_proc.prosrc for finish_class_and_bill and finish_center_class_and_bill
-- returned false for settlement_status and paymob_split_ref alike.
--
-- transactions holds 3 rows, all kind='lesson'. Nothing is rewritten and no
-- backfill is required.
--
-- RE-RUN BEFORE APPLYING. These are a record of a measurement, not a
-- measurement (FINDINGS entry 30).
--
-- ============================================================================
-- ONE THING TO DECIDE BEFORE APPLYING, and it is not a blocker:
-- `paymob_split_ref` is the gateway's SPLIT-PAYMENT handle — Paymob dividing a
-- single parent payment between platform and provider at capture time. It
-- belongs to the split model by MEANING and to settlement by MECHANISM, so it
-- could sit in either file. It is here because it is a Paymob artefact, and
-- because leaving it with the commission columns would make that file the only
-- one naming a vendor.
--
-- Paymob itself is NOT dead: it still charges centres for their own
-- subscriptions. Only the tuition leg died. Dropping this column does not touch
-- paymob_order_ref, which is a legitimate handle on a platform charge and is
-- deliberately left alone.
-- ============================================================================

BEGIN;

ALTER TABLE public.transactions
  DROP COLUMN IF EXISTS settlement_status,
  DROP COLUMN IF EXISTS expected_settlement_at,
  DROP COLUMN IF EXISTS settled_at,
  DROP COLUMN IF EXISTS settlement_retry_count,
  DROP COLUMN IF EXISTS paymob_split_ref;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- AFTER APPLYING:
--   1. Confirm against the catalog, not against this file:
--        SELECT column_name FROM information_schema.columns
--         WHERE table_schema='public' AND table_name='transactions'
--         ORDER BY ordinal_position;
--   2. Regenerate db/schema.snapshot, or schema-drift fails on the next PR for
--      a reason that looks unrelated.
