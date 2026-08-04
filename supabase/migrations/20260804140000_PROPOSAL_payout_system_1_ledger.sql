-- ============================================================================
-- Migration PROPOSAL — Payout System 1: the append-only double-entry ledger,
-- `center_payouts`, the immutable approval log, the provider-event sink, the
-- reconciliation periods, and the four SECURITY DEFINER RPCs that are the sole
-- writers of payout state.
--
-- ****************************************************************************
-- * NOT APPLIED — Eyad applies this by hand.                                  *
-- *                                                                            *
-- * CLAUDE.md rule 5: migrations are a manual apply to production. Supabase   *
-- * Branching auto-applies to PREVIEW branches only, never to production on   *
-- * merge. Tested 15 July 2026: PR #159 merged as 80f82ba and the migration   *
-- * was still absent from the production catalog and from the production      *
-- * migration history 8 minutes later.                                        *
-- *                                                                            *
-- * NO CODE MAY READ ANY OBJECT BELOW until this has been applied and every   *
-- * table, column and function has been confirmed present in                  *
-- * information_schema / pg_proc. Building first is the F26 defect class and  *
-- * it has already caused one production outage (8 July, student detail).     *
-- *                                                                            *
-- * src/lib/collectionPayout/payoutEngine.ts is written to survive this file  *
-- * NOT being applied: every RPC call catches 42883 / 42P01 / PGRST202 /      *
-- * PGRST205 and converts it into a named `ledger_not_migrated` refusal. It   *
-- * never reports success.                                                    *
-- ****************************************************************************
--
-- Source of truth: design/PAYOUT-SYSTEM-SPEC.md, all nine decisions answered by
-- Eyad on 3 August 2026, §11.
--
-- ============================================================================
-- PRECONDITIONS — re-queried LIVE on 4 August 2026 immediately before writing
-- this file, against project lczmjpnbuhnsislcvzar, read-only.
-- ============================================================================
--
--   ledger_accounts ....................... ABSENT  (137-table enumeration)
--   ledger_transactions ................... ABSENT
--   ledger_entries ........................ ABSENT
--   center_payouts ........................ ABSENT
--   payout_provider_events ................ ABSENT
--   payout_approval_log ................... ABSENT
--   payout_reconciliation_periods ......... ABSENT
--
--   payout_requests ....................... PRESENT, 0 rows
--     columns: id, center_id, amount_requested, status, payment_method,
--              payment_details, requested_at, processed_at
--     CHECK payout_requests_status_check  status IN
--           ('pending','approved','paid','rejected')
--     CHECK payout_requests_amount_requested_nonneg  amount_requested >= 0
--     FK center_id -> centers(id) ON DELETE CASCADE
--     -- 'approved' exists in the CHECK and is UNREACHABLE: no writer of
--     -- `status` exists anywhere in src/. That is §2.1.
--
--   withdrawal_requests ................... PRESENT, 0 rows
--     columns: id, center_id, credits_deducted, cash_amount, fee_amount,
--              instapay_number (NOT NULL), status, requested_at, processed_at,
--              processed_by, notes
--     CHECK withdrawal_requests_status_check  status IN
--           ('pending','paid','rejected')     -- no 'approved' state at all
--     FK processed_by -> admin_users(id)
--
--   one_pending_withdrawal_per_center ..... ABSENT  (§2.2 fix)
--   one_open_payout_per_center ............ ABSENT  (§3 invariant 3)
--
--   permissions ........................... PRESENT, 0 rows
--     FK user_id -> admin_users(id) ON DELETE CASCADE
--     UNIQUE (user_id, permission)
--     -- CANNOT reference public.users. The §7.1 disjoint-domain invariant is
--     -- therefore structurally available today.
--
--   admin_users ........................... PRESENT, 2 rows
--     CHECK admin_users_role_check  role IN ('super_admin','admin',
--       'internal_admin','internal_viewer','sales_manager','sales_rep',
--       'support_agent','accountant','custom')
--
--   platform_config ....................... PRESENT, UNIQUE (key)
--     'digital_student_fee_collection.enabled' = false  ✅ ROW EXISTS,
--        updated_at 2026-06-19T21:14:03Z.
--        ⚠ PAYOUT-SYSTEM-SPEC.md §0 and §9 both say this key "has no row in
--        platform_config at all". THAT IS STALE. Behaviour is unchanged (still
--        dormant) but a plain INSERT would collide, so every seed below is an
--        ON CONFLICT DO NOTHING upsert.
--     'lesson_commission' = {"vat_pct":0.14,"teacher_pct":0,"customer_pct":0,
--                            "processing_flat":0}     -- all-zero == dormant
--     'payout_delegate_cap_minor' .......... ABSENT
--     'payout_delegate_window_cap_minor' ... ABSENT
--     'payout_releases_halted' ............. ABSENT
--
--   audit_log ............................. PRESENT
--     columns: id, center_id, user_id, action, entity_type, entity_id,
--              details, created_at
--     FK center_id -> centers(id) ON DELETE RESTRICT
--     FK user_id   -> users(id)   ON DELETE SET NULL
--     -- NOTE: user_id references public.users. A PLATFORM approver is an
--     -- admin_users row and CANNOT go in that column. The approval log below
--     -- carries the approver instead; audit_log gets the centre-side record.
--
--   centers ............................... 108 columns. credit_balance and
--     credit_reserved both numeric NOT NULL DEFAULT 0. instapay_number text.
--     NO national_id, NO verification_status, NO verified_at, NO verified_name,
--     NO valify_transaction_id, NO payout_name_matches, NO tax_status,
--     NO tax_card_number, NO collection_enabled. Verified by name sweep.
--
--   pg_proc (public) payout/credit domain:
--     reserve_credits_atomic(uuid,numeric)                   prosecdef = true
--     cancel_reservation_atomic(uuid,numeric)                prosecdef = true
--     spend_credits_atomic(uuid,numeric,uuid,text)           prosecdef = true
--     earn_credits_atomic(uuid,numeric,uuid,text)            prosecdef = true
--     enforce_payout_status_transition()                     prosecdef = false
--       -- a trigger fn on commission_payouts (internal STAFF commissions), NOT
--       -- on payout_requests. There is NO payout-approval RPC.
--
--   RLS: relrowsecurity = true on centers, users, teacher_center,
--     teacher_profiles, payout_requests, withdrawal_requests,
--     referral_commissions, platform_config, permissions, admin_users,
--     audit_log, credit_ledger. relforcerowsecurity = FALSE on every one, so
--     service_role and postgres bypass — §7.4.
--
-- ============================================================================
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
-- ============================================================================
--
--   * It does not add any verification column. Territory A owns those.
--   * It does not create a `tuition_held` or `parent_float` ledger account.
--     Adding one is the moment SYSTEM 2 starts, and System 2 is unspecced
--     (§9) and out of scope. See the gap note in
--     src/lib/collectionPayout/payoutStates.ts.
--   * It does not migrate the existing credit-spend path. Decision 4 chose
--     option (a) — migrate the spend path in the same PR — and that is a
--     separate, larger change that must not ride along inside a proposal Eyad
--     has not yet read. Until it happens the dual-authority window (attack A5)
--     is OPEN, and `payout_request_create` below therefore takes the SAME
--     `FOR UPDATE` lock on `centers` that `reserve_credits_atomic` takes, so
--     both consumers serialise. RECORDED AS A KNOWN GAP, not as solved.
--   * It does not add any table to /api/db's TABLE_SCOPE. §3 invariant 2:
--     ledger_transactions, ledger_entries and center_payouts must NEVER be
--     reachable through the proxy.
--
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Extensions this file relies on. pgcrypto is already installed (the hash
--    chain in part 5 uses digest()); this is an assertion, not an install.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') THEN
    RAISE EXCEPTION 'pgcrypto is required for the payout approval hash chain';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. LEDGER — append-only double entry. §3, Decision 3.
--
--    Every balance in this codebase today is either a mutable column
--    (centers.credit_balance) or a running aggregate recomputed on read. Both
--    are wrong here for one specific reason: a running aggregate SILENTLY
--    CHANGES when a historical row is amended. For a display balance that is
--    tolerable. For a figure that authorises money leaving a bank account, it
--    means the number you approved and the number you paid can differ with no
--    trace.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ledger_accounts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id   uuid NOT NULL REFERENCES public.centers(id) ON DELETE RESTRICT,
  kind        text NOT NULL,
  currency    text NOT NULL DEFAULT 'EGP',
  created_at  timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ledger_accounts_kind_check'
      AND conrelid = 'public.ledger_accounts'::regclass
  ) THEN
    ALTER TABLE public.ledger_accounts
      ADD CONSTRAINT ledger_accounts_kind_check CHECK (kind IN (
        'referral_earnings',
        'credit_balance',
        'payable',
        'paid_out',
        'reserve_withheld',
        'clawback_receivable',
        'paymob_budget',
        'platform_bank_instapay',
        'payout_fees'
        -- NO 'tuition_held'. That account is SYSTEM 2. §9.
      ));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ledger_accounts_currency_check'
      AND conrelid = 'public.ledger_accounts'::regclass
  ) THEN
    ALTER TABLE public.ledger_accounts
      ADD CONSTRAINT ledger_accounts_currency_check CHECK (currency = 'EGP');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ledger_accounts_center_kind_uniq
  ON public.ledger_accounts (center_id, kind);

-- The journal. Never UPDATEd, never DELETEd — enforced by the guard in part 6.
CREATE TABLE IF NOT EXISTS public.ledger_transactions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  -- Cairo calendar date, generated. Every user-visible window in this product
  -- is Cairo-time; storing the UTC instant alone would put a payout made at
  -- 01:00 Cairo on the previous day in every report.
  cairo_date       date GENERATED ALWAYS AS
                     (((occurred_at AT TIME ZONE 'Africa/Cairo'))::date) STORED,
  kind             text NOT NULL,
  center_id        uuid NOT NULL REFERENCES public.centers(id) ON DELETE RESTRICT,
  payout_id        uuid,
  reverses_id      uuid REFERENCES public.ledger_transactions(id),
  -- The ONLY dedup mechanism in the whole path. The provider offers none (§6).
  idempotency_key  text NOT NULL,
  actor            text,
  reason_key       text,
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- §4 critical implementation note: clearing attaches to the ORIGIN of the
  -- money, not to the sign of the entry. A reversal INHERITS the cleared_at of
  -- the transaction it reverses, or the centre's own returned money is
  -- invisible for another 7 days and can miss the quarterly window (attack A8).
  cleared_at       timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS ledger_transactions_idempotency_uniq
  ON public.ledger_transactions (idempotency_key);
CREATE INDEX IF NOT EXISTS ledger_transactions_center_idx
  ON public.ledger_transactions (center_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ledger_transactions_payout_idx
  ON public.ledger_transactions (payout_id) WHERE payout_id IS NOT NULL;

-- The postings. Every transaction's entries sum to ZERO — asserted in part 6.
CREATE TABLE IF NOT EXISTS public.ledger_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  uuid NOT NULL REFERENCES public.ledger_transactions(id) ON DELETE RESTRICT,
  account_id      uuid NOT NULL REFERENCES public.ledger_accounts(id) ON DELETE RESTRICT,
  -- PIASTRES. bigint. Never a float, never an EGP decimal. §3 invariant 1.
  amount_minor    bigint NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ledger_entries_transaction_idx
  ON public.ledger_entries (transaction_id);
CREATE INDEX IF NOT EXISTS ledger_entries_account_idx
  ON public.ledger_entries (account_id);

-- ---------------------------------------------------------------------------
-- 2. CENTER_PAYOUTS — one row per payout attempt.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.center_payouts (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id                uuid NOT NULL REFERENCES public.centers(id) ON DELETE RESTRICT,
  status                   text NOT NULL DEFAULT 'requested',
  source                   text NOT NULL,
  gross_minor              bigint NOT NULL,
  fee_minor                bigint NOT NULL DEFAULT 0,
  vat_minor                bigint NOT NULL DEFAULT 0,
  net_minor                bigint NOT NULL,
  rail                     text NOT NULL,

  -- IMMUTABLE DESTINATION SNAPSHOT, written at APPROVAL, UPDATE-blocked by the
  -- trigger in part 6. Attack A2: approval snapshots a destination on Jan 3,
  -- the owner changes centers.instapay_number on Jan 5, release on Jan 7 reads
  -- the LIVE destination and pays the new one. A change cooldown does not catch
  -- it, because the cooldown is evaluated at request time.
  snap_issuer              text,
  snap_msisdn              text,
  snap_bank_code           text,
  snap_account_or_iban     text,
  snap_full_name           text,

  client_reference_id      uuid NOT NULL DEFAULT gen_random_uuid(),
  client_reference         text NOT NULL,
  provider_transaction_id  text,

  -- The cap IN FORCE at approval, snapshotted. §7.3 item 3: the cap is
  -- changeable through a route with no CSRF, no audit row and no updated_by, so
  -- "the cap was 10,000 at the time of approval" is UNPROVABLE after the fact
  -- unless it is written onto the row.
  cap_in_force_minor       bigint,
  amount_compared_minor    bigint,

  requested_at             timestamptz NOT NULL DEFAULT now(),
  requested_by             uuid REFERENCES public.users(id) ON DELETE SET NULL,
  approved_by              uuid REFERENCES public.admin_users(id) ON DELETE RESTRICT,
  approved_at              timestamptz,
  submitted_at             timestamptz,
  settled_at               timestamptz,
  updated_at               timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'center_payouts_status_check'
      AND conrelid = 'public.center_payouts'::regclass
  ) THEN
    ALTER TABLE public.center_payouts
      ADD CONSTRAINT center_payouts_status_check CHECK (status IN (
        'requested', 'approved', 'submitting', 'submitted', 'indeterminate',
        'settled', 'settled_pending_bank', 'failed', 'returned', 'reversing'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'center_payouts_rail_check'
      AND conrelid = 'public.center_payouts'::regclass
  ) THEN
    -- The counter-account is DERIVED from this inside the transition RPC and is
    -- never passed by a caller. §3 invariant 5 / attack A6: hand-sent InstaPay
    -- posted against paymob_budget drifts the modelled float below reality, the
    -- low-float alarm fires, and finance tops up money that was never needed.
    ALTER TABLE public.center_payouts
      ADD CONSTRAINT center_payouts_rail_check
      CHECK (rail IN ('paymob_payouts', 'manual_instapay'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'center_payouts_source_check'
      AND conrelid = 'public.center_payouts'::regclass
  ) THEN
    ALTER TABLE public.center_payouts
      ADD CONSTRAINT center_payouts_source_check
      CHECK (source IN ('referral_earnings', 'credit_balance'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'center_payouts_money_nonneg'
      AND conrelid = 'public.center_payouts'::regclass
  ) THEN
    ALTER TABLE public.center_payouts
      ADD CONSTRAINT center_payouts_money_nonneg CHECK (
        gross_minor > 0 AND fee_minor >= 0 AND vat_minor >= 0 AND net_minor > 0
        AND net_minor <= gross_minor
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'center_payouts_approved_needs_snapshot'
      AND conrelid = 'public.center_payouts'::regclass
  ) THEN
    -- Once past 'requested' the destination snapshot and the cap snapshot must
    -- both be present. A payout cannot leave the queue without a record of what
    -- it was compared against and where it is going.
    ALTER TABLE public.center_payouts
      ADD CONSTRAINT center_payouts_approved_needs_snapshot CHECK (
        status = 'requested'
        OR (approved_by IS NOT NULL
            AND approved_at IS NOT NULL
            AND cap_in_force_minor IS NOT NULL
            AND amount_compared_minor IS NOT NULL
            AND (snap_msisdn IS NOT NULL OR snap_account_or_iban IS NOT NULL))
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS center_payouts_client_reference_uniq
  ON public.center_payouts (client_reference);
CREATE UNIQUE INDEX IF NOT EXISTS center_payouts_client_reference_id_uniq
  ON public.center_payouts (client_reference_id);
CREATE UNIQUE INDEX IF NOT EXISTS center_payouts_provider_txn_uniq
  ON public.center_payouts (provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;

-- §3 invariant 3, corrected by §7.2. The OPEN set is "everything that is not
-- terminal" — terminal is {settled, failed, returned}. `settled_pending_bank`
-- IS INCLUDED: that state means the bank has not moved this money yet and we
-- are still asking, so treating it as closed frees the slot while funds are in
-- flight (four Bank Card approvals in fifteen minutes = 39,996 EGP), and if the
-- §4 hold keys off the same set it also RELEASES THE HOLD, which is a
-- double-pay and not merely a cap evasion.
CREATE UNIQUE INDEX IF NOT EXISTS one_open_payout_per_center
  ON public.center_payouts (center_id)
  WHERE status IN ('requested', 'approved', 'submitting', 'submitted',
                   'indeterminate', 'settled_pending_bank', 'reversing');

CREATE INDEX IF NOT EXISTS center_payouts_queue_idx
  ON public.center_payouts (status, requested_at);

-- ---------------------------------------------------------------------------
-- 3. THE MISSING CONCURRENCY GUARD ON THE EXISTING TABLE. §2.2.
--
--    Verified live: withdrawal_requests has 0 rows, so this index covers zero
--    existing rows and cannot fail on create.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_withdrawal_per_center
  ON public.withdrawal_requests (center_id)
  WHERE status = 'pending';

-- payout_requests likewise. 0 rows live.
CREATE UNIQUE INDEX IF NOT EXISTS one_open_payout_request_per_center
  ON public.payout_requests (center_id)
  WHERE status IN ('pending', 'approved');

-- ---------------------------------------------------------------------------
-- 4. PROVIDER EVENT SINK — append-only. §6 rule 1 / attack A1.
--
--    A callback may ONLY enqueue an inquiry job. It may never write a ledger
--    entry, never call a transition RPC, never move a payout state. That is
--    enforced STRUCTURALLY by the grants at the foot of this file: the callback
--    role has INSERT here and NOTHING on the ledger or payout tables.
--
--    Attack A1 in full: the payout HMAC is OFF BY DEFAULT at Paymob and must be
--    requested from the account manager by email; the algorithm, field order
--    and transport are UNDOCUMENTED (§8 question 4). A centre owner can see
--    their own payout's transaction_id on their own detail screen. They POST a
--    fabricated disbursement_status:"failed" for a payout that already settled,
--    the handler credits their balance back, and they repeat per historical
--    payout. Unbounded, repeatable, no credentials beyond their own session.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.payout_provider_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source             text NOT NULL,
  raw_body           jsonb NOT NULL,
  received_at        timestamptz NOT NULL DEFAULT now(),
  -- Whether the HMAC verified. A row with false is KEPT, not discarded: an
  -- unverified callback is evidence of an attempt and must be visible.
  hmac_verified      boolean NOT NULL DEFAULT false,
  matched_payout_id  uuid REFERENCES public.center_payouts(id) ON DELETE SET NULL,
  -- Set when the reconciliation sweep has acted on this event. NULL = queued.
  inquiry_enqueued_at timestamptz,
  processing_error   text
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payout_provider_events_source_check'
      AND conrelid = 'public.payout_provider_events'::regclass
  ) THEN
    ALTER TABLE public.payout_provider_events
      ADD CONSTRAINT payout_provider_events_source_check
      CHECK (source IN ('callback', 'inquiry', 'budget_inquiry', 'topup_inquiry'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS payout_provider_events_unprocessed_idx
  ON public.payout_provider_events (received_at)
  WHERE inquiry_enqueued_at IS NULL;

-- ---------------------------------------------------------------------------
-- 5. THE IMMUTABLE APPROVAL LOG, with a hash chain. §7.4.
--
--    ⚠ HONEST LIMIT, stated rather than recorded as met. "Never deletable,
--    including by the CEO" CANNOT be delivered as stated. The CEO holds the
--    Supabase dashboard and therefore the `postgres` role, and nothing that
--    runs inside Postgres can stop the owner of Postgres: guard triggers are
--    defeated by TRUNCATE (row triggers do not fire), by DROP TRIGGER, or by
--    re-granting privileges. RLS is irrelevant — service_role and postgres both
--    carry rolbypassrls and FORCE ROW LEVEL SECURITY is off. Event triggers
--    that could block a DROP TRIGGER require superuser, which Supabase does not
--    grant.
--
--    What IS achievable is TAMPER-EVIDENT: a hash chain makes silent EDITS
--    detectable. It proves nothing while its head lives in the same database it
--    protects. Decided 3 August: the chain head goes to an EXTERNAL SINK whose
--    credential Eyad alone holds and which the application cannot reach. That
--    makes publication an OUT-OF-BAND act, so the PUBLICATION CADENCE IS THE
--    TAMPER-DETECTION WINDOW. A missed publication silently widens it and
--    nothing in-system can alert on it — the system cannot see the sink.
--
--    The honest claim: the log is tamper-evident with a detection window equal
--    to the publication interval, provided Eyad publishes on schedule.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.payout_approval_log (
  seq                    bigserial PRIMARY KEY,
  payout_id              uuid NOT NULL REFERENCES public.center_payouts(id) ON DELETE RESTRICT,
  center_id              uuid NOT NULL REFERENCES public.centers(id) ON DELETE RESTRICT,
  -- The approver is an admin_users row. §7.1 disjoint-domain invariant: no
  -- public.users row may ever hold payout approval authority, so this column
  -- deliberately CANNOT reference public.users.
  approver_admin_user_id uuid NOT NULL REFERENCES public.admin_users(id) ON DELETE RESTRICT,
  approver_tier          text NOT NULL,
  -- §7.5: NOT NULL so the distinction is PROVABLE after the fact rather than
  -- inferred. 'env_phone' is refused by the RPC, but the column exists so that
  -- a future path which accepts it cannot be silently indistinguishable.
  authority_source       text NOT NULL,
  amount_compared_minor  bigint NOT NULL,
  gross_minor            bigint NOT NULL,
  fee_minor              bigint NOT NULL,
  vat_minor              bigint NOT NULL,
  net_minor              bigint NOT NULL,
  cap_in_force_minor     bigint NOT NULL,
  window_approved_minor  bigint NOT NULL,
  destination_digest     text NOT NULL,
  is_resend              boolean NOT NULL DEFAULT false,
  step_up_verified       boolean NOT NULL,
  outcome                text NOT NULL,
  -- Server clock only. NOT caller-supplied: audit_log.created_at is
  -- caller-supplied on at least one live writer with no BEFORE INSERT trigger,
  -- so rows can be backdated today. That is not repeated here.
  created_at             timestamptz NOT NULL DEFAULT now(),
  prev_row_hash          text,
  row_hash               text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payout_approval_log_tier_check'
      AND conrelid = 'public.payout_approval_log'::regclass
  ) THEN
    ALTER TABLE public.payout_approval_log
      ADD CONSTRAINT payout_approval_log_tier_check
      CHECK (approver_tier IN ('ceo', 'delegate'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payout_approval_log_authority_check'
      AND conrelid = 'public.payout_approval_log'::regclass
  ) THEN
    ALTER TABLE public.payout_approval_log
      ADD CONSTRAINT payout_approval_log_authority_check
      CHECK (authority_source IN ('db_row', 'env_phone'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payout_approval_log_outcome_check'
      AND conrelid = 'public.payout_approval_log'::regclass
  ) THEN
    ALTER TABLE public.payout_approval_log
      ADD CONSTRAINT payout_approval_log_outcome_check
      CHECK (outcome IN ('approved', 'refused_cap', 'refused_authority', 'revoked_sweep'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS payout_approval_log_window_idx
  ON public.payout_approval_log (center_id, created_at DESC)
  WHERE outcome = 'approved';

-- ---------------------------------------------------------------------------
-- 6. GUARD TRIGGERS. Mirrors the existing guard_transactions_lifecycle
--    precedent. Effective against service_role; NOT against postgres (§7.4).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.chq_block_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'ledger rows are append-only: % on %.% is blocked. Post a reversing transaction instead.',
    TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = '42501';
END $$;

DROP TRIGGER IF EXISTS chq_ledger_transactions_append_only ON public.ledger_transactions;
CREATE TRIGGER chq_ledger_transactions_append_only
  BEFORE UPDATE OR DELETE ON public.ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION public.chq_block_ledger_mutation();

DROP TRIGGER IF EXISTS chq_ledger_entries_append_only ON public.ledger_entries;
CREATE TRIGGER chq_ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON public.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.chq_block_ledger_mutation();

DROP TRIGGER IF EXISTS chq_payout_approval_log_append_only ON public.payout_approval_log;
CREATE TRIGGER chq_payout_approval_log_append_only
  BEFORE UPDATE OR DELETE ON public.payout_approval_log
  FOR EACH ROW EXECUTE FUNCTION public.chq_block_ledger_mutation();

DROP TRIGGER IF EXISTS chq_payout_provider_events_append_only ON public.payout_provider_events;
CREATE TRIGGER chq_payout_provider_events_append_only
  BEFORE DELETE ON public.payout_provider_events
  FOR EACH ROW EXECUTE FUNCTION public.chq_block_ledger_mutation();

-- center_payouts: amounts, references, destination snapshot and status may only
-- change through the transition RPC, which sets a transaction-local flag.
CREATE OR REPLACE FUNCTION public.chq_guard_center_payouts()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'center_payouts rows are never deleted' USING ERRCODE = '42501';
  END IF;

  IF coalesce(current_setting('chq.payout_transition', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.gross_minor IS DISTINCT FROM OLD.gross_minor
     OR NEW.fee_minor IS DISTINCT FROM OLD.fee_minor
     OR NEW.vat_minor IS DISTINCT FROM OLD.vat_minor
     OR NEW.net_minor IS DISTINCT FROM OLD.net_minor
     OR NEW.rail IS DISTINCT FROM OLD.rail
     OR NEW.client_reference IS DISTINCT FROM OLD.client_reference
     OR NEW.client_reference_id IS DISTINCT FROM OLD.client_reference_id
     OR NEW.provider_transaction_id IS DISTINCT FROM OLD.provider_transaction_id
     OR NEW.cap_in_force_minor IS DISTINCT FROM OLD.cap_in_force_minor
     OR NEW.amount_compared_minor IS DISTINCT FROM OLD.amount_compared_minor
     OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
     OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
  THEN
    RAISE EXCEPTION
      'center_payouts amounts, status, references and approval may only change through payout_transition/payout_approve'
      USING ERRCODE = '42501';
  END IF;

  -- The destination snapshot is immutable once written. Attack A2.
  IF (OLD.snap_msisdn IS NOT NULL AND NEW.snap_msisdn IS DISTINCT FROM OLD.snap_msisdn)
     OR (OLD.snap_account_or_iban IS NOT NULL
         AND NEW.snap_account_or_iban IS DISTINCT FROM OLD.snap_account_or_iban)
     OR (OLD.snap_full_name IS NOT NULL
         AND NEW.snap_full_name IS DISTINCT FROM OLD.snap_full_name)
     OR (OLD.snap_bank_code IS NOT NULL
         AND NEW.snap_bank_code IS DISTINCT FROM OLD.snap_bank_code)
     OR (OLD.snap_issuer IS NOT NULL AND NEW.snap_issuer IS DISTINCT FROM OLD.snap_issuer)
  THEN
    RAISE EXCEPTION 'center_payouts destination snapshot is immutable' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS chq_center_payouts_guard ON public.center_payouts;
CREATE TRIGGER chq_center_payouts_guard
  BEFORE UPDATE OR DELETE ON public.center_payouts
  FOR EACH ROW EXECUTE FUNCTION public.chq_guard_center_payouts();

-- Double-entry balance assertion: a transaction's entries must sum to zero.
-- DEFERRED to statement end so a multi-entry insert is legal.
CREATE OR REPLACE FUNCTION public.chq_assert_ledger_balanced()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  bad record;
BEGIN
  FOR bad IN
    SELECT e.transaction_id, sum(e.amount_minor) AS s
    FROM public.ledger_entries e
    WHERE e.transaction_id IN (SELECT transaction_id FROM new_entries)
    GROUP BY e.transaction_id
    HAVING sum(e.amount_minor) <> 0
  LOOP
    RAISE EXCEPTION 'ledger transaction % does not balance: sum(amount_minor) = %',
      bad.transaction_id, bad.s USING ERRCODE = '23514';
  END LOOP;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS chq_ledger_entries_balanced ON public.ledger_entries;
CREATE TRIGGER chq_ledger_entries_balanced
  AFTER INSERT ON public.ledger_entries
  REFERENCING NEW TABLE AS new_entries
  FOR EACH STATEMENT EXECUTE FUNCTION public.chq_assert_ledger_balanced();

-- Hash chain over the approval log.
CREATE OR REPLACE FUNCTION public.chq_payout_approval_chain()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  prev text;
BEGIN
  SELECT row_hash INTO prev
  FROM public.payout_approval_log
  ORDER BY seq DESC
  LIMIT 1;

  NEW.created_at := now();          -- server clock only; never caller-supplied
  NEW.prev_row_hash := prev;
  NEW.row_hash := encode(digest(
    coalesce(prev, '') || '|' ||
    NEW.payout_id::text || '|' ||
    NEW.approver_admin_user_id::text || '|' ||
    NEW.approver_tier || '|' ||
    NEW.authority_source || '|' ||
    NEW.amount_compared_minor::text || '|' ||
    NEW.cap_in_force_minor::text || '|' ||
    NEW.destination_digest || '|' ||
    NEW.outcome || '|' ||
    NEW.created_at::text,
    'sha256'), 'hex');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS chq_payout_approval_log_chain ON public.payout_approval_log;
CREATE TRIGGER chq_payout_approval_log_chain
  BEFORE INSERT ON public.payout_approval_log
  FOR EACH ROW EXECUTE FUNCTION public.chq_payout_approval_chain();

-- ---------------------------------------------------------------------------
-- 7. RECONCILIATION PERIODS. Attack A13.
--    One immutable row per Cairo month. A period CANNOT be closed while the
--    unexplained delta is non-zero; closing with variance requires a named
--    human and a written reason.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.payout_reconciliation_periods (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Cairo month, first day. Cairo, not UTC: a period boundary computed in UTC
  -- puts the last two hours of a Cairo month in the next one.
  cairo_month              date NOT NULL,
  opening_budget_minor     bigint,
  closing_budget_minor     bigint,
  topups_minor             bigint NOT NULL DEFAULT 0,
  settled_minor            bigint NOT NULL DEFAULT 0,
  fees_minor               bigint NOT NULL DEFAULT 0,
  vat_minor                bigint NOT NULL DEFAULT 0,
  returned_minor           bigint NOT NULL DEFAULT 0,
  unexplained_delta_minor  bigint,
  closed_at                timestamptz,
  closed_by                uuid REFERENCES public.admin_users(id) ON DELETE RESTRICT,
  closed_with_variance_reason text,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS payout_reconciliation_periods_month_uniq
  ON public.payout_reconciliation_periods (cairo_month);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payout_recon_close_requires_zero_or_reason'
      AND conrelid = 'public.payout_reconciliation_periods'::regclass
  ) THEN
    ALTER TABLE public.payout_reconciliation_periods
      ADD CONSTRAINT payout_recon_close_requires_zero_or_reason CHECK (
        closed_at IS NULL
        OR (closed_by IS NOT NULL
            AND (coalesce(unexplained_delta_minor, 0) = 0
                 OR (closed_with_variance_reason IS NOT NULL
                     AND length(btrim(closed_with_variance_reason)) >= 20)))
      );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 8. RLS. Every new table ships its policy in the same proposal.
--
--    ⚠ relforcerowsecurity is FALSE across this database and service_role
--    carries rolbypassrls, so these policies bind the `authenticated` role
--    only. They are NOT the tenancy control for service-role code paths — that
--    is the server-side center_id derivation in the API layer. Stated so nobody
--    reads a policy here as a guarantee it is not.
-- ---------------------------------------------------------------------------

ALTER TABLE public.ledger_accounts               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_transactions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.center_payouts                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_provider_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_approval_log           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_reconciliation_periods ENABLE ROW LEVEL SECURITY;

-- A centre may READ its own ledger accounts and its own payouts. Nothing more:
-- no INSERT, no UPDATE, no DELETE policy exists for `authenticated` on any of
-- these tables, so writes are service-role only, through the RPCs.
DROP POLICY IF EXISTS ledger_accounts_center_read ON public.ledger_accounts;
CREATE POLICY ledger_accounts_center_read ON public.ledger_accounts
  FOR SELECT TO authenticated
  USING (center_id = (SELECT u.center_id FROM public.users u WHERE u.id = auth.uid()));

DROP POLICY IF EXISTS ledger_transactions_center_read ON public.ledger_transactions;
CREATE POLICY ledger_transactions_center_read ON public.ledger_transactions
  FOR SELECT TO authenticated
  USING (center_id = (SELECT u.center_id FROM public.users u WHERE u.id = auth.uid()));

DROP POLICY IF EXISTS ledger_entries_center_read ON public.ledger_entries;
CREATE POLICY ledger_entries_center_read ON public.ledger_entries
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.ledger_accounts a
    JOIN public.users u ON u.id = auth.uid()
    WHERE a.id = ledger_entries.account_id AND a.center_id = u.center_id
  ));

DROP POLICY IF EXISTS center_payouts_center_read ON public.center_payouts;
CREATE POLICY center_payouts_center_read ON public.center_payouts
  FOR SELECT TO authenticated
  USING (center_id = (SELECT u.center_id FROM public.users u WHERE u.id = auth.uid()));

-- The provider event sink, the approval log and the reconciliation periods are
-- PLATFORM records. No `authenticated` policy at all — RLS enabled with zero
-- policies denies every row to that role, which is the intent. A centre owner
-- seeing raw provider callbacks is how attack A1 gets its transaction_id.

-- ---------------------------------------------------------------------------
-- 9. THE RPCS. SECURITY DEFINER. The SOLE writers of payout state.
--    REVOKE ALL FROM anon, authenticated; grant service_role only.
-- ---------------------------------------------------------------------------

-- 9a. available_minor(center) — §4.
--
-- ⚠ DELIBERATE DIVERGENCE FROM §4's PROSE FORMULA, and it is a correction.
--
-- §4 writes the figure as a GROSS-MINUS-DEDUCTIONS view:
--   available = SUM(payable) − SUM(open holds) − SUM(reserve_withheld)
--                            − SUM(clawback_receivable)
-- That is the right ANSWER but the wrong ARITHMETIC once the postings are
-- double entry, because it DOUBLE-COUNTS. A hold is a balanced transaction:
-- it debits `payable` by X and credits `reserve_withheld` by X. Summing the
-- signed entries on both accounts and then ALSO subtracting reserve_withheld
-- takes the same X off twice, and `available` goes negative on a centre whose
-- only activity is one open hold.
--
-- In double entry the deduction is already IN the payable account, because
-- everything that reduces the centre's claim debits it. So the correct
-- expression is the signed sum over `payable` alone. Holds, reserve
-- withholdings and clawbacks all reach it through their own balanced
-- transactions and none is subtracted a second time.
--
-- Verify this after applying, on a centre with one open hold:
--   payable sum should equal (accrued − held), and payout_available_minor
--   should equal that same figure, not (accrued − 2×held).
CREATE OR REPLACE FUNCTION public.payout_available_minor(p_center_id uuid)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(sum(e.amount_minor), 0)::bigint
  FROM public.ledger_entries e
  JOIN public.ledger_accounts a ON a.id = e.account_id
  JOIN public.ledger_transactions t ON t.id = e.transaction_id
  WHERE a.center_id = p_center_id
    AND a.kind = 'payable'
    -- Clearing: an entry counts only once cleared. §5 decision: 0 days for
    -- credits, 7 days for newly accrued referral commission, config-driven.
    -- A reversal INHERITS the cleared_at of what it reverses (attack A8), which
    -- is why this reads t.cleared_at and never t.occurred_at. Reading
    -- occurred_at would make a centre's own returned money invisible for
    -- another 7 days and it could miss the quarterly window entirely.
    AND t.cleared_at IS NOT NULL
    AND t.cleared_at <= now();
$$;

-- 9b. Create a request. ONE transaction, advisory-locked per centre.
CREATE OR REPLACE FUNCTION public.payout_request_create(
  p_center_id             uuid,
  p_requested_gross_minor bigint,
  p_source                text,
  p_rail                  text,
  p_requested_by          uuid,
  p_idempotency_key       text
)
RETURNS TABLE (payout_id uuid, status text, requested_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing   public.center_payouts%ROWTYPE;
  v_available  bigint;
  v_payable    uuid;
  v_hold       uuid;
  v_txn        uuid;
  v_payout     uuid;
  v_ref        text;
BEGIN
  IF p_requested_gross_minor IS NULL OR p_requested_gross_minor <= 0 THEN
    RAISE EXCEPTION 'payout_gross_must_be_positive' USING ERRCODE = '22023';
  END IF;

  -- §3 invariant 4: the balance read and the hold insert are ONE transaction,
  -- serialized per centre. Attack A3: two submissions 40ms apart each SELECT
  -- SUM -> 5,000 before either commits, and both pass.
  PERFORM pg_advisory_xact_lock(hashtext('payout:' || p_center_id::text));

  -- Serialise against the LEGACY credit rail too. Decision 4 has not been
  -- executed yet, so centers.credit_balance and this ledger are both
  -- authoritative over the same credits — attack A5. Taking the same FOR UPDATE
  -- lock that reserve_credits_atomic takes keeps both consumers in a line.
  PERFORM 1 FROM public.centers WHERE id = p_center_id FOR UPDATE;

  -- Idempotent re-call: the same key returns the same payout, not a second one.
  SELECT cp.* INTO v_existing
  FROM public.center_payouts cp
  JOIN public.ledger_transactions lt ON lt.payout_id = cp.id
  WHERE lt.idempotency_key = p_idempotency_key
  LIMIT 1;
  IF FOUND THEN
    RETURN QUERY SELECT v_existing.id, v_existing.status, v_existing.requested_at;
    RETURN;
  END IF;

  v_available := public.payout_available_minor(p_center_id);
  IF v_available < p_requested_gross_minor THEN
    RAISE EXCEPTION 'payout_insufficient_available:%:%', v_available, p_requested_gross_minor
      USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_payable FROM public.ledger_accounts
    WHERE center_id = p_center_id AND kind = 'payable';
  IF v_payable IS NULL THEN
    INSERT INTO public.ledger_accounts (center_id, kind) VALUES (p_center_id, 'payable')
      RETURNING id INTO v_payable;
  END IF;

  SELECT id INTO v_hold FROM public.ledger_accounts
    WHERE center_id = p_center_id AND kind = 'reserve_withheld';
  IF v_hold IS NULL THEN
    INSERT INTO public.ledger_accounts (center_id, kind) VALUES (p_center_id, 'reserve_withheld')
      RETURNING id INTO v_hold;
  END IF;

  v_ref := 'CHQ-PO-' || to_char(now() AT TIME ZONE 'Africa/Cairo', 'YYYYMMDD') || '-'
           || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);

  INSERT INTO public.center_payouts (
    center_id, status, source, gross_minor, net_minor, rail,
    client_reference, requested_by
  ) VALUES (
    p_center_id, 'requested', p_source, p_requested_gross_minor,
    p_requested_gross_minor, p_rail, v_ref, p_requested_by
  ) RETURNING id INTO v_payout;

  INSERT INTO public.ledger_transactions (
    kind, center_id, payout_id, idempotency_key, actor, reason_key, cleared_at
  ) VALUES (
    'payout_hold', p_center_id, v_payout, p_idempotency_key,
    coalesce(p_requested_by::text, 'system'), 'payout.hold', now()
  ) RETURNING id INTO v_txn;

  -- Double entry: move the amount out of payable and into the hold account.
  INSERT INTO public.ledger_entries (transaction_id, account_id, amount_minor) VALUES
    (v_txn, v_payable, -p_requested_gross_minor),
    (v_txn, v_hold,     p_requested_gross_minor);

  INSERT INTO public.audit_log (center_id, user_id, action, entity_type, entity_id, details)
  VALUES (p_center_id, p_requested_by, 'payout.requested', 'center_payouts', v_payout,
          jsonb_build_object('gross_minor', p_requested_gross_minor,
                             'source', p_source, 'rail', p_rail,
                             'client_reference', v_ref));

  RETURN QUERY
    SELECT cp.id, cp.status, cp.requested_at
    FROM public.center_payouts cp WHERE cp.id = v_payout;
END $$;

-- 9c. Approve. The SOLE writer of approval state.
--     Reads the amount FROM THE LOCKED ROW, not from a parameter. Resolves the
--     actor's tier server-side. Reads the cap in-transaction. Fails closed.
--     Writes the log in the SAME transaction — if the log fails, the approval
--     fails (§7.4 non-negotiable).
CREATE OR REPLACE FUNCTION public.payout_approve(
  p_payout_id                uuid,
  p_approver_admin_user_id   uuid,
  p_authority_source         text,
  p_is_resend                boolean,
  p_step_up_verified         boolean,
  p_idempotency_key          text
)
RETURNS TABLE (payout_id uuid, status text, amount_compared_minor bigint, cap_in_force_minor bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_p            public.center_payouts%ROWTYPE;
  v_role         text;
  v_has_perm     boolean;
  v_tier         text;
  v_cap          bigint;
  v_window_cap   bigint;
  v_window_sum   bigint;
  v_amount       bigint;
  v_dest_digest  text;
  v_instapay     text;
BEGIN
  IF p_step_up_verified IS NOT TRUE THEN
    RAISE EXCEPTION 'payout_step_up_required' USING ERRCODE = '42501';
  END IF;

  -- §7.5: env-phone authority is refused outright. A super-admin minted by
  -- appending to SUPER_ADMIN_PHONES has no database row, and the log would
  -- record an approver uuid matching no row in any table.
  IF p_authority_source IS DISTINCT FROM 'db_row' THEN
    RAISE EXCEPTION 'payout_env_phone_authority_refused' USING ERRCODE = '42501';
  END IF;

  SELECT au.role INTO v_role FROM public.admin_users au WHERE au.id = p_approver_admin_user_id;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'payout_approver_has_no_admin_row' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.permissions pm
    WHERE pm.user_id = p_approver_admin_user_id
      AND pm.permission = 'can_approve_payouts'
      AND pm.enabled IS TRUE
  ) INTO v_has_perm;

  v_tier := CASE
    WHEN v_role = 'super_admin' THEN 'ceo'
    WHEN v_has_perm THEN 'delegate'
    ELSE NULL
  END;
  IF v_tier IS NULL THEN
    RAISE EXCEPTION 'payout_not_an_approver' USING ERRCODE = '42501';
  END IF;

  -- Locking read. Everything below reads THIS row, never a parameter.
  SELECT * INTO v_p FROM public.center_payouts WHERE id = p_payout_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payout_not_found' USING ERRCODE = '02000';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('payout:' || v_p.center_id::text));

  -- Idempotent re-call: already approved is a success, not a second approval.
  IF v_p.status = 'approved' THEN
    RETURN QUERY SELECT v_p.id, v_p.status, v_p.amount_compared_minor, v_p.cap_in_force_minor;
    RETURN;
  END IF;
  IF v_p.status NOT IN ('requested', 'indeterminate') THEN
    RAISE EXCEPTION 'payout_illegal_transition_%_to_approved', v_p.status USING ERRCODE = '22023';
  END IF;

  -- §7.2: the cap is compared against the REQUESTED GROSS, before any fee, VAT
  -- or credit-conversion arithmetic. The permissive net_minor reading would let
  -- a gross of 10,546.31 through a 10,000 cap.
  v_amount := v_p.gross_minor;

  -- A resend requires reading ambiguous provider evidence against an
  -- irrevocable rail with no idempotency key. CEO-only, at any amount.
  IF p_is_resend AND v_tier <> 'ceo' THEN
    RAISE EXCEPTION 'payout_resend_requires_ceo' USING ERRCODE = '42501';
  END IF;

  SELECT (value #>> '{}')::bigint INTO v_cap
    FROM public.platform_config WHERE key = 'payout_delegate_cap_minor';
  SELECT (value #>> '{}')::bigint INTO v_window_cap
    FROM public.platform_config WHERE key = 'payout_delegate_window_cap_minor';

  IF v_tier = 'delegate' THEN
    -- FAIL CLOSED: no configured cap means no delegated approval at all.
    IF v_cap IS NULL OR v_cap <= 0 OR v_window_cap IS NULL OR v_window_cap <= 0 THEN
      RAISE EXCEPTION 'payout_delegate_cap_unset' USING ERRCODE = '42501';
    END IF;

    IF v_amount >= v_cap THEN
      RAISE EXCEPTION 'payout_over_per_payout_cap:%:%', v_amount, v_cap USING ERRCODE = '42501';
    END IF;

    -- Rolling 7 days: a MOVING window, not date_trunc('week', ...). A calendar
    -- week hands back a fresh cap every Monday, which is the same splitting
    -- hole with a longer period. The window sums APPROVALS, not settlements.
    SELECT coalesce(sum(l.amount_compared_minor), 0)::bigint INTO v_window_sum
    FROM public.payout_approval_log l
    WHERE l.center_id = v_p.center_id
      AND l.outcome = 'approved'
      AND l.created_at > now() - interval '7 days';

    -- Includes the payout being approved. SUM(existing) > cap permits 19,999.
    IF v_window_sum + v_amount > v_window_cap THEN
      RAISE EXCEPTION 'payout_over_rolling_window_cap:%:%', v_window_sum + v_amount, v_window_cap
        USING ERRCODE = '42501';
    END IF;
  ELSE
    -- The CEO approves any amount. The cap in force is still snapshotted so the
    -- record shows what the check looked at.
    v_cap := coalesce(v_cap, 0);
    SELECT coalesce(sum(l.amount_compared_minor), 0)::bigint INTO v_window_sum
    FROM public.payout_approval_log l
    WHERE l.center_id = v_p.center_id AND l.outcome = 'approved'
      AND l.created_at > now() - interval '7 days';
  END IF;

  -- Destination snapshot, taken NOW and immutable thereafter. Attack A2.
  SELECT btrim(coalesce(c.instapay_number, '')) INTO v_instapay
    FROM public.centers c WHERE c.id = v_p.center_id;
  IF v_instapay IS NULL OR v_instapay = '' THEN
    RAISE EXCEPTION 'payout_no_destination_on_file' USING ERRCODE = '22023';
  END IF;
  v_dest_digest := encode(digest(v_instapay, 'sha256'), 'hex');

  PERFORM set_config('chq.payout_transition', 'on', true);

  UPDATE public.center_payouts SET
    status                = 'approved',
    approved_by           = p_approver_admin_user_id,
    approved_at           = now(),
    cap_in_force_minor    = v_cap,
    amount_compared_minor = v_amount,
    snap_issuer           = 'instapay',
    snap_msisdn           = v_instapay,
    updated_at            = now()
  WHERE id = v_p.id;

  PERFORM set_config('chq.payout_transition', 'off', true);

  -- SAME TRANSACTION. If this insert fails, the approval fails.
  INSERT INTO public.payout_approval_log (
    payout_id, center_id, approver_admin_user_id, approver_tier, authority_source,
    amount_compared_minor, gross_minor, fee_minor, vat_minor, net_minor,
    cap_in_force_minor, window_approved_minor, destination_digest,
    is_resend, step_up_verified, outcome
  ) VALUES (
    v_p.id, v_p.center_id, p_approver_admin_user_id, v_tier, 'db_row',
    v_amount, v_p.gross_minor, v_p.fee_minor, v_p.vat_minor, v_p.net_minor,
    v_cap, v_window_sum, v_dest_digest,
    coalesce(p_is_resend, false), true, 'approved'
  );

  INSERT INTO public.audit_log (center_id, user_id, action, entity_type, entity_id, details)
  VALUES (v_p.center_id, NULL, 'payout.approved', 'center_payouts', v_p.id,
          jsonb_build_object('tier', v_tier, 'amount_compared_minor', v_amount,
                             'cap_in_force_minor', v_cap,
                             'idempotency_key', p_idempotency_key));

  RETURN QUERY SELECT v_p.id, 'approved'::text, v_amount, v_cap;
END $$;

-- 9d. Transition. The sole writer of every OTHER state change.
CREATE OR REPLACE FUNCTION public.payout_transition(
  p_payout_id              uuid,
  p_to_status              text,
  p_actor_admin_user_id    uuid,
  p_idempotency_key        text
)
RETURNS TABLE (payout_id uuid, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_p       public.center_payouts%ROWTYPE;
  v_allowed text[];
BEGIN
  SELECT * INTO v_p FROM public.center_payouts WHERE id = p_payout_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payout_not_found' USING ERRCODE = '02000';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('payout:' || v_p.center_id::text));

  IF v_p.status = p_to_status THEN            -- idempotent re-call
    RETURN QUERY SELECT v_p.id, v_p.status;
    RETURN;
  END IF;

  v_allowed := CASE v_p.status
    WHEN 'requested'            THEN ARRAY['approved','failed']
    WHEN 'approved'             THEN ARRAY['submitting','requested','failed']
    WHEN 'submitting'           THEN ARRAY['submitted','indeterminate','failed']
    WHEN 'submitted'            THEN ARRAY['settled','settled_pending_bank','indeterminate','failed']
    WHEN 'indeterminate'        THEN ARRAY['settled','settled_pending_bank','failed','approved']
    WHEN 'settled'              THEN ARRAY['reversing','returned']
    WHEN 'settled_pending_bank' THEN ARRAY['settled','returned','failed']
    WHEN 'reversing'            THEN ARRAY['settled','returned']
    ELSE ARRAY[]::text[]
  END;

  IF NOT (p_to_status = ANY (v_allowed)) THEN
    RAISE EXCEPTION 'payout_illegal_transition_%_to_%', v_p.status, p_to_status
      USING ERRCODE = '22023';
  END IF;

  -- §7.3 item 2: authority is RE-EVALUATED at every transition that can still
  -- move money. A manager approves eight payouts, the CEO revokes two hours
  -- later believing the exposure is closed, and the release job pays them all
  -- two days on unless this check exists.
  IF p_to_status = 'submitting' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.admin_users au
      WHERE au.id = v_p.approved_by
        AND (au.role = 'super_admin'
             OR EXISTS (SELECT 1 FROM public.permissions pm
                        WHERE pm.user_id = au.id
                          AND pm.permission = 'can_approve_payouts'
                          AND pm.enabled IS TRUE))
    ) THEN
      RAISE EXCEPTION 'payout_approver_authority_revoked' USING ERRCODE = '42501';
    END IF;
  END IF;

  PERFORM set_config('chq.payout_transition', 'on', true);
  UPDATE public.center_payouts SET
    status       = p_to_status,
    submitted_at = CASE WHEN p_to_status = 'submitted' THEN now() ELSE submitted_at END,
    settled_at   = CASE WHEN p_to_status = 'settled'   THEN now() ELSE settled_at END,
    updated_at   = now()
  WHERE id = v_p.id;
  PERFORM set_config('chq.payout_transition', 'off', true);

  INSERT INTO public.audit_log (center_id, user_id, action, entity_type, entity_id, details)
  VALUES (v_p.center_id, NULL, 'payout.transition', 'center_payouts', v_p.id,
          jsonb_build_object('from', v_p.status, 'to', p_to_status,
                             'actor_admin_user_id', p_actor_admin_user_id,
                             'idempotency_key', p_idempotency_key));

  RETURN QUERY SELECT v_p.id, p_to_status;
END $$;

-- 9e. The §2.2 fix for the EXISTING credit-withdrawal path: one RPC doing
--     SELECT ... FOR UPDATE, idempotent re-call, release + spend + status flip
--     + audit_log in ONE transaction. This replaces four un-transacted round
--     trips in src/app/api/admin/withdrawals/[id]/route.ts.
CREATE OR REPLACE FUNCTION public.withdrawal_mark_paid_atomic(
  p_withdrawal_id  uuid,
  p_admin_user_id  uuid,
  p_notes          text
)
RETURNS TABLE (withdrawal_id uuid, status text, already_processed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_w public.withdrawal_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_w FROM public.withdrawal_requests WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'withdrawal_not_found' USING ERRCODE = '02000';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('payout:' || v_w.center_id::text));
  PERFORM 1 FROM public.centers WHERE id = v_w.center_id FOR UPDATE;

  -- Idempotent: the second of two concurrent callers gets already_processed
  -- = true and the caller MUST NOT fire a second WhatsApp on it.
  IF v_w.status = 'paid' THEN
    RETURN QUERY SELECT v_w.id, v_w.status, true;
    RETURN;
  END IF;
  IF v_w.status <> 'pending' THEN
    RAISE EXCEPTION 'withdrawal_not_pending:%', v_w.status USING ERRCODE = '22023';
  END IF;

  PERFORM public.cancel_reservation_atomic(v_w.center_id, v_w.credits_deducted);
  IF NOT public.spend_credits_atomic(v_w.center_id, v_w.credits_deducted,
                                     v_w.id, 'withdrawal') THEN
    -- One transaction, so the cancel above rolls back with it. The old code
    -- released the reservation and then failed the spend, restoring the full
    -- balance as immediately re-withdrawable WHILE THE CASH WAS ALREADY SENT.
    RAISE EXCEPTION 'withdrawal_spend_failed' USING ERRCODE = '22023';
  END IF;

  UPDATE public.withdrawal_requests SET
    status = 'paid', processed_at = now(), processed_by = p_admin_user_id,
    notes = coalesce(nullif(btrim(coalesce(p_notes, '')), ''), notes)
  WHERE id = v_w.id;

  INSERT INTO public.audit_log (center_id, user_id, action, entity_type, entity_id, details)
  VALUES (v_w.center_id, NULL, 'withdrawal.paid', 'withdrawal_requests', v_w.id,
          jsonb_build_object('credits_deducted', v_w.credits_deducted,
                             'cash_amount', v_w.cash_amount,
                             'admin_user_id', p_admin_user_id));

  RETURN QUERY SELECT v_w.id, 'paid'::text, false;
END $$;

-- 9f. Enable online collection for a principal.
--     Deliberately writes a platform_config-keyed row rather than a new column
--     on `centers`, so this proposal does not alter the 108-column centres
--     table for a feature that is still gated on Territory A.
CREATE TABLE IF NOT EXISTS public.collection_enablement (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_kind text NOT NULL,
  center_id      uuid REFERENCES public.centers(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  enabled_at     timestamptz NOT NULL DEFAULT now(),
  disabled_at    timestamptz
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'collection_enablement_kind_check'
      AND conrelid = 'public.collection_enablement'::regclass
  ) THEN
    ALTER TABLE public.collection_enablement
      ADD CONSTRAINT collection_enablement_kind_check
      CHECK (principal_kind IN ('center', 'teacher'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'collection_enablement_center_required_for_center'
      AND conrelid = 'public.collection_enablement'::regclass
  ) THEN
    -- Teachers are centre-less by design (users.center_id NULL, linked through
    -- teacher_center). That is not a bug and is not "fixed" here.
    ALTER TABLE public.collection_enablement
      ADD CONSTRAINT collection_enablement_center_required_for_center
      CHECK (principal_kind <> 'center' OR center_id IS NOT NULL);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS collection_enablement_active_uniq
  ON public.collection_enablement (user_id) WHERE disabled_at IS NULL;

ALTER TABLE public.collection_enablement ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS collection_enablement_self_read ON public.collection_enablement;
CREATE POLICY collection_enablement_self_read ON public.collection_enablement
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.collection_enable_for_principal(
  p_center_id      uuid,
  p_user_id        uuid,
  p_principal_kind text
)
RETURNS TABLE (enablement_id uuid, enabled_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  -- FAIL CLOSED at the database too, not only in the API layer. The platform
  -- switch must be explicitly true.
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_config
    WHERE key = 'digital_student_fee_collection.enabled' AND value = 'true'::jsonb
  ) THEN
    RAISE EXCEPTION 'collection_switch_off' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.collection_enablement (principal_kind, center_id, user_id)
  VALUES (p_principal_kind, p_center_id, p_user_id)
  ON CONFLICT (user_id) WHERE disabled_at IS NULL DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT ce.id INTO v_id FROM public.collection_enablement ce
    WHERE ce.user_id = p_user_id AND ce.disabled_at IS NULL;
  END IF;

  INSERT INTO public.audit_log (center_id, user_id, action, entity_type, entity_id, details)
  VALUES (p_center_id, p_user_id, 'collection.enabled', 'collection_enablement', v_id,
          jsonb_build_object('principal_kind', p_principal_kind));

  RETURN QUERY SELECT ce.id, ce.enabled_at FROM public.collection_enablement ce WHERE ce.id = v_id;
END $$;

-- ---------------------------------------------------------------------------
-- 10. GRANTS. §7.1: REVOKE ALL FROM anon, authenticated; service_role only.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.payout_available_minor(uuid)                        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payout_request_create(uuid,bigint,text,text,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payout_approve(uuid,uuid,text,boolean,boolean,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payout_transition(uuid,text,uuid,text)              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.withdrawal_mark_paid_atomic(uuid,uuid,text)         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collection_enable_for_principal(uuid,uuid,text)     FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.payout_available_minor(uuid)                        TO service_role;
GRANT EXECUTE ON FUNCTION public.payout_request_create(uuid,bigint,text,text,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.payout_approve(uuid,uuid,text,boolean,boolean,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.payout_transition(uuid,text,uuid,text)              TO service_role;
GRANT EXECUTE ON FUNCTION public.withdrawal_mark_paid_atomic(uuid,uuid,text)         TO service_role;
GRANT EXECUTE ON FUNCTION public.collection_enable_for_principal(uuid,uuid,text)     TO service_role;

-- Writes to the ledger and payout tables go through the RPCs only.
REVOKE INSERT, UPDATE, DELETE ON public.ledger_accounts, public.ledger_transactions,
  public.ledger_entries, public.center_payouts, public.payout_approval_log
  FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 11. CONFIG SEEDS. Every one an ON CONFLICT DO NOTHING upsert, because
--     'digital_student_fee_collection.enabled' ALREADY EXISTS (verified live)
--     and platform_config has UNIQUE (key). A plain INSERT would abort the
--     whole migration.
--
--     The caps seed as EXPLICIT NULL-equivalents, NOT as 10,000 EGP. Seeding a
--     working cap here would silently enable delegated approval the moment this
--     migration is applied, before Eyad has granted anyone the permission. He
--     sets the numbers deliberately.
-- ---------------------------------------------------------------------------
INSERT INTO public.platform_config (key, value) VALUES
  ('payout_delegate_cap_minor',        'null'::jsonb),
  ('payout_delegate_window_cap_minor', 'null'::jsonb),
  -- Kill switch. Seeds HALTED. Releases require an explicit flip to false.
  ('payout_releases_halted',           'true'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Attack A12: `vercel.json` schedules 42 crons while src/app/api/cron contains
-- 43 route directories, and the watchdog only iterates cron_health_log rows
-- that ALREADY EXIST — so a cron that never ran once is invisible to it. Seed
-- the health row in the same migration that ships the cron.
INSERT INTO public.cron_health_log (cron_name, last_success_at, expected_interval_minutes)
VALUES ('payout-reconciliation', now(), 360)
ON CONFLICT (cron_name) DO NOTHING;

COMMIT;

-- ============================================================================
-- POST-APPLY VERIFICATION — run these and read the output before deploying any
-- code that touches these objects. schema_migrations is bookkeeping, not proof.
-- ============================================================================
--
-- select table_name, column_name from information_schema.columns
--  where table_schema='public'
--    and table_name in ('ledger_accounts','ledger_transactions','ledger_entries',
--                       'center_payouts','payout_provider_events',
--                       'payout_approval_log','payout_reconciliation_periods',
--                       'collection_enablement')
--  order by table_name, ordinal_position;
--
-- select proname, prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--  where n.nspname='public'
--    and proname in ('payout_available_minor','payout_request_create','payout_approve',
--                    'payout_transition','withdrawal_mark_paid_atomic',
--                    'collection_enable_for_principal');
--
-- select indexname from pg_indexes where schemaname='public'
--   and indexname in ('one_open_payout_per_center','one_pending_withdrawal_per_center',
--                     'one_open_payout_request_per_center');
--
-- ============================================================================
-- WHAT REMAINS BLOCKED AFTER THIS IS APPLIED — applying it does NOT enable
-- payouts. All of these are still required:
--   1. THE CONFIG POINT (src/lib/collectionPayout/config.ts) still holds
--      placeholders. No rail credentials exist; Paymob Payouts onboarding is
--      manual on their side and has not started (§8).
--   2. The payout callback HMAC is off by default at Paymob and its algorithm,
--      field order and transport are undocumented (§8 question 4).
--   3. Territory A (verification) has not landed. No principal can be verified.
--   4. Decision 4 — migrating the credit-spend path off centers.credit_balance
--      — has not been executed. The dual-authority window (A5) is open.
--   5. The seven questions to Paymob in §8 have no written answers.
--   6. The delegate caps seed as null and the kill switch seeds as HALTED.
-- ============================================================================
