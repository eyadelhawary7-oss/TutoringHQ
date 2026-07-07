-- Backfill: correct annual centers mis-activated by bug C1 (annual signups
-- activated on a MONTHLY clock).
--
-- Root cause (fixed in code alongside this migration):
--   src/app/api/signup/route.ts pinned subscription_billing_period only for
--   monthly signups; annual signups fell through to the column's DB default of
--   'monthly' (migration 20260705050120). The activation path resolves cadence
--   as `subscription_billing_period ?? billing_period`, so an annual center was
--   charged the full annual amount up front but activated with
--   next_payment_due = start + 30d. The renewal cron keys off next_payment_due,
--   so it re-invoiced a full year ~23 days in — a double charge.
--
-- This migration is IDEMPOTENT and SELF-GUARDING (safe to re-run):
--   Step 1 fixes the cadence column for every annual center not already 'yearly'.
--   Step 2 repairs the billing clock ONLY for rows carrying the monthly-bug
--           signature (due set 0..31 days after start). After the fix the gap is
--           365 days, so the WHERE no longer matches and re-runs are no-ops.
--
-- Verified against production (project CenterHQ) on 2026-07-07 immediately
-- before apply: 0 matching rows (the centers table held only 2 test, monthly
-- centers). This runs as a no-op safety net today and guards any annual center
-- created before the code fix reaches production.
--
-- The subscription_billing_period CHECK allows only {'monthly','yearly'}; annual
-- is spelled 'yearly' on this column (billing_period uses 'annual').

-- Step 1 — pin the cadence column to the correct spelling for annual centers.
UPDATE public.centers
SET subscription_billing_period = 'yearly'
WHERE billing_period = 'annual'
  AND subscription_billing_period IS DISTINCT FROM 'yearly';

-- Step 2 — repair the billing clock for the mis-activated (+30d) rows.
--   next_payment_due -> subscription_start_date + 365 days
--   auto_suspend_at  -> the day AFTER the corrected due (single-day lock model;
--                       erring one day lenient never locks a paid-up annual
--                       customer early). All three columns are DATE type.
-- The tight 0..31 day guard ensures a correctly anchored annual due (gap ~365)
-- is never clobbered.
UPDATE public.centers
SET
  next_payment_due = subscription_start_date + 365,
  auto_suspend_at  = subscription_start_date + 366
WHERE billing_period = 'annual'
  AND subscription_start_date IS NOT NULL
  AND next_payment_due IS NOT NULL
  AND (next_payment_due - subscription_start_date) BETWEEN 0 AND 31;
