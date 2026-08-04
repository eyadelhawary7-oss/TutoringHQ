-- ============================================================================
-- Identity verification (Valify e-KYC) — records, attempts, and their RLS.
--
-- ****************************************************************************
-- * NOT APPLIED — Eyad applies this by hand.                                  *
-- * CLAUDE.md rule 5: migrations are a MANUAL apply to production. Merging    *
-- * this file does NOT apply it (tested 15 July 2026: PR #159 merged as       *
-- * 80f82ba and the columns were still absent from the production catalog     *
-- * 8 minutes later). Apply it, confirm the tables and columns exist in       *
-- * information_schema, THEN let the code deploy.                             *
-- *                                                                           *
-- * THE CODE ON THIS BRANCH IS SAFE TO DEPLOY BEFORE THIS RUNS.               *
-- * That is deliberate and it is the difference from the F26 class. Every     *
-- * query against these tables goes through src/lib/verificationStore.ts,     *
-- * which passes every error through isMissingRelation() and converts an      *
-- * undefined-table into the NAMED cause `verification_schema_not_applied`.   *
-- * The user sees "not set up on this environment", not a 500. Nothing        *
-- * reports success, and no surface renders a verified badge.                 *
-- ****************************************************************************
--
-- PRECONDITIONS — re-queried LIVE against project lczmjpnbuhnsislcvzar on
-- 4 August 2026, immediately before writing this file. Not inferred, not
-- carried over from a spec.
--
--   verification_records ..................... ABSENT (0 rows in
--                                              information_schema.tables)
--   verification_attempts .................... ABSENT (0)
--   any table matching %verif%/%kyc%/%valify%/
--     %identity% in public ................... only `phone_verifications`,
--                                              which is OTP and unrelated
--   centers.national_id ...................... ABSENT
--   centers.verification_status .............. ABSENT
--   centers.verified_at / verified_name ...... ABSENT
--   centers.valify_transaction_id ............ ABSENT
--   ANY column matching %verif%/%national%/
--     %kyc%/%valify%/%tax_card%/%legal_name%
--     across all of public ................... 6 rows, ALL of them OTP or
--                                              backup bookkeeping:
--                                                students.phone_verified
--                                                students.parent_phone_verified
--                                                phone_verifications.verified_at
--                                                enrollment_otps.verified_at
--                                                teacher_signup_otps.verified_at
--                                                backup_log.last_verified_at
--                                              => ZERO identity-verification
--                                                 columns exist anywhere today.
--   centers.id ............................... uuid NOT NULL (PK)
--   users.id ................................. uuid NOT NULL (PK)
--   users.center_id .......................... uuid NULLABLE  <- teachers are
--                                              centre-less by design; do not
--                                              "fix" this
--   platform_config .......................... (id, key, value jsonb,
--                                              updated_at, updated_by)
--   platform_config key
--     'digital_student_fee_collection.enabled' EXISTS, value = false,
--                                              updated_at 2026-06-19 21:14 UTC
--
-- ⚠ ONE STALE SPEC CLAIM, CORRECTED HERE.
-- design/PAYOUT-SYSTEM-SPEC.md §0 and §9 state that
-- 'digital_student_fee_collection.enabled' "has no row in platform_config at
-- all." That is FALSE as of today — the row exists and holds false. Behaviour
-- is unchanged (the feature is still dormant) but the reason differs, and a
-- migration that INSERTed the row would collide with the existing unique key.
-- This migration therefore does not touch platform_config at all.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO — see part 6.
-- ============================================================================
--
-- ----------------------------------------------------------------------------
-- SENSITIVE PERSONAL DATA: WHICH COLUMNS, WHY, ON WHAT BASIS, FOR HOW LONG
-- ----------------------------------------------------------------------------
-- Egyptian national ID numbers are sensitive personal data under Law 151/2020.
-- Their digits encode date of birth, governorate of birth and sex. Two columns
-- in `verification_records` hold personal data and no others do:
--
--   national_id  TEXT  — the provider's Egyptian national ID number.
--   legal_name   TEXT  — the name exactly as Valify read it off the document.
--
-- WHY national_id IS COLLECTED, and why nothing weaker will do:
--   TutoringHQ self-bills each provider for their 90% share of collected
--   tuition and issues the e-receipt through ETA. ETA REQUIRES the
--   counterparty's national ID number on that receipt. That, and only that, is
--   why the number exists in this schema. It is NOT an identity check — Valify
--   returns a separate pass/fail for that. Consequences, from
--   design/DECISION-national-id-2026-07-26.md §1:
--     * It CANNOT be hashed. A one-way hash satisfies an identity or
--       deduplication purpose; it does not satisfy a tax-receipt purpose, which
--       needs the number itself printed on the document.
--     * It is collected from PROVIDERS ONLY — centres and independent teachers.
--       Never from parents or students, who are not counterparties to any
--       receipt we issue. A few hundred numbers over the life of the business.
--
-- WHY legal_name IS COLLECTED:
--   The payout account-holder match rule. VERIFICATION-SPEC §9.7:
--   "The name on the account has to match your verified ID. We cannot pay to an
--   account we cannot confirm is yours." Also required on the ETA receipt
--   alongside the number.
--
-- LEGAL BASIS: COMPLIANCE WITH A LEGAL OBLIGATION. Not consent.
--   TutoringHQ does not choose to collect the number; Egyptian tax law requires
--   it on the receipt. Two things follow and both are load-bearing:
--     * There is NO opt-out. A provider who declines cannot be paid out through
--       the platform, because no lawful receipt can be issued for them.
--     * The consent language elsewhere in the privacy policy DOES NOT APPLY to
--       these two columns. The policy amendment must keep that separation
--       explicit rather than sweeping it in with everything else.
--
-- WHAT IS NEVER STORED, AND IS NOT REPRESENTABLE IN THIS SCHEMA:
--   The ID document image (front or back), the selfie, date of birth, address,
--   religion, marital status, gender, document expiry, face-match score,
--   liveness score, and any Valify intermediate data. There is no column for
--   any of them, so no code change alone can start storing them — adding one
--   requires editing this schema, which is a reviewable act.
--   The front of an Egyptian national ID carries RELIGION and MARITAL STATUS,
--   each independently sensitive under Law 151/2020. Verification runs as a
--   REDIRECT to a Valify-hosted page (decided 26 July 2026); the document never
--   touches our infrastructure. src/lib/valifyClient.ts has no upload path, no
--   multipart handling and no call to Valify's Fetch Images API.
--
-- RETENTION ANCHOR: `verified_at`, plus the statutory tax period.
--   The anchor is the TAX RECORD, not the account. national_id and legal_name
--   are retained for the statutory period (currently five years) measured from
--   the last receipt they appear on, and are NOT erased on a PDPL request.
--   Everything else about the provider is. DECISION-national-id §4:
--   "Erase everything except the financial skeleton."
--   `retention_basis` below records this per row so the erasure job can act on
--   the column rather than on a rule someone has to remember. Two existing
--   commitments must be amended to match, and neither is amended by this file:
--     * the privacy policy's 12-months-after-termination deletion promise
--     * the 30-day erasure window advertised on the data-rights form
--   Tracked in design/LEGAL-CHANGE-LEDGER.md. Adsero has the open question
--   (DECISION-national-id §6): whether processing these on these facts needs
--   registration or a licence under Law 151/2020.
--
-- NEVER RENDERED IN ANY UI. Part 4 enforces this at the DATABASE level with
-- column-level privileges, not merely by convention in the application.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. verification_records — one row per verified subject
--
-- A subject is EITHER a centre OR a teacher, never both. Teachers are
-- centre-less (users.center_id IS NULL, membership via teacher_center), so a
-- teacher row carries user_id with center_id NULL. That is the correct
-- modelling of Model B, not a gap.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.verification_records (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  subject_type        text NOT NULL,
  center_id           uuid REFERENCES public.centers(id) ON DELETE CASCADE,
  user_id             uuid REFERENCES public.users(id)   ON DELETE CASCADE,

  -- The four persisted states. `unconfigured` is deliberately NOT among them:
  -- it is a property of the DEPLOYMENT (no Valify credentials), not of the
  -- provider, so writing it to a provider's row would outlive its reason.
  -- src/lib/verificationState.ts computes it at read time and it outranks
  -- whatever is stored here.
  state               text NOT NULL DEFAULT 'unverified',

  -- The finer-grained last event, so 'abandoned', 'expired' and
  -- 'provider_error' stay distinguishable without three extra states that all
  -- mean "try again".
  last_outcome        text,

  -- SENSITIVE (Law 151/2020). Tax skeleton only. Never rendered. See header.
  national_id         text,
  legal_name          text,

  verified_at         timestamptz,
  -- The Cairo CALENDAR DAY of verification, stored explicitly rather than
  -- derived from verified_at at render time. A verification at 23:30 Cairo is
  -- 21:30 UTC the same day in winter but the previous day's date is what a
  -- naive UTC render would show for instants after midnight Cairo. The
  -- user-visible date ("verified 12/07/2025", VERIFICATION-SPEC §1.2) must not
  -- drift, so it is written once, in Cairo, by the webhook.
  verified_cairo_day  date,

  provider            text NOT NULL DEFAULT 'valify',
  -- Valify's transaction id. Backend only — needed for Transaction Inquiry and
  -- audit. VERIFICATION-SPEC §2c: "No design mentions it; it is required
  -- anyway." NEVER rendered.
  provider_reference  text,

  -- Which retention rule governs this row's sensitive columns. Explicit so the
  -- PDPL erasure job reads a column instead of re-deriving a policy.
  retention_basis     text NOT NULL DEFAULT 'egyptian_tax_record',

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 2. verification_attempts — binds OUR minted reference to a subject
--
-- This table is what makes the webhook safe. The callback carries only an
-- opaque reference we generated; the subject is looked up HERE, in a row we
-- wrote server-side at start time. A callback can therefore never name whose
-- account it is verifying, even with a valid signature.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.verification_attempts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Our uuid, opaque, encodes nothing about the subject.
  reference_id  text NOT NULL,
  subject_type  text NOT NULL,
  center_id     uuid REFERENCES public.centers(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES public.users(id)   ON DELETE CASCADE,
  state         text NOT NULL DEFAULT 'pending',
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 3. Constraints and indexes
--
-- Every ADD CONSTRAINT is wrapped in a DO block guarded on pg_constraint, so
-- re-running this file is safe. Every index is IF NOT EXISTS.
-- ----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'verification_records_subject_type_check'
  ) THEN
    ALTER TABLE public.verification_records
      ADD CONSTRAINT verification_records_subject_type_check
      CHECK (subject_type IN ('center', 'teacher'));
  END IF;
END $$;

-- Exactly one subject key, matching subject_type. Without this a row could
-- carry both a center_id and a user_id and belong to two tenants at once.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'verification_records_one_subject_check'
  ) THEN
    ALTER TABLE public.verification_records
      ADD CONSTRAINT verification_records_one_subject_check
      CHECK (
        (subject_type = 'center'  AND center_id IS NOT NULL AND user_id IS NULL)
        OR
        (subject_type = 'teacher' AND user_id   IS NOT NULL AND center_id IS NULL)
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'verification_records_state_check'
  ) THEN
    ALTER TABLE public.verification_records
      ADD CONSTRAINT verification_records_state_check
      CHECK (state IN ('unverified', 'pending', 'verified', 'rejected'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'verification_records_last_outcome_check'
  ) THEN
    ALTER TABLE public.verification_records
      ADD CONSTRAINT verification_records_last_outcome_check
      CHECK (
        last_outcome IS NULL
        OR last_outcome IN ('passed', 'failed', 'abandoned', 'expired', 'provider_error')
      );
  END IF;
END $$;

-- The integrity rule that makes a fake verified state unrepresentable: the
-- sensitive columns and the timestamp may be populated ONLY on a verified row,
-- and a verified row MUST carry its date. A row cannot say "verified" with no
-- date, and cannot hold a national ID while unverified — there would be no
-- receipt to justify retaining it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'verification_records_verified_shape_check'
  ) THEN
    ALTER TABLE public.verification_records
      ADD CONSTRAINT verification_records_verified_shape_check
      CHECK (
        (state = 'verified' AND verified_at IS NOT NULL)
        OR
        (state <> 'verified'
          AND verified_at IS NULL
          AND verified_cairo_day IS NULL
          AND national_id IS NULL
          AND legal_name IS NULL)
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'verification_records_retention_basis_check'
  ) THEN
    ALTER TABLE public.verification_records
      ADD CONSTRAINT verification_records_retention_basis_check
      CHECK (retention_basis IN ('egyptian_tax_record', 'erasable'));
  END IF;
END $$;

-- One record per subject. These are the ON CONFLICT targets the upsert in
-- src/lib/verificationStore.ts names, so they are required, not cosmetic:
-- without them a retried webhook would create a second record for the same
-- provider and two rows would disagree about whether they are verified.
CREATE UNIQUE INDEX IF NOT EXISTS verification_records_center_uniq
  ON public.verification_records (center_id)
  WHERE center_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS verification_records_user_uniq
  ON public.verification_records (user_id)
  WHERE user_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'verification_attempts_subject_type_check'
  ) THEN
    ALTER TABLE public.verification_attempts
      ADD CONSTRAINT verification_attempts_subject_type_check
      CHECK (subject_type IN ('center', 'teacher'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'verification_attempts_one_subject_check'
  ) THEN
    ALTER TABLE public.verification_attempts
      ADD CONSTRAINT verification_attempts_one_subject_check
      CHECK (
        (subject_type = 'center'  AND center_id IS NOT NULL AND user_id IS NULL)
        OR
        (subject_type = 'teacher' AND user_id   IS NOT NULL AND center_id IS NULL)
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'verification_attempts_state_check'
  ) THEN
    ALTER TABLE public.verification_attempts
      ADD CONSTRAINT verification_attempts_state_check
      CHECK (state IN ('pending', 'completed', 'expired', 'abandoned'));
  END IF;
END $$;

-- The reference is the webhook's only key. A duplicate would make the subject
-- lookup ambiguous, which is the one thing that must never be ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS verification_attempts_reference_uniq
  ON public.verification_attempts (reference_id);

CREATE INDEX IF NOT EXISTS verification_attempts_center_idx
  ON public.verification_attempts (center_id) WHERE center_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS verification_attempts_user_idx
  ON public.verification_attempts (user_id) WHERE user_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 4. RLS — shipped in the same proposal, per the standing rule for new tables
--
-- Read-only for the subject, and NOT EVEN THAT for the sensitive columns.
-- There is no INSERT, UPDATE or DELETE policy for `authenticated` anywhere in
-- this file: every write goes through the service role in
-- src/lib/verificationStore.ts, reached only from the HMAC-verified webhook.
-- A provider cannot write their own verification state under any circumstance.
--
-- NOTE on how service_role gets through: relforcerowsecurity is false on every
-- table in this database, so service_role and postgres bypass RLS (confirmed
-- live, and consistent with PAYOUT-SYSTEM-SPEC §7.4). The absence of write
-- policies is therefore a real restriction on end users, not on our own jobs.
-- ----------------------------------------------------------------------------
ALTER TABLE public.verification_records  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS verification_records_select_own ON public.verification_records;
CREATE POLICY verification_records_select_own
  ON public.verification_records
  FOR SELECT
  USING (
    -- Centre row: visible to users of that centre. Matches the existing idiom
    -- on payout_requests, verified live in pg_policy.
    (subject_type = 'center' AND center_id IN (
      SELECT users.center_id FROM public.users WHERE users.id = auth.uid()
    ))
    OR
    -- Teacher row: visible to that teacher only. Matches
    -- teacher_profiles_select_own.
    (subject_type = 'teacher' AND user_id = auth.uid())
  );

DROP POLICY IF EXISTS verification_attempts_select_own ON public.verification_attempts;
CREATE POLICY verification_attempts_select_own
  ON public.verification_attempts
  FOR SELECT
  USING (
    (subject_type = 'center' AND center_id IN (
      SELECT users.center_id FROM public.users WHERE users.id = auth.uid()
    ))
    OR
    (subject_type = 'teacher' AND user_id = auth.uid())
  );

-- COLUMN-LEVEL PRIVILEGES on the sensitive columns.
--
-- RLS grants access to a ROW; it cannot withhold a COLUMN. Without this block a
-- provider — or any component holding their token — could select national_id
-- straight from PostgREST, and so could every internal staff member with an
-- authenticated session. VERIFICATION-SPEC §7.7 flags exactly that: admin staff
-- can read the full national ID with no least-privilege control drawn anywhere.
-- §9.2 requires the number never be rendered in any UI, owner-facing or admin.
--
-- Enforcing that here means the application CANNOT leak it by accident: a
-- careless `select('*')` from an authenticated client fails rather than
-- returning the number. The receipt pipeline reads it as service_role, which
-- bypasses this.
REVOKE ALL ON public.verification_records FROM anon, authenticated;
GRANT SELECT (
  id, subject_type, center_id, user_id, state, last_outcome,
  verified_at, verified_cairo_day, provider, retention_basis,
  created_at, updated_at
) ON public.verification_records TO authenticated;
-- national_id, legal_name and provider_reference are NOT in that list, and that
-- is the point. provider_reference joins them because it is a backend audit
-- handle with no user-facing purpose (VERIFICATION-SPEC §9.7).

REVOKE ALL ON public.verification_attempts FROM anon, authenticated;
GRANT SELECT (
  id, reference_id, subject_type, center_id, user_id, state, expires_at, created_at
) ON public.verification_attempts TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. updated_at maintenance
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_verification_records_updated_at()
RETURNS trigger
LANGUAGE plpgsql
-- SECURITY INVOKER (the default) on purpose: this only stamps a timestamp and
-- needs no elevated rights. `prosecdef = true` would make it a privilege
-- boundary for no reason.
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_verification_records_updated_at ON public.verification_records;
CREATE TRIGGER trg_verification_records_updated_at
  BEFORE UPDATE ON public.verification_records
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_verification_records_updated_at();

COMMIT;

-- ============================================================================
-- 6. WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--
-- (a) NO COLUMNS ON `centers` OR `users`. Verification is a separate concern
--     with its own retention rule and its own column-level privileges. Putting
--     national_id on `centers` — a 108-column table read by dozens of
--     `select('*')` call sites — would leak it everywhere by default. The
--     separate table is what makes part 4's column grants meaningful.
--
-- (b) NO `payout_name_matches` COLUMN. VERIFICATION-SPEC §9.7 recommends
--     storing a boolean computed once at payout-details entry INSTEAD of
--     legal_name, so the "Matches your verified ID" badge renders while no name
--     is held. That recommendation was written before the tax carve-out was
--     confirmed: legal_name must be stored regardless, because ETA requires it
--     on the receipt alongside the number. Adding the boolean as well would
--     store a derived fact next to the fact it derives from, and the two would
--     drift. Payout territory can compute it on read.
--
-- (c) NO `tax_status` / `tax_card_number`. Provider-entered, changeable at any
--     time, and NOT a Valify output (VERIFICATION-SPEC §1.3). Different
--     lifecycle, different table, not this one.
--
-- (d) NO CHANGES TO platform_config. The online-collection switch already
--     exists — see the stale-claim note in the header.
--
-- (e) NO ATTEMPT LIMIT, COOLDOWN OR LOCKOUT COLUMNS. VERIFICATION-SPEC §3 and
--     open question 4 record that no design specifies any of it, and Valify
--     meters attempts itself via `trials_remaining`. Inventing a policy in the
--     schema would freeze an unmade product decision. Eyad decides; the column
--     follows.
--
-- (f) NO ADMIN OVERRIDE COLUMN. Open question 6 — whether a manual-review route
--     exists — is unanswered, and no admin approve/reject/override control
--     exists in any design. src/lib/verificationState.ts already forbids admin
--     from reaching `verified` by any edge; only the provider webhook can. If
--     Eyad decides an override should exist, that is a new edge in the state
--     machine and a new column here, reviewed together.
--
-- 7. AFTER APPLYING, CONFIRM — do not assume:
--
--   select table_name, column_name, data_type
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name in ('verification_records','verification_attempts')
--    order by table_name, ordinal_position;
--
--   select conname from pg_constraint
--    where conrelid in ('public.verification_records'::regclass,
--                       'public.verification_attempts'::regclass);
--
--   select polname, polcmd from pg_policy
--    where polrelid in ('public.verification_records'::regclass,
--                       'public.verification_attempts'::regclass);
--
--   -- national_id / legal_name / provider_reference must NOT appear here:
--   select column_name, privilege_type from information_schema.column_privileges
--    where table_name = 'verification_records' and grantee = 'authenticated';
-- ============================================================================
