-- Nudge / dunning sent-ledger. Idempotency + audit for the unified billing
-- nudge engine (centers + teachers). One row per (owner, billing cycle, step)
-- enforced by the UNIQUE constraint — a scheduler re-run never double-sends.
-- The in-app banner does NOT touch this table (it is computed live from billing
-- state); this ledger only governs the WhatsApp channel + provides an audit log.
--
-- Service-role only: RLS enabled with no user-facing policies (same pattern as
-- saved_card_* / teacher_signup_otps). Accessed exclusively by supabase-admin.
CREATE TABLE public.billing_nudges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type text NOT NULL CHECK (owner_type IN ('center','teacher')),
  owner_id uuid NOT NULL,
  -- 'YYYY-MM' billing period for cycle nudges; 'card:YYYY-MM' for card-expiry.
  cycle_key text NOT NULL,
  step text NOT NULL CHECK (step IN (
    'prebill_t3','prebill_t1','due_today','locked','card_expiry_t30','card_expiry_t7'
  )),
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  channel_whatsapp_status text NOT NULL DEFAULT 'disabled'
    CHECK (channel_whatsapp_status IN ('disabled','queued','sent','failed','skipped')),
  whatsapp_template text,
  whatsapp_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_type, owner_id, cycle_key, step)
);

CREATE INDEX billing_nudges_owner_idx
  ON public.billing_nudges (owner_type, owner_id, created_at DESC);
CREATE INDEX billing_nudges_invoice_idx
  ON public.billing_nudges (invoice_id) WHERE invoice_id IS NOT NULL;

ALTER TABLE public.billing_nudges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_nudges FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
