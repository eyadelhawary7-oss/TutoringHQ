-- Flip the centers billing-period defaults to monthly and tighten the CHECKs to the
-- pricing rule (monthly + annual only). Quarterly is fully retired: the database can
-- no longer DEFAULT to it, and no new row may STORE it. Annual is left exactly as-is,
-- including each column's value quirk — billing_period uses 'annual';
-- subscription_billing_period uses 'yearly' ('annual' was never a valid value there).
--
-- Safe by construction: the only two live rows are test centers already on 'monthly',
-- with zero non-test rows and zero quarterly rows, so no existing row violates the
-- tighter CHECKs (verified against live prod immediately before apply). The two code
-- paths that used to write 'quarterly' to these columns (admin manual-approve, PAYG->
-- fixed switch cron) are updated in the same change.

-- 1. Defaults: quarterly -> monthly on both period columns.
alter table public.centers alter column billing_period set default 'monthly';
alter table public.centers alter column subscription_billing_period set default 'monthly';

-- 2. Tighten CHECKs to monthly + annual, keeping each column's annual spelling.
alter table public.centers drop constraint if exists centers_billing_period_check;
alter table public.centers add constraint centers_billing_period_check
  check (billing_period = any (array['monthly'::text, 'annual'::text]));

alter table public.centers drop constraint if exists centers_subscription_billing_period_check;
alter table public.centers add constraint centers_subscription_billing_period_check
  check (subscription_billing_period = any (array['monthly'::text, 'yearly'::text]));

notify pgrst, 'reload schema';
