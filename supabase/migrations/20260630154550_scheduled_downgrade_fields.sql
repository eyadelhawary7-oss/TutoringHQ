-- Scheduled downgrades (centers + teachers). A downgrade no longer applies
-- immediately and grants no credit; it is recorded here and applied by the
-- recurring engine at the next renewal (G1/G3). NULL = no pending downgrade.
alter table public.centers
  add column if not exists scheduled_plan text,
  add column if not exists scheduled_billing_period text;

alter table public.teacher_subscriptions
  add column if not exists scheduled_plan_key text,
  add column if not exists scheduled_billing_interval text;

notify pgrst, 'reload schema';
