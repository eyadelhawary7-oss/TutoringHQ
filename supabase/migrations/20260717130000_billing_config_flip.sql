-- Job 3 (PR F) -- the config flip. Timing/config only; NO amount changes.
--
-- HELD. Do NOT apply via CI or by merging. Apply BY HAND to production, confirm the
-- values in the live catalog, then let the deploy proceed. Merge this LAST (after
-- A-E): summer.pay_window_days is read by the existing summer billing code
-- (src/lib/summer/dates.ts, src/lib/summerBillingCron.ts), which is NOT behind the new
-- auto-charge interlock. Setting it to 1 before the rest lands would move a live lock
-- day earlier under code nothing protects.
--
-- Neither change has a down migration. The pre-change values are recorded in the PR
-- description so there is a manual recovery path. Verified live 2026-07-17:
--   summer.pay_window_days = 2
--   late_fee_grace_days = "3", late_fee_tier1_rate = "0.05",
--   late_fee_tier1_trigger_day = "4", late_fee_tier2_rate = "0.10",
--   late_fee_tier2_trigger_day = "9"
--
-- Idempotent and safe to re-run.

begin;

-- Part 5: the summer pay window shrinks from 2 days to 1 (single-day lock). Authorised
-- by the Job 3 brief for summer.pay_window_days ONLY.
update public.platform_config
set value = '1'::jsonb, updated_at = now()
where key = 'summer.pay_window_days';

-- Part 4: remove the five dead late-fee keys. Under the single-day lock the first late
-- fee triggered on day 4 overdue, but the account is closed on day 1, so they are
-- unreachable. Nothing reads them once the admin config editor's late-fee branches are
-- removed (this PR). The invoice columns late_fee_rate, late_fee_amount and
-- days_overdue are LEFT in place; column drops are a separate decision.
delete from public.platform_config
where key in (
  'late_fee_grace_days',
  'late_fee_tier1_rate',
  'late_fee_tier1_trigger_day',
  'late_fee_tier2_rate',
  'late_fee_tier2_trigger_day'
);

commit;
