-- SUPERSEDED BY 20260807185735_narrow_tuition_payment_methods.sql. THIS FILE
-- WAS NEVER APPLIED, AND ITS VERSION IS NOT IN THE PRODUCTION LEDGER.
--
-- What actually happened on 7 August 2026, verified against
-- supabase_migrations.schema_migrations the same day: the narrowing went in
-- through the Supabase MCP tool, which recorded version `20260807185735`
-- (1 row of 268). **`20260806120000` is absent — 0 rows.** So the DDL this file
-- describes is in production, and this file is not what put it there.
--
-- That sibling file narrows all THREE constraints, including
-- transactions_method_chk, which this one deliberately spared on a premise that
-- turned out to be wrong (see FINDINGS entry 49). Read the sibling for what
-- production enforces. Read this one for the ORDERING CONDITION below, which is
-- why the apply was safe and is the part worth carrying to the next constraint
-- change.
--
-- Kept rather than deleted because FINDINGS entries 39, 49 and 52 cite it, and
-- because a rebuild applying it before its successor is harmless: both are
-- DROP IF EXISTS + ADD, and the later file wins.
--
-- PROPOSAL — NOT APPLIED. Eyad applies this by hand.
--
-- APPROVED 6 August 2026, WITH AN ORDERING CONDITION.
-- Do NOT apply this until the application-code PR has merged. Five places still
-- offer all six methods (listed at the foot of this file). Applying the
-- constraint first turns a silent no-op into a visible 400. Pre-launch that is
-- harmless, but there is no reason to choose it.
--   1. Narrow the five code sites to cash and instapay. One PR. Merge it.
--   2. Then apply this file by hand.
--   3. Then verify against the catalog and regenerate the snapshot.
--
-- Narrow the tuition payment methods to the two the InstaPay model allows:
-- cash and instapay. See design/NEW-MODEL.md, "What died":
--   "Fawry, Vodafone Cash, card as tuition methods — InstaPay covers wallets.
--    Two tuition methods only."
--
-- SAFETY. RE-RUN against the live catalog on 7 August 2026, because the block
-- below was written on 6 August and one line of it had already gone stale --
-- it said "payments 0 rows", and payments now holds 30. Still safe, but the
-- number was doing the reassuring rather than the checking:
--   payments                                 30 rows: 19 'cash', 11 'instapay'
--   teacher_profiles                         3 rows, default_payment_method NULL in all 3
--   transactions                             3 rows, method: 1 'cash', 2 NULL
-- No row uses vodacash, vodafone_cash, orange, fawry or bank.
-- Nothing is rewritten and no backfill is required.
-- Re-run before applying. A count in a comment is not a measurement, it is a
-- record of one, and nothing fails when it drifts.
--
-- WHY TWO CONSTRAINTS AND NOT THREE -- THE ORIGINAL REASON WAS WRONG:
--
-- This file previously said transactions_method_chk "governs the platform
-- charging its own customers through Paymob ... That is not tuition."
-- Checked against the catalog on 7 August 2026, that is not what the table is.
-- public.transactions carries student_id, group_id, teacher_id, lesson_fee,
-- payer_type, payer_phone, teacher_net and snap_teacher_pct, and almost every
-- one of its readers sits under src/app/api/teacher/private/*. It is the
-- TEACHER PRIVATE-TUITION LEDGER -- a student paying a teacher for a lesson --
-- and it is therefore squarely tuition.
--
-- Its constraint still admits card, wallet, apple_pay, google_pay,
-- vodafone_cash and other. Under design/NEW-MODEL.md the first four died with
-- the gateway and vodafone_cash died with the wallets.
--
-- It is still NOT narrowed here, and now for a stated reason rather than a
-- mistaken one: the table also carries customer_commission_amt,
-- teacher_commission_amt, platform_gross, snap_customer_pct, settlement_status
-- and paymob_split_ref -- the 90/10 split and platform settlement that the new
-- model deletes outright. Narrowing one column of a table whose shape is
-- pending a larger removal would settle the small question and leave the big
-- one open. It needs Eyad's decision on the table, not a constraint edit.
-- Recorded in design/FINDINGS.md entry 49.
--
-- A NOTE ON SPELLING, because it caused a real bug:
-- payments spells it 'vodacash'; teacher_profiles and transactions spell it
-- 'vodafone_cash'. One method, two spellings, three constraints. That split is
-- why ScanResultScreen wrote 'vodafone_cash' into a column that only accepted
-- 'vodacash', so the payments row was silently never created while the student
-- was marked present and billed. Narrowing removes the split rather than
-- preserving it.

BEGIN;

-- 1. payments.method — the tuition ledger.
ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_method_check;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_method_check
  CHECK (method = ANY (ARRAY['cash'::text, 'instapay'::text]));

-- 2. teacher_profiles.default_payment_method — the teacher's own default.
--    NULL stays allowed: all three live rows are NULL, and a teacher who has
--    not chosen is not the same as a teacher who chose cash.
ALTER TABLE public.teacher_profiles
  DROP CONSTRAINT IF EXISTS teacher_profiles_default_payment_method_chk;

ALTER TABLE public.teacher_profiles
  ADD CONSTRAINT teacher_profiles_default_payment_method_chk
  CHECK (
    default_payment_method IS NULL
    OR default_payment_method = ANY (ARRAY['cash'::text, 'instapay'::text])
  );

COMMIT;

-- PostgREST caches the schema. Without this the DDL succeeds and the app keeps
-- using the old shape, which is a silent failure rather than an error.
NOTIFY pgrst, 'reload schema';

-- AFTER APPLYING:
--   1. Confirm both definitions against the catalog, not against this file:
--        SELECT conname, pg_get_constraintdef(oid)
--          FROM pg_constraint
--         WHERE conname IN ('payments_method_check',
--                           'teacher_profiles_default_payment_method_chk');
--   2. Regenerate db/schema.snapshot, or schema-drift fails on the next PR for
--      a reason that looks unrelated.
--
-- NOT IN THIS MIGRATION, and each needs a decision first:
--   - attendance_scans.payment_method has NO constraint of any kind. NEW-FEATURES
--     §1 puts a payment method on the attendance record defaulting to InstaPay,
--     so this column likely becomes that field. It should gain a constraint when
--     that is built, not before the shape is settled.
--   - teacher_profiles.accepted_methods (text[]) has NO constraint. Empty in all
--     three live rows. Constraining array membership is a different exercise.
-- THE CODE PR THAT MUST MERGE FIRST. The list below said five sites; it was
-- eight. DONE and merged as of 7 August 2026 -- this file is now clear to
-- apply. The five originally named:
--   src/lib/validations.ts                           the Zod enum
--   src/app/[locale]/payments/page.tsx               METHOD_CONFIG + MethodPillFilter
--   src/components/ScanResultScreen.tsx              PAYMENT_METHODS buttons
--   src/components/shared/MethodBadge.tsx            label + colour maps
--   src/lib/excel-export.ts                          Arabic method labels
-- and three the list did not have, each gated by a constraint THIS FILE
-- narrows, so each would have broken on apply:
--   src/app/api/payments/collect/route.ts            ALLOWED_METHODS. The server
--       allow-list, and the one that decides what reaches payments.method. It
--       held 'vodafone_cash', 'orange_cash' and 'bank_transfer' -- three
--       spellings payments_method_check has NEVER accepted (it spells them
--       'vodacash', 'orange', 'bank'). So they passed the gate and the database
--       rejected them. 'bank_transfer' was the one the collect modal offered,
--       so every Bank Transfer collection 500'd. Same spelling split as the
--       ScanResultScreen bug described above, one layer further in.
--   src/app/[locale]/teacher/(portal)/settings/page.tsx  PAYMENT_METHODS
--   src/app/api/teacher/profile/route.ts                 PAYMENT_METHODS
--       Both write teacher_profiles.default_payment_method, which constraint 2
--       below narrows. Both offered 'vodafone_cash' and 'other'.
--
-- NOT narrowed, and deliberately: the teacher private-tuition surfaces that
-- write transactions.method (api/teacher/private/*, IncomeView, the session
-- mark-paid buttons). They follow the transactions decision above, not this
-- migration.
