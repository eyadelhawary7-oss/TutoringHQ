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
-- SAFETY, verified against the live catalog on 6 August 2026:
--   payments                                 0 rows
--   teacher_profiles                         3 rows, default_payment_method NULL in all 3,
--                                            accepted_methods empty array in all 3
--   attendance_scans                         3 rows, payment_method NULL in all 3
--   transactions                             3 rows, method: 1 'cash', 2 NULL
--   invoices                                 2 rows, payment_method NULL
--   renewal_history, payout_requests         0 rows
-- No row anywhere uses vodacash, vodafone_cash, orange, fawry or bank.
-- Nothing is rewritten and no backfill is required.
--
-- WHY TWO CONSTRAINTS AND NOT THREE:
-- transactions_method_chk is deliberately untouched. It governs the platform
-- charging its own customers through Paymob, where card, wallet, apple_pay and
-- google_pay are legitimate. That is not tuition.
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
-- THE CODE PR THAT MUST MERGE FIRST, five sites, all still offering six methods:
--   src/lib/validations.ts:90                        the Zod enum
--   src/app/[locale]/payments/page.tsx               METHOD_CONFIG + MethodPillFilter
--   src/components/ScanResultScreen.tsx              PAYMENT_METHODS buttons
--   src/components/shared/MethodBadge.tsx            label + colour maps
--   src/lib/excel-export.ts                          Arabic method labels
-- Narrow each to cash and instapay, merge, then apply this file.
