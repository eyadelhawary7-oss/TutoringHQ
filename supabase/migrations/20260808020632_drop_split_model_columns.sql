-- ============================================================================
-- APPLIED TO PRODUCTION 8 August 2026, recorded as version 20260808020632.
--
-- This file records DDL that is ALREADY LIVE. It is committed so the tree and
-- production agree: applying by hand and leaving no file behind is the trap
-- FINDINGS entry 52 records — a recorded version with no filename anywhere,
-- which makes schema-drift pass by comparing two artefacts that were both
-- derived from the same stale source.
--
-- The version above is the one production's ledger actually holds, read back
-- from supabase_migrations.schema_migrations. It is NOT inferred from this
-- filename: entry 21 established that a filename is not its recorded version.
-- ============================================================================
-- WHAT THIS DROPPED: the 90/10 split model on public.transactions.
--
-- design/NEW-MODEL.md, "What died":
--   "The 90/10 split — the platform does not take a percentage of tuition."
--   "7.5% markup and 1.5% parent processing — both replaced by a flat 10 EGP."
--
-- public.transactions is the TEACHER PRIVATE-TUITION LEDGER, not platform
-- billing (FINDINGS entry 49 corrected an earlier migration that claimed
-- otherwise). Its columns still modelled a percentage cut the product does not
-- take.
--
-- ============================================================================
-- SAFETY, re-run against the live catalog immediately before applying rather
-- than carried forward from the proposal (FINDINGS entry 30 — a count in a
-- comment is a record of a measurement, not a measurement):
--
--   transactions                                3 rows
--   kind='center_fee'                           0 rows
--   rows with ANY of the 7 columns non-zero     0
--   the 7 columns present in information_schema 7
--
-- No writer existed for any of them. pg_proc.prosrc for both billing functions
-- (finish_class_and_bill, finish_center_class_and_bill) mentions none of the
-- seven. All were NOT NULL DEFAULT 0, so every row carried the default and no
-- backfill was required.
--
-- THE CODE MERGED FIRST, as PR #380 (squashed to 1756997e on master). Verified
-- against that tree before applying: all seven columns have ZERO non-comment
-- references in src/. `teacherCut()` — which returned teacher_net when set,
-- else snap_teacher_pct * amount_billed, else 0 — returned a literal 0 for
-- every database row, because the first branch matched the NOT NULL DEFAULT 0.
-- Dropping these removes an arithmetic that had only ever produced 0.
--
-- ============================================================================
-- VERIFIED AFTER APPLYING, against the catalog and not against this file:
--   dropped columns remaining   0
--   rows still present          3   (no data loss)
--   table comment set           true
-- ============================================================================

BEGIN;

ALTER TABLE public.transactions
  DROP COLUMN IF EXISTS platform_gross,
  DROP COLUMN IF EXISTS platform_net,
  DROP COLUMN IF EXISTS customer_commission_amt,
  DROP COLUMN IF EXISTS teacher_commission_amt,
  DROP COLUMN IF EXISTS snap_customer_pct,
  DROP COLUMN IF EXISTS snap_teacher_pct,
  DROP COLUMN IF EXISTS teacher_net;

COMMENT ON TABLE public.transactions IS
  'Teacher private-tuition ledger. A student paying a teacher for a lesson. '
  'The platform takes NO percentage of tuition and never holds it — see '
  'design/NEW-MODEL.md. Do NOT reintroduce platform_gross, teacher_net, '
  'snap_teacher_pct or any commission column: they modelled the 90/10 split, '
  'which was removed on 6 August 2026. The platform''s revenue from a tuition '
  'payment is the flat 10 EGP service fee, billed to the PARENT on their '
  'invoice, and it is not recorded on this table.';

COMMIT;

-- ============================================================================
-- NOT IN THIS FILE — a second group, listed so it stays a decision rather than
-- an oversight. These are PLATFORM SETTLEMENT, which died with payouts rather
-- than with the split, so they are a separate question:
--
--   settlement_status        NOT NULL DEFAULT 'not_applicable'
--   expected_settlement_at
--   settled_at
--   settlement_retry_count
--   paymob_split_ref
--
-- All five have zero real code references, so they would drop with no code PR
-- at all. paymob_split_ref is the gateway's split-payment handle and belongs
-- with the seven above on meaning; the four settlement columns belong with the
-- deleted payout system.
-- ============================================================================
