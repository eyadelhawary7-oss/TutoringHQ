-- ============================================================================
-- PROPOSED — NOT APPLIED, NOT SCHEDULED. Requires Eyad's approval.
--
-- This file is deliberately OUTSIDE supabase/migrations/ so that no tool,
-- branch preview, or CI step can pick it up. To apply it, Eyad moves it into
-- supabase/migrations/ with a timestamped name, or runs it by hand.
--
-- That placement is the whole point, and it is a correction to FINDINGS entry
-- 39. That entry concluded "if proposals should genuinely not apply anywhere,
-- they cannot live in supabase/migrations/" and then recorded that the repo's
-- convention was to accept auto-apply anyway. It missed that this directory
-- already existed and already held two proposals. The narrow-tuition migration
-- sat in supabase/migrations/ and was applied to the preview branch and rebuilt
-- by schema-drift for exactly that reason. It belonged here.
--
-- ============================================================================
-- WHAT THIS DROPS: the 90/10 split model on public.transactions.
--
-- design/NEW-MODEL.md, "What died":
--   "The 90/10 split — the platform does not take a percentage of tuition."
--   "7.5% markup and 1.5% parent processing — both replaced by a flat 10 EGP."
--
-- public.transactions is the TEACHER PRIVATE-TUITION LEDGER, not platform
-- billing (see FINDINGS entry 49 — the earlier migration's claim that it was
-- Paymob platform billing was wrong). Its columns still model a percentage cut
-- the product no longer takes.
--
-- ============================================================================
-- EVIDENCE, every figure re-run against the live catalog on 7 August 2026.
--
-- NO WRITER EXISTS FOR ANY COLUMN BELOW.
--   Both billing functions were inspected via pg_proc.prosrc. Neither
--   `finish_class_and_bill` nor `finish_center_class_and_bill` mentions
--   platform_gross, platform_net, teacher_net, teacher_commission_amt,
--   customer_commission_amt, snap_teacher_pct or snap_customer_pct — all seven
--   returned false.
--   `finish_class_and_bill` IS live: 3 call sites under api/teacher/private/*.
--   `finish_center_class_and_bill` has NO rpc() caller in src/ at all; every
--   mention of it is inside a comment.
--
-- SO EVERY ROW CARRIES THE DEFAULT.
--   All seven columns are NOT NULL DEFAULT 0 (information_schema.columns).
--   transactions holds 3 rows, all kind='lesson', 0 kind='center_fee'.
--   Nothing is rewritten and no backfill is required.
--
-- RE-RUN BEFORE APPLYING. These counts are a record of a measurement, not a
-- measurement (FINDINGS entry 30). The previous migration's safety block said
-- "payments 0 rows" and was wrong within a day.
--
-- ============================================================================
-- THE CODE MUST MERGE FIRST, exactly as it did for the method narrowing.
-- Applying this against the current code turns a column read into a 42703 that
-- PostgREST surfaces as a failed request.
--
-- FIVE columns need NO code change — zero references anywhere in src/:
--   platform_gross            0 refs
--   platform_net              0 refs
--   customer_commission_amt   0 refs
--   snap_customer_pct         0 refs
--   teacher_commission_amt    2 refs, BOTH inside comments
--                             (ceo/CeoBoardSection.tsx, lib/ceoTeachers.ts)
--
-- TWO columns have real readers. Counting non-comment lines only:
--
--   snap_teacher_pct — 17 code lines across 4 files
--     src/app/api/teacher/center-cuts/route.ts          :18 :68 :88 :155 :267
--     src/app/api/teacher/private/income/route.ts       :121 :126 :468 :475
--     src/app/api/teacher/private/income/export/route.ts :32 :37 :77 :167
--     src/app/api/teacher/center-attendance/route.ts    :17 :33 :78 :154
--
--   teacher_net — 19 code lines across 5 files (the four above, plus)
--     src/lib/teacherAnalytics.ts                       :156 :188 :706
--
-- WHAT THOSE READERS COMPUTE TODAY, and it is the reason this is safe:
-- `teacherCut()` in center-cuts/route.ts returns teacher_net when set, else
-- snap_teacher_pct * amount_billed, else 0. Because both columns are NOT NULL
-- DEFAULT 0, the FIRST branch returns a literal 0 for every database row. The
-- route's own comment says so and adds `cutBasisRows` so a caller can tell an
-- unmeasured 0 from a measured one. Removing the columns removes an arithmetic
-- that has only ever produced 0 — it does not remove a number anyone has seen.
--
-- The code PR should delete the cut arithmetic rather than repoint it. Under
-- the new model a teacher keeps the whole fee they set, so a "teacher net"
-- distinct from amount_billed has no meaning to preserve.
--
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

-- PostgREST caches the schema. Without this the DDL succeeds and the app keeps
-- using the old shape, which is a silent failure rather than an error.
NOTIFY pgrst, 'reload schema';

-- AFTER APPLYING:
--   1. Confirm against the catalog, not against this file:
--        SELECT column_name FROM information_schema.columns
--         WHERE table_schema='public' AND table_name='transactions'
--         ORDER BY ordinal_position;
--   2. Regenerate db/schema.snapshot, or schema-drift fails on the next PR for
--      a reason that looks unrelated.
--
-- ============================================================================
-- NOT IN THIS FILE — a second group, listed so it is a decision and not an
-- oversight. These are PLATFORM SETTLEMENT, which died with payouts rather than
-- with the split, so they are a separate question:
--
--   settlement_status        NOT NULL DEFAULT 'not_applicable'   0 src refs
--   expected_settlement_at   populated on 0 of 3 rows            0 src refs
--   settled_at               populated on 0 of 3 rows            1 ref, in a comment
--   settlement_retry_count                                       0 src refs
--   paymob_split_ref         populated on 0 of 3 rows            0 src refs
--
-- All five have zero real code references, so they would drop with no code PR
-- at all. `paymob_split_ref` is the gateway's split-payment handle and belongs
-- with the seven above on meaning; the four settlement columns belong with the
-- deleted payout system. Say which you want and it goes in the same file or a
-- sibling one.
