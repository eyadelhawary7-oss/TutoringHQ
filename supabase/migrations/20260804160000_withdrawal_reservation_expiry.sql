-- =============================================================================
-- NOT APPLIED — Eyad applies this by hand.
--
-- PROPOSAL ONLY. Nothing in this file has been run against production
-- (lczmjpnbuhnsislcvzar) or against any branch. The sweeper shipped alongside
-- it (src/lib/withdrawalReservationSweep.ts +
-- src/app/api/cron/sweep-withdrawal-reservations/route.ts) works against the
-- schema AS IT EXISTS TODAY and does not depend on any of this. Applying this
-- file is an improvement, not a prerequisite.
--
-- PAYOUT-SYSTEM-SPEC.md §2.5 — credit reservations never expire.
-- =============================================================================
--
-- PRECONDITIONS, VERIFIED LIVE 2026-08-04 (read-only queries, no writes):
--
--   information_schema.columns, public.withdrawal_requests — 11 columns:
--     id uuid NOT NULL default gen_random_uuid()
--     center_id uuid NOT NULL
--     credits_deducted numeric NOT NULL
--     cash_amount numeric NOT NULL
--     fee_amount numeric NOT NULL
--     instapay_number text NOT NULL
--     status text NOT NULL default 'pending'
--     requested_at timestamptz NULL default now()
--     processed_at timestamptz NULL
--     processed_by uuid NULL
--     notes text NULL
--   → There is NO expiry column, NO reserved-amount column, and NO
--     released-at column. Confirmed by direct catalog read, not by inference.
--
--   pg_constraint on public.withdrawal_requests:
--     withdrawal_requests_pkey            PRIMARY KEY (id)
--     withdrawal_requests_center_id_fkey  FK -> centers(id) ON DELETE CASCADE
--     withdrawal_requests_processed_by_fkey FK -> admin_users(id)
--     withdrawal_requests_money_nonneg    CHECK (cash_amount >= 0 AND
--                                               credits_deducted >= 0 AND
--                                               fee_amount >= 0)
--     withdrawal_requests_status_check    CHECK (status = ANY
--                                               (ARRAY['pending','paid','rejected']))
--   → 'expired' is NOT an allowed status today. This is the single fact that
--     forces the shipped sweeper to write 'rejected'.
--
--   pg_proc, public.reserve_credits_atomic(uuid, numeric):
--     SECURITY DEFINER; asserts caller center access; SELECT ... FOR UPDATE on
--     centers; UPDATE centers SET credit_reserved = credit_reserved + p_amount.
--     Writes NO credit_ledger row and records NO expiry and NO owning entity.
--   pg_proc, public.cancel_reservation_atomic(uuid, numeric):
--     UPDATE centers SET credit_reserved = GREATEST(0, credit_reserved - p_amount).
--     Amount-based, not request-based — it cannot tell which reservation it is
--     releasing, which is why double-release silently underflows to zero.
--
--   Live data at the time of writing:
--     SELECT count(*) FROM withdrawal_requests            -> 0
--     SELECT count(*) FROM withdrawal_requests WHERE
--            status = 'pending'                           -> 0
--     SELECT id, credit_balance, credit_reserved FROM centers -> 2 rows,
--            credit_reserved = 0.00 on both
--   → ZERO rows are fenced today and no centre has any reserved credit. The
--     defect is latent, not live. That makes this the cheapest possible moment
--     to apply it: the backfill below touches nothing.
--
-- =============================================================================
-- WHAT THIS PROPOSES AND WHY
--
-- 1. withdrawal_requests.reservation_expires_at — makes the fence's lifetime a
--    property of the row instead of a rule recomputed in application code. The
--    shipped sweeper derives the same instant from requested_at and the
--    quarterly calendar every run; a column lets an operator see, sort and
--    override it, and lets a future unified pipeline read one authoritative
--    value rather than re-deriving it in a second place.
--
-- 2. withdrawal_requests.reservation_released_at — the fence and the request
--    status are two different facts. Today 'rejected' has to carry both, so
--    "status flipped but cancel_reservation_atomic failed" is invisible in the
--    table and only discoverable from audit_log. This column makes the sweeper
--    idempotent on the reservation itself rather than on the status, and makes
--    the stuck case queryable: status <> 'pending' AND reservation_released_at
--    IS NULL.
--
-- 3. 'expired' added to withdrawal_requests_status_check — 'rejected' means a
--    human looked at the request and declined it. Auto-release is a different
--    event and should not be indistinguishable from a decision. Once this is
--    applied, change the shipped sweeper's terminal status from 'rejected' to
--    'expired' (one constant) and add 'expired' to the admin withdrawals UI
--    filter. NOT before — writing 'expired' against the current constraint
--    fails every row.
--
-- 4. A partial unique index enforcing one pending withdrawal per centre. The
--    request route checks this with a non-locking .maybeSingle() read, which
--    two concurrent requests both pass (§2.2 / attack A3). This is the DB-side
--    guard the spec asks for at §2.2. It is included here because the backfill
--    is free while the table is empty; it will NOT create later if duplicate
--    pending rows have accumulated, so apply it early.
--
-- Everything is guarded: IF NOT EXISTS on every ADD COLUMN and CREATE INDEX,
-- DO-block existence checks around every constraint change. Re-running this
-- file is a no-op.
-- =============================================================================

BEGIN;

-- 1 ---------------------------------------------------------------------------
ALTER TABLE public.withdrawal_requests
  ADD COLUMN IF NOT EXISTS reservation_expires_at timestamptz;

COMMENT ON COLUMN public.withdrawal_requests.reservation_expires_at IS
  'PAYOUT-SYSTEM-SPEC.md 2.5. Cairo-derived instant after which the credit '
  'reservation behind this request may be released by '
  'cron/sweep-withdrawal-reservations. Default = close of the quarterly '
  'withdrawal window the request was made in (day 14 of Jan/Apr/Jul/Oct, '
  'Africa/Cairo) plus a 14-day grace. NULL means "derive it in code", which is '
  'what the sweeper does today.';

-- 2 ---------------------------------------------------------------------------
ALTER TABLE public.withdrawal_requests
  ADD COLUMN IF NOT EXISTS reservation_released_at timestamptz;

COMMENT ON COLUMN public.withdrawal_requests.reservation_released_at IS
  'PAYOUT-SYSTEM-SPEC.md 2.5. Set when cancel_reservation_atomic has actually '
  'returned for this request. Distinct from status: a row with a terminal '
  'status and a NULL value here is a fence that was never released and needs a '
  'human.';

-- 3 ---------------------------------------------------------------------------
-- Widen the status CHECK to admit 'expired'. Guarded: only replaced if the
-- constraint exists in its current 3-value form, so re-running is inert and a
-- constraint someone has already widened is left alone.
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
  FROM pg_constraint
  WHERE conrelid = 'public.withdrawal_requests'::regclass
    AND conname = 'withdrawal_requests_status_check';

  IF v_def IS NULL THEN
    ALTER TABLE public.withdrawal_requests
      ADD CONSTRAINT withdrawal_requests_status_check
      CHECK (status = ANY (ARRAY['pending', 'paid', 'rejected', 'expired']));
  ELSIF position('expired' in v_def) = 0 THEN
    ALTER TABLE public.withdrawal_requests
      DROP CONSTRAINT withdrawal_requests_status_check;
    ALTER TABLE public.withdrawal_requests
      ADD CONSTRAINT withdrawal_requests_status_check
      CHECK (status = ANY (ARRAY['pending', 'paid', 'rejected', 'expired']));
  END IF;
END
$$;

-- 4 ---------------------------------------------------------------------------
-- One pending withdrawal per centre (PAYOUT-SYSTEM-SPEC.md 2.2, attack A3).
-- Guarded by a duplicate check: creating this while duplicates exist would
-- fail the whole migration, so skip and shout instead.
DO $$
DECLARE
  v_dupes bigint;
BEGIN
  SELECT count(*) INTO v_dupes
  FROM (
    SELECT center_id
    FROM public.withdrawal_requests
    WHERE status = 'pending'
    GROUP BY center_id
    HAVING count(*) > 1
  ) d;

  IF v_dupes > 0 THEN
    RAISE WARNING
      'one_pending_withdrawal_per_center NOT created: % centre(s) already hold '
      'multiple pending withdrawal_requests. Resolve them, then re-run this file.',
      v_dupes;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS one_pending_withdrawal_per_center
      ON public.withdrawal_requests (center_id)
      WHERE status = 'pending';
  END IF;
END
$$;

-- 5 ---------------------------------------------------------------------------
-- Sweeper lookup index. The sweeper scans pending rows by requested_at.
CREATE INDEX IF NOT EXISTS withdrawal_requests_pending_requested_at_idx
  ON public.withdrawal_requests (requested_at)
  WHERE status = 'pending';

-- 6 ---------------------------------------------------------------------------
-- Backfill. Verified live: 0 rows in withdrawal_requests, so this is a no-op
-- today and is written only so the file stays correct if applied later.
-- The expression mirrors src/lib/withdrawalReservationSweep.ts exactly:
--   window close = day 14 of the request's quarter month (Africa/Cairo),
--                  or the request's own Cairo date if that is later,
--   expiry       = window close + 14 days.
UPDATE public.withdrawal_requests w
SET reservation_expires_at = (
      GREATEST(
        CASE
          WHEN date_part('month', (w.requested_at AT TIME ZONE 'Africa/Cairo')) IN (1, 4, 7, 10)
            THEN date_trunc('month', (w.requested_at AT TIME ZONE 'Africa/Cairo'))::date + 13
          ELSE (w.requested_at AT TIME ZONE 'Africa/Cairo')::date
        END,
        (w.requested_at AT TIME ZONE 'Africa/Cairo')::date
      ) + 14
    )::timestamp AT TIME ZONE 'Africa/Cairo'
WHERE w.reservation_expires_at IS NULL
  AND w.requested_at IS NOT NULL;

-- 7 ---------------------------------------------------------------------------
-- Seed the watchdog health row so a cron that has never run once is still
-- visible to it (attack A12: the watchdog only iterates rows that already
-- exist, and expected_interval_minutes is NOT NULL with no default).
INSERT INTO public.cron_health_log (cron_name, last_success_at, failure_count, expected_interval_minutes)
VALUES ('sweep-withdrawal-reservations', now(), 0, 1440)
ON CONFLICT (cron_name) DO NOTHING;

COMMIT;

-- =============================================================================
-- POST-APPLY VERIFICATION (run these, do not assume):
--
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='withdrawal_requests'
--      AND column_name IN ('reservation_expires_at','reservation_released_at');
--   -- expect 2 rows
--
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid='public.withdrawal_requests'::regclass
--      AND conname='withdrawal_requests_status_check';
--   -- expect the 4-value list including 'expired'
--
--   SELECT indexname FROM pg_indexes
--    WHERE schemaname='public' AND tablename='withdrawal_requests';
--   -- expect one_pending_withdrawal_per_center (unless the WARNING fired)
--
--   SELECT cron_name, expected_interval_minutes FROM cron_health_log
--    WHERE cron_name='sweep-withdrawal-reservations';
--
-- ONLY AFTER all four pass: flip the sweeper's terminal status constant from
-- 'rejected' to 'expired', teach it to write reservation_released_at, and add
-- 'expired' to the admin withdrawals filter. In that order, in a separate PR.
--
-- db/schema.snapshot is NOT regenerated by this branch — that requires applying
-- the migration, which this branch must not do.
-- =============================================================================
