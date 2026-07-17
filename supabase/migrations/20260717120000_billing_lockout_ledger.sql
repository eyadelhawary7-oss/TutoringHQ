-- Job 3 (PR B) -- the single-day billing lockout idempotency ledger.
--
-- HELD. This migration is NOT applied to production by merging. On this project
-- migrations are applied to production BY HAND (see CLAUDE.md working rule 4). Apply
-- it, confirm the objects exist in the live catalog, THEN let the code deploy. The
-- whole lockout policy stays inert until PAYMOB_RECURRING_INTEGRATION_ID is a real
-- credential AND summer.first_charge_release is flipped to RELEASED; nothing here
-- changes any amount or locks any centre on its own.
--
-- Config changes are intentionally NOT here. summer.pay_window_days (2 -> 1) and the
-- five late_fee_* key deletes are PR F. The billing.lockout.* knobs are read with
-- code defaults when absent, so no seed row is required for the policy to be safe
-- (the kill switch defaults to ENABLED, and it is still gated by the auto-charge
-- interlock and by first_charge_release). Seeding those knobs so they are tunable in
-- the admin panel is a separate, optional follow-up, not required for correctness.
--
-- The migration-history repair (production recorded the tax-snapshot migration as
-- 20260715214425 rather than 20260715140000) is a one-row bookkeeping UPDATE with no
-- DDL. It is NOT in this file; it is documented as a manual step in the PR
-- description, with the exact SQL and the live verification queries.
--
-- Everything below is idempotent and safe to re-run.

begin;

-- Per-Cairo-day idempotency ledger for the lockout tick (PR C consumes it). Server-
-- managed only: RLS on with ZERO policies (deny-by-default), the same posture as the
-- other billing internals (card_charge_intents, billing_nudges). Only the service-
-- role cron writes it.
create table if not exists public.billing_lockout_events (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references public.centers(id) on delete cascade,
  -- Cairo calendar date (YYYY-MM-DD) the event belongs to. The lockout is anchored to
  -- the Cairo day, so idempotency is keyed on this, not on a UTC timestamp; that is
  -- what survives both DST edges (the spring-forward 00:00 that never occurs and the
  -- fall-back 23:00 that repeats both map to a single cairo_day).
  cairo_day     date not null,
  -- 'invoice_nudge' | 'retry' | 'reminder2' | 'lock'
  event_type    text not null,
  -- retry only: 0-based attempt index within the day.
  attempt_index integer,
  -- retry only: did this attempt settle the bill?
  succeeded     boolean,
  created_at    timestamptz not null default now()
);

comment on table public.billing_lockout_events is
  'Job 3: per-Cairo-day idempotency ledger for the single-day lockout cron. Server-managed (RLS on, zero policies).';

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

commit;
