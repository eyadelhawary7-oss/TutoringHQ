-- ============================================================================
-- ALREADY APPLIED TO PRODUCTION. This file records what is there; it does not
-- introduce it.
--
-- Applied 7 August 2026 through the Supabase MCP tool, which executed the DDL
-- and wrote `20260807185735 / narrow_tuition_payment_methods` into
-- supabase_migrations.schema_migrations — and left the repository with no file.
-- Verified 7 August 2026: that version IS in the production ledger (1 row of
-- 268), and `20260806120000` is NOT (0 rows).
--
-- WHY THAT MATTERED, and it is FINDINGS entry 39 in its worse direction:
--   * A rebuild from supabase/migrations/ produced the OLD WIDE constraint for
--     transactions_method_chk.
--   * db/schema.snapshot recorded that same wide definition.
--   * schema-drift compares the rebuild against the snapshot. They agreed, so
--     the gate PASSED — while both disagreed with production.
-- The tree UNDERSTATED what the database enforces. Entry 39's earlier instances
-- were the reverse: proposals recorded in the tree and absent from production.
-- A green gate comparing two artefacts derived from the same stale source is
-- entry 40's shape — "two wrongs agreeing is what a parity check reports as
-- correct."
--
-- ============================================================================
-- THE DEFINITIONS BELOW WERE READ BACK FROM pg_constraint AND TRANSCRIBED, NOT
-- RECONSTRUCTED. Each CHECK body is the exact `pg_get_expr(conbin, conrelid)`
-- output from production on 7 August 2026, so a rebuild normalises to precisely
-- what production holds rather than to something merely equivalent.
--
-- Re-read pg_constraint before trusting this file (FINDINGS entry 30):
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname IN ('payments_method_check',
--                      'teacher_profiles_default_payment_method_chk',
--                      'transactions_method_chk');
--
-- APPLYING THIS TO PRODUCTION IS A NO-OP. Its version is already in the ledger,
-- so `supabase db push` skips it; run by hand, DROP IF EXISTS + ADD reproduces
-- what is there. Its purpose is to make a REBUILD match production.
--
-- ALL THREE CONSTRAINTS ARE HERE. The 6 August file narrows only payments and
-- teacher_profiles; transactions was narrowed in the same MCP call and appears
-- in no other file.
--
-- design/NEW-MODEL.md, "What died": "Fawry, Vodafone Cash, card as tuition
-- methods — InstaPay covers wallets. Two tuition methods only."
-- ============================================================================

BEGIN;

-- 1. payments.method — the tuition ledger.
ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_method_check;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_method_check
  CHECK ((method = ANY (ARRAY['cash'::text, 'instapay'::text])));

-- 2. teacher_profiles.default_payment_method — the teacher's own default.
--    NULL stays allowed: a teacher who has not chosen is not a teacher who
--    chose cash.
ALTER TABLE public.teacher_profiles
  DROP CONSTRAINT IF EXISTS teacher_profiles_default_payment_method_chk;

ALTER TABLE public.teacher_profiles
  ADD CONSTRAINT teacher_profiles_default_payment_method_chk
  CHECK (((default_payment_method IS NULL) OR (default_payment_method = ANY (ARRAY['cash'::text, 'instapay'::text]))));

-- 3. transactions.method — the TEACHER PRIVATE-TUITION ledger.
--
--    The 6 August file spared this one, on the stated grounds that the table
--    "governs the platform charging its own customers through Paymob". That was
--    wrong: transactions carries student_id, group_id, teacher_id, lesson_fee,
--    payer_type, teacher_net and snap_teacher_pct, and its readers are almost
--    all under src/app/api/teacher/private/*. It is tuition (FINDINGS entry 49).
--
--    Narrowed on the ruling that the METHOD question does not depend on the
--    TABLE question: tuition is cash or InstaPay whichever table records it, and
--    card / wallet / apple_pay / google_pay are gone either way. The separate
--    question of the dead 90/10 columns on this same table is proposed in
--    supabase/migrations_proposed/PROPOSED_drop_split_model_columns.sql and is
--    NOT part of this file.
--
--    The NULL branch is preserved exactly as production has it: a pending row
--    may have no method yet; a settled row must have one.
ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_method_chk;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_method_chk
  CHECK ((((status = 'pending'::text) AND ((method IS NULL) OR (method = ANY (ARRAY['cash'::text, 'instapay'::text])))) OR ((status <> 'pending'::text) AND (method = ANY (ARRAY['cash'::text, 'instapay'::text])))));

COMMIT;

-- PostgREST caches the schema. Without this the DDL succeeds and the app keeps
-- using the old shape, which is a silent failure rather than an error.
NOTIFY pgrst, 'reload schema';
