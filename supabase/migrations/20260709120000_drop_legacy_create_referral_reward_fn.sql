-- Drop the orphaned legacy create_referral_reward() trigger function.
--
-- Its two triggers (on_center_insert_referral, on_center_subscribe_referral) were
-- removed in 20260409120000_disable_legacy_referral_reward_triggers.sql, leaving
-- the function attached to nothing. It populated public.referral_rewards from
-- pricing_plans.monthly_fee * 20%; monthly_fee was dropped in 20260708120200 and
-- referral_rewards holds 0 rows, so the function's body now references a
-- non-existent column and can never run.
--
-- The LIVE referral path is entirely app code and does not use this function:
--   - Commission accrual: public.referral_commissions + /api/cron/referral-automation
--     (net-revenue base via src/lib/referralNetBase.ts).
--   - Cash withdrawal / payout: computeReferralPayout in src/lib/referralPayout.ts
--     (1000 EGP minimum gross, then a flat 20 EGP processing fee, then 5% on the
--     remainder). This is the single source of truth for the payout amount.
--
-- Verified against live prod before authoring: no trigger references the function
-- (orphaned), referral_rewards has 0 rows, and no app code calls it via RPC.
-- Dropping the function also removes its EXECUTE grants.

drop function if exists public.create_referral_reward();

notify pgrst, 'reload schema';
