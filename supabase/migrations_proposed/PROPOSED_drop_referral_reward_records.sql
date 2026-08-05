-- ============================================================================
-- PROPOSED — NOT APPLIED, NOT SCHEDULED. Requires Eyad's approval.
--
-- This file is deliberately OUTSIDE supabase/migrations/ so that no tool,
-- branch preview, or CI step can pick it up. To apply it, Eyad moves it into
-- supabase/migrations/ with a real timestamp prefix and runs it by hand against
-- production, per CLAUDE.md working rule 5 (migrations are manual apply).
--
-- Retire `public.referral_reward_records`.
-- ============================================================================
--
-- WHY
-- ---
-- `referral_commissions` is the canonical referral ledger. D22 repointed the
-- last three readers of `referral_reward_records` onto it:
--
--   src/app/api/referral/route.ts               (centre /referrals page)
--   src/app/api/referrals/payout/route.ts       (withdrawal balance check)
--   src/app/api/admin/referral-rewards/route.ts (admin view)
--
-- After D22 the table has no reader in src/. Its only writer,
-- POST /api/referrals/calculate-rewards, has no entry in vercel.json crons[]
-- and no caller anywhere in src/ — it is reachable only by hitting the URL
-- directly. That is the defect this retirement closes: two tables holding the
-- same concept with two different status vocabularies, one of them fed by a
-- route nothing invokes.
--
-- EVIDENCE (live catalog, project lczmjpnbuhnsislcvzar, verified 2026-08-05)
-- -------------------------------------------------------------------------
--   select count(*) from public.referral_reward_records;  -->  0
--
-- Zero rows, so there is NO BACKFILL and no data to migrate. Re-run the count
-- immediately before applying and abort if it is not still 0.
--
-- STATUS VOCABULARY BEING RETIRED
-- -------------------------------
--   old CHECK: ('pending','held','available','paid')  NOT NULL default 'pending'
--   new CHECK: ('hold','withdrawable','paid','forfeited')  NULLABLE default 'hold'
--
--   pending  -> hold          ('pending' and 'held' were two names for the same
--   held     -> hold           state; collapsing them is the point of the fix)
--   available-> withdrawable
--   paid     -> paid
--   (new)       forfeited     -- no old equivalent
--
-- WHAT THIS FILE DOES NOT DO
-- --------------------------
-- It does NOT delete src/app/api/referrals/calculate-rewards/route.ts, nor
-- supabase/functions/calculate-rewards/index.ts, nor
-- tests/unit/api/referrals-calculate-rewards-auth.test.ts. Dropping the table
-- while that route still exists leaves a route that 500s instead of writing to
-- a shadow ledger. Removing the route is a separate code change; sequence the
-- code removal FIRST, then this drop, or apply both in the same window.
--
-- Also note `src/lib/googleDriveBackup.ts` lists 'referral_reward_records' in
-- its table set — that entry must be removed in the same window or the backup
-- job will fail on a missing relation.
--
-- PRE-FLIGHT (run these first; abort on any surprise)
-- --------------------------------------------------
--   select count(*) from public.referral_reward_records;              -- expect 0
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where confrelid = 'public.referral_reward_records'::regclass;    -- expect 0 rows
--                                                                     -- (nothing FKs INTO it)
--
-- ============================================================================

BEGIN;

-- Fail loudly rather than silently discarding data if a row appeared.
DO $$
DECLARE
  n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.referral_reward_records;
  IF n <> 0 THEN
    RAISE EXCEPTION
      'referral_reward_records holds % row(s); this drop assumed 0. Stop and reconcile against referral_commissions before proceeding.', n;
  END IF;
END $$;

DROP TABLE public.referral_reward_records;

COMMIT;
