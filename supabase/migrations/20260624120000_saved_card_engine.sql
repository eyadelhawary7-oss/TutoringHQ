-- Phase 1 — Saved-Card Engine (card-on-file + auto-charge capability).
--
-- This is the storage layer for storing a Paymob card TOKEN (never the PAN),
-- the explicit customer consent to store + auto-charge, and idempotent
-- merchant-initiated (MIT) charge intents. The auto-charge function (src/lib/
-- savedCard/*) is built and tested in Phase 1 but is NOT wired to any cron yet
-- — Phase 2 wires it into the midnight billing run.
--
-- Customers are polymorphic: a saved card belongs to a center (subscriptions)
-- or a teacher (teacher_subscriptions). owner_type + owner_id capture that.
--
-- Security model: these tables hold payment credentials and are accessed ONLY
-- by service_role server code (src/lib/savedCard/store.ts via supabase-admin).
-- RLS is ENABLED with NO user-facing policies — the same pattern as
-- teacher_signup_otps. service_role bypasses RLS; anon/authenticated get nothing.
-- We additionally REVOKE all grants from anon/authenticated as defence in depth.

-- ---------------------------------------------------------------------------
-- 1) saved_card_consents — append-only record of explicit customer consent.
--    A card may only be stored for recurring use when a consent row exists with
--    both agreed_to_store AND agreed_to_auto_charge = true. We snapshot the exact
--    consent text + version shown, the locale, and who/when (PDPL + card-scheme).
-- ---------------------------------------------------------------------------
CREATE TABLE public.saved_card_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type text NOT NULL CHECK (owner_type IN ('center','teacher')),
  owner_id uuid NOT NULL,
  consent_version text NOT NULL,
  consent_text text NOT NULL,
  locale text NOT NULL CHECK (locale IN ('ar','en')),
  agreed_to_store boolean NOT NULL,
  agreed_to_auto_charge boolean NOT NULL,
  user_id uuid,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.saved_card_consents (owner_type, owner_id, created_at DESC);

COMMENT ON TABLE public.saved_card_consents IS
  'Append-only. Explicit customer consent to store a card and auto-charge it. Required before a card is saved for recurring use.';

-- ---------------------------------------------------------------------------
-- 2) saved_cards — the card-on-file. Stores ONLY the Paymob token + display
--    metadata (last 4, brand, expiry) and the stored-credential reference to
--    replay on MIT charges. The raw card number (PAN) is NEVER stored — the
--    card_last4 CHECK structurally forbids storing more than 4 digits there.
-- ---------------------------------------------------------------------------
CREATE TABLE public.saved_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type text NOT NULL CHECK (owner_type IN ('center','teacher')),
  owner_id uuid NOT NULL,
  -- The Paymob card token used to charge later. NOT the PAN.
  paymob_token text NOT NULL,
  -- Display only, e.g. "card ending 4242". Exactly 4 digits — a PAN cannot fit.
  card_last4 text NOT NULL CHECK (card_last4 ~ '^[0-9]{4}$'),
  card_brand text,
  exp_month integer NOT NULL CHECK (exp_month BETWEEN 1 AND 12),
  exp_year integer NOT NULL CHECK (exp_year BETWEEN 2000 AND 2100),
  -- Stored-credential reference / network transaction id to replay on the MIT
  -- charge (keeps the MIT acceptable to the scheme and lifts authorization rates).
  stored_credential_ref text,
  -- The original customer-initiated (CIT) Paymob transaction id that tokenized
  -- the card — the anchor of the stored-credential agreement.
  initial_transaction_ref text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','expired','revoked','invalid')),
  consent_id uuid REFERENCES public.saved_card_consents(id),
  validity_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

-- At most one ACTIVE card per owner; revoked/expired/invalid history is kept.
CREATE UNIQUE INDEX saved_cards_one_active_per_owner
  ON public.saved_cards (owner_type, owner_id)
  WHERE status = 'active';

CREATE INDEX ON public.saved_cards (owner_type, owner_id);

COMMENT ON TABLE public.saved_cards IS
  'Card-on-file. Stores the Paymob TOKEN + display metadata only — never the PAN. card_last4 is exactly 4 digits by CHECK.';
COMMENT ON COLUMN public.saved_cards.paymob_token IS 'Paymob card token (opaque). NEVER the raw card number.';

-- ---------------------------------------------------------------------------
-- 3) card_charge_intents — idempotent MIT charge intents. The intent row is
--    written BEFORE Paymob is called, so a "charged at Paymob but our DB did not
--    record it" failure is detectable and reconcilable. The idempotency_key is
--    UNIQUE: the same key always maps to the same intent (same result), and a
--    different charge body reusing a key is rejected via request_fingerprint.
-- ---------------------------------------------------------------------------
CREATE TABLE public.card_charge_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  saved_card_id uuid NOT NULL REFERENCES public.saved_cards(id),
  owner_type text NOT NULL CHECK (owner_type IN ('center','teacher')),
  owner_id uuid NOT NULL,
  invoice_id uuid REFERENCES public.invoices(id),
  billing_period text,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'EGP',
  -- Hash of the canonical charge body — guards against a key being reused for a
  -- DIFFERENT charge (amount/owner/invoice) which must be rejected, not served.
  request_fingerprint text NOT NULL,
  status text NOT NULL DEFAULT 'created'
    CHECK (status IN ('created','submitted','succeeded','failed','voided','error')),
  is_3d_secure boolean NOT NULL DEFAULT false,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  paymob_order_id text,
  paymob_transaction_id text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX ON public.card_charge_intents (owner_type, owner_id, created_at DESC);
CREATE INDEX ON public.card_charge_intents (status) WHERE status IN ('created','submitted');

COMMENT ON TABLE public.card_charge_intents IS
  'Idempotent MIT charge intents. Written before calling Paymob; UNIQUE idempotency_key + request_fingerprint prevent double-charge on retry.';

-- ---------------------------------------------------------------------------
-- 4) saved_card_events — append-only audit of the saved-card lifecycle.
-- ---------------------------------------------------------------------------
CREATE TABLE public.saved_card_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  saved_card_id uuid REFERENCES public.saved_cards(id),
  charge_intent_id uuid REFERENCES public.card_charge_intents(id),
  owner_type text CHECK (owner_type IN ('center','teacher')),
  owner_id uuid,
  event_type text NOT NULL CHECK (event_type IN (
    'consent_recorded',
    'card_saved',
    'validity_check_passed',
    'validity_check_failed',
    'charge_intent_created',
    'charge_succeeded',
    'charge_failed',
    'card_revoked',
    'card_expired'
  )),
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.saved_card_events (saved_card_id, created_at DESC);
CREATE INDEX ON public.saved_card_events (charge_intent_id);

COMMENT ON TABLE public.saved_card_events IS
  'Append-only audit trail for saved-card lifecycle (saved, validity, charges, revoke, expire).';

-- ---------------------------------------------------------------------------
-- updated_at maintenance for the two mutable tables.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_saved_card_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_saved_cards_updated_at
  BEFORE UPDATE ON public.saved_cards
  FOR EACH ROW EXECUTE FUNCTION public.set_saved_card_updated_at();

CREATE TRIGGER trg_card_charge_intents_updated_at
  BEFORE UPDATE ON public.card_charge_intents
  FOR EACH ROW EXECUTE FUNCTION public.set_saved_card_updated_at();

-- ---------------------------------------------------------------------------
-- Security: service_role-only. RLS on, no user-facing policies; revoke grants.
-- ---------------------------------------------------------------------------
ALTER TABLE public.saved_card_consents  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_cards          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.card_charge_intents  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_card_events    ENABLE ROW LEVEL SECURITY;
-- No RLS policies: all access is via service_role server code (supabase-admin).

REVOKE ALL ON public.saved_card_consents FROM anon, authenticated;
REVOKE ALL ON public.saved_cards         FROM anon, authenticated;
REVOKE ALL ON public.card_charge_intents FROM anon, authenticated;
REVOKE ALL ON public.saved_card_events   FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
