-- ============================================================================
-- Migration proposal — identity-verification state columns (Valify e-KYC).
--
-- ****************************************************************************
-- * NOT APPLIED — Eyad applies this by hand.                                  *
-- * CLAUDE.md rule 5: migrations are a manual apply to production. Merging    *
-- * this file does NOT apply it (tested 15 July 2026: PR #159 merged as       *
-- * 80f82ba and the columns were still absent from the production catalog     *
-- * 8 minutes later). Apply, confirm in information_schema.columns, THEN let  *
-- * the code deploy.                                                          *
-- ****************************************************************************
--
-- SAFE TO MERGE UNAPPLIED, WHICH IS UNUSUAL — SAY WHY.
-- Normally "code reads a column that does not exist" is the F26 outage class.
-- Not here. `src/lib/verification/readVerificationState.ts` treats a PostgREST
-- undefined-column error (42703 / PGRST204) as the EXPECTED answer and maps it
-- to `stateSourceAvailable: false`, which every surface renders as
-- "Verification unavailable" with a named cause. The application is correct
-- both before and after this migration; applying it changes the answer from
-- "we cannot tell you" to a real status. Nothing needs redeploying to flip.
--
-- PRECONDITIONS, re-queried live 4 August 2026 immediately before writing this
-- (project lczmjpnbuhnsislcvzar, read-only):
--   centers ............................. 128 columns, 2 rows
--   teacher_profiles .................... 24 columns, 3 rows
--   verification columns on centers ..... 0 of 6
--   verification columns on teacher_prof  0 of 6
--   type `verification_status` .......... absent from pg_type
--   relrowsecurity on both tables ....... true (relforcerowsecurity false, so
--                                         service_role bypasses, as today)
--   any table matching verif/kyc/valify   only `phone_verifications`, which is
--                                         OTP and unrelated
--
-- SCOPE. Columns only. No new table, so no new RLS policy is required — both
-- tables already carry RLS and the existing per-tenant policies cover every
-- column added here. If a future proposal adds a `verification_events` table
-- it must ship its own policy in the same file.
--
-- ============================================================================
-- LAW 151/2020 — READ BEFORE CHANGING THIS FILE.
--
-- The ID DOCUMENT never reaches our infrastructure. Verification is a redirect
-- to a Valify-hosted page (decided 26 July 2026,
-- design/DECISION-national-id-2026-07-26.md). There is deliberately NO column
-- here for an image, a selfie, a date of birth, an address, religion, marital
-- status or a face-match score. Valify returns more than this; storing it would
-- be over-collection. Do not add such a column without going back to that
-- decision and to Adsero.
--
-- `national_id` is the one sensitive field retained, and NOT as an identity
-- check. ETA requires the counterparty's national ID on the self-billed
-- e-receipt for the provider's 90% share; that, and only that, is the purpose.
-- Legal basis is COMPLIANCE WITH A LEGAL OBLIGATION, not consent, so there is
-- no opt-out and the consent language elsewhere in the privacy policy does not
-- reach this column. It is retained for the statutory tax period (currently
-- five years) and survives an erasure request as part of the financial
-- skeleton. IT IS NEVER RENDERED IN ANY UI — not to the owner, not to internal
-- staff (VERIFICATION-SPEC §9.2, §9.7; §7.7 flags that admin has no
-- least-privilege control over it). No code on branch
-- claude/phase4-verification-ui-surfaces selects it.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1 · The status vocabulary.
--
-- Six values, not the two the designs draw. VERIFICATION-SPEC §9.1 names the
-- other four as required-and-undrawn: a hosted redirect with an out-of-band
-- webhook cannot avoid them. `pending` in particular MUST exist — a user who
-- returns from Valify before the webhook lands would otherwise sit at
-- `unverified`, which reads to them as "rejected".
--
-- A CHECK constraint rather than a Postgres enum: enums need ALTER TYPE to
-- extend and cannot drop a value at all, and this vocabulary will move once
-- Valify's webhook payload is documented (VERIFICATION-SPEC §2b, still
-- outstanding with the vendor).
-- ----------------------------------------------------------------------------

ALTER TABLE public.centers
  ADD COLUMN IF NOT EXISTS verification_status    text,
  ADD COLUMN IF NOT EXISTS verified_at            timestamptz,
  ADD COLUMN IF NOT EXISTS valify_transaction_id  text,
  ADD COLUMN IF NOT EXISTS verified_name          text,
  ADD COLUMN IF NOT EXISTS payout_name_matches    boolean,
  ADD COLUMN IF NOT EXISTS national_id            text;

ALTER TABLE public.teacher_profiles
  ADD COLUMN IF NOT EXISTS verification_status    text,
  ADD COLUMN IF NOT EXISTS verified_at            timestamptz,
  ADD COLUMN IF NOT EXISTS valify_transaction_id  text,
  ADD COLUMN IF NOT EXISTS verified_name          text,
  ADD COLUMN IF NOT EXISTS payout_name_matches    boolean,
  ADD COLUMN IF NOT EXISTS national_id            text;

-- NULL, not a 'unverified' default. A NULL says "this subject has never
-- interacted with verification"; the application maps that to `unverified` in
-- `resolveVerificationState`. Backfilling a literal 'unverified' would make an
-- untouched row indistinguishable from one that genuinely failed to start, and
-- would silently mark 2 centres and 3 teachers as having been assessed.

COMMENT ON COLUMN public.centers.national_id IS
  'ETA e-receipt counterparty identifier. Sensitive under Law 151/2020. Legal '
  'basis: compliance with a legal obligation, NOT consent. Retained for the '
  'statutory tax period and exempt from erasure as part of the financial '
  'skeleton. NEVER render in any UI, owner-facing or internal.';
COMMENT ON COLUMN public.teacher_profiles.national_id IS
  'ETA e-receipt counterparty identifier. Sensitive under Law 151/2020. Legal '
  'basis: compliance with a legal obligation, NOT consent. Retained for the '
  'statutory tax period and exempt from erasure as part of the financial '
  'skeleton. NEVER render in any UI, owner-facing or internal.';
COMMENT ON COLUMN public.centers.valify_transaction_id IS
  'Valify transaction reference for Transaction Inquiry and audit. Backend '
  'only; no design renders it and none should.';
COMMENT ON COLUMN public.teacher_profiles.valify_transaction_id IS
  'Valify transaction reference for Transaction Inquiry and audit. Backend '
  'only; no design renders it and none should.';
COMMENT ON COLUMN public.centers.payout_name_matches IS
  'Computed once when the provider enters their payout account holder, by '
  'comparing against verified_name. Renders the "Matches your verified ID" '
  'assertion without the UI ever handling the name.';
COMMENT ON COLUMN public.teacher_profiles.payout_name_matches IS
  'Computed once when the provider enters their payout account holder, by '
  'comparing against verified_name. Renders the "Matches your verified ID" '
  'assertion without the UI ever handling the name.';

-- ----------------------------------------------------------------------------
-- 2 · Status vocabulary constraints.
--
-- DO-block guarded, per CLAUDE.md: ADD CONSTRAINT has no IF NOT EXISTS, so a
-- re-run without the guard aborts the transaction. NOT VALID is deliberate —
-- both tables hold rows (2 and 3) whose new column is NULL, and NULL passes the
-- CHECK anyway, but NOT VALID keeps the apply non-blocking if either table has
-- grown by the time this is run. VALIDATE separately once applied.
-- ----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.centers'::regclass
      AND conname  = 'centers_verification_status_check'
  ) THEN
    ALTER TABLE public.centers
      ADD CONSTRAINT centers_verification_status_check
      CHECK (verification_status IS NULL OR verification_status IN
        ('unverified','pending','verified','failed','expired','provider_error'))
      NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.teacher_profiles'::regclass
      AND conname  = 'teacher_profiles_verification_status_check'
  ) THEN
    ALTER TABLE public.teacher_profiles
      ADD CONSTRAINT teacher_profiles_verification_status_check
      CHECK (verification_status IS NULL OR verification_status IN
        ('unverified','pending','verified','failed','expired','provider_error'))
      NOT VALID;
  END IF;
END $$;

-- A verified row must carry its timestamp, and a non-verified row must not.
-- Without this, a partial write leaves "Verified · verified <blank>", or worse
-- leaves a stale pass date beside a later failure.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.centers'::regclass
      AND conname  = 'centers_verified_at_matches_status_check'
  ) THEN
    ALTER TABLE public.centers
      ADD CONSTRAINT centers_verified_at_matches_status_check
      CHECK (
        (verification_status = 'verified' AND verified_at IS NOT NULL)
        OR (verification_status IS DISTINCT FROM 'verified' AND verified_at IS NULL)
      )
      NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.teacher_profiles'::regclass
      AND conname  = 'teacher_profiles_verified_at_matches_status_check'
  ) THEN
    ALTER TABLE public.teacher_profiles
      ADD CONSTRAINT teacher_profiles_verified_at_matches_status_check
      CHECK (
        (verification_status = 'verified' AND verified_at IS NOT NULL)
        OR (verification_status IS DISTINCT FROM 'verified' AND verified_at IS NULL)
      )
      NOT VALID;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 3 · Idempotency for the webhook.
--
-- Valify fires the webhook alongside the redirect and may retry. Without a
-- unique transaction reference, a retry writes a second pass over the first and
-- the audit trail loses which outcome actually applied. Partial, because the
-- overwhelming majority of rows will hold NULL.
-- ----------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS centers_valify_transaction_id_key
  ON public.centers (valify_transaction_id)
  WHERE valify_transaction_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS teacher_profiles_valify_transaction_id_key
  ON public.teacher_profiles (valify_transaction_id)
  WHERE valify_transaction_id IS NOT NULL;

-- Admin's "Unverified" filter chip (Merged-Admin-Platform §01) scans by status.
-- Partial on NOT NULL keeps it off the rows nobody has assessed.

CREATE INDEX IF NOT EXISTS centers_verification_status_idx
  ON public.centers (verification_status)
  WHERE verification_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS teacher_profiles_verification_status_idx
  ON public.teacher_profiles (verification_status)
  WHERE verification_status IS NOT NULL;

COMMIT;

-- ----------------------------------------------------------------------------
-- AFTER APPLYING, run and read the output before deploying anything:
--
--   select table_name, column_name, data_type
--   from information_schema.columns
--   where table_schema='public'
--     and table_name in ('centers','teacher_profiles')
--     and column_name in ('verification_status','verified_at',
--                         'valify_transaction_id','verified_name',
--                         'payout_name_matches','national_id')
--   order by table_name, column_name;                       -- expect 12 rows
--
--   select conname, convalidated from pg_constraint
--   where conrelid in ('public.centers'::regclass,
--                      'public.teacher_profiles'::regclass)
--     and conname like '%verif%';                            -- expect 4 rows
--
-- Then, once the tables are quiet:
--   ALTER TABLE public.centers          VALIDATE CONSTRAINT centers_verification_status_check;
--   ALTER TABLE public.centers          VALIDATE CONSTRAINT centers_verified_at_matches_status_check;
--   ALTER TABLE public.teacher_profiles VALIDATE CONSTRAINT teacher_profiles_verification_status_check;
--   ALTER TABLE public.teacher_profiles VALIDATE CONSTRAINT teacher_profiles_verified_at_matches_status_check;
--
-- STILL BLOCKED ON THE VENDOR, and applying this does not unblock it:
--   1. Valify's webhook payload — field names, whether it carries a decision,
--      and HOW IT IS AUTHENTICATED. That is the security boundary of the whole
--      feature and it is not publicly documented (VERIFICATION-SPEC §2b).
--   2. Whether Transaction Inquiry's boolean `status` means "the transaction
--      completed" or "the person passed". Very different things.
-- Until 1 is answered no webhook may be trusted to write `verification_status`,
-- because a redirect-settable verified state means hitting the success URL
-- makes you verified.
-- ----------------------------------------------------------------------------
