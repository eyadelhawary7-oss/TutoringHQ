-- Job 3 (Part 2/4/5) — the single-day billing lockout.
--
-- HELD. This migration is NOT applied to production by merging. On this project
-- migrations are applied to production BY HAND (see CLAUDE.md working rule 4 and
-- docs/briefs/2026-07-17_job3_billing_lockout_held.md). Apply it, confirm the
-- objects exist in the live catalog, THEN let the code deploy. The whole lockout
-- policy stays inert until PAYMOB_RECURRING_INTEGRATION_ID is a real credential
-- AND summer.first_charge_release is flipped to RELEASED; nothing here changes any
-- amount or locks any centre on its own.
--
-- Everything below is idempotent and safe to re-run.

begin;

-- 1. Per-Cairo-day idempotency ledger for the lockout tick. Server-managed only:
--    RLS on with ZERO policies (deny-by-default), the same posture as the other
--    billing internals (card_charge_intents, billing_nudges, ...). Only the
--    service-role cron writes it.
create table if not exists public.billing_lockout_events (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid not null references public.centers(id) on delete cascade,
  -- Cairo calendar date (YYYY-MM-DD) the event belongs to. The lockout is anchored
  -- to the Cairo day, so idempotency is keyed on this, not on a UTC timestamp.
  cairo_day   date not null,
  -- 'invoice_nudge' | 'retry' | 'reminder2' | 'lock'
  event_type  text not null,
  -- retry only: 0-based attempt index within the day.
  attempt_index integer,
  -- retry only: did this attempt settle the bill?
  succeeded   boolean,
  created_at  timestamptz not null default now()
);

comment on table public.billing_lockout_events is
  'Job 3 Part 2: per-Cairo-day idempotency ledger for the single-day lockout cron. Server-managed (RLS on, zero policies).';

-- One invoice_nudge / reminder2 / lock per centre per Cairo day. Retries are not
-- unique-constrained (several per day) but are capped in code by
-- subscription_dunning_max_attempts.
create unique index if not exists billing_lockout_events_oneshot_uq
  on public.billing_lockout_events (center_id, cairo_day, event_type)
  where event_type in ('invoice_nudge', 'reminder2', 'lock');

create index if not exists billing_lockout_events_center_day_idx
  on public.billing_lockout_events (center_id, cairo_day);

alter table public.billing_lockout_events enable row level security;
-- Intentionally NO policies: deny-by-default. service_role (BYPASSRLS) is the only
-- writer. Do not add permissive policies.

-- 2. Seed the tunable lockout knobs. WHERE NOT EXISTS so a value tuned later from
--    the admin panel is never overwritten by a re-run.
insert into public.platform_config (key, value)
select 'billing.lockout.enabled', 'true'::jsonb
where not exists (select 1 from public.platform_config where key = 'billing.lockout.enabled');

insert into public.platform_config (key, value)
select 'billing.lockout.retry_times_cairo', '["09:00","14:00","19:00"]'::jsonb
where not exists (select 1 from public.platform_config where key = 'billing.lockout.retry_times_cairo');

insert into public.platform_config (key, value)
select 'billing.lockout.reminder_time_cairo', '"17:00"'::jsonb
where not exists (select 1 from public.platform_config where key = 'billing.lockout.reminder_time_cairo');

-- 3. Part 5: the summer pay window shrinks from 2 days to 1 (single-day lock).
--    Authorised by the Job 3 brief for summer.pay_window_days ONLY.
update public.platform_config
set value = '1'::jsonb, updated_at = now()
where key = 'summer.pay_window_days';

-- 4. Part 4: remove the five dead late-fee keys. Under the single-day lock the
--    first late fee triggered on day 4 overdue but the account is closed on day 1,
--    so they are unreachable. Invoice columns (late_fee_rate, late_fee_amount,
--    days_overdue) are LEFT in place; column drops are a separate decision.
delete from public.platform_config
where key in (
  'late_fee_grace_days',
  'late_fee_tier1_rate',
  'late_fee_tier1_trigger_day',
  'late_fee_tier2_rate',
  'late_fee_tier2_trigger_day'
);

commit;
