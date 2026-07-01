-- Teacher annual billing — store the chosen billing interval on the subscription.
--
-- Teachers can now subscribe Monthly or Annual. Annual = price_gross × the shared
-- pricing.interval.annual_multiplier (=10, "true 2 months free"), the SAME source
-- centers use — there is no second multiplier.
--
-- 'monthly' is the default, so every existing subscription (and the summer-held
-- path) keeps its exact current behavior; only a row explicitly set to 'annual'
-- bills the ×10 amount on a 12-month cycle. The Scale +20/student overage is
-- unaffected and stays a monthly true-up even on annual.
alter table public.teacher_subscriptions
  add column if not exists billing_interval text not null default 'monthly';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'teacher_subscriptions_billing_interval_check'
      and conrelid = 'public.teacher_subscriptions'::regclass
  ) then
    alter table public.teacher_subscriptions
      add constraint teacher_subscriptions_billing_interval_check
      check (billing_interval in ('monthly', 'annual'));
  end if;
end $$;

notify pgrst, 'reload schema';
