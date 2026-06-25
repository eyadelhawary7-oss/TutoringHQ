-- Billing reliability hardening (centers + teachers).
--
-- This migration is ADDITIVE and NON-DESTRUCTIVE. It:
--   1. Re-defines the invoice tamper guard so a FINALIZED (paid) invoice's
--      money-critical fields are immutable for BOTH owner types (center AND
--      teacher), while still allowing the legitimate pending->paid finalization
--      and the one externally-forced reversal (paid->chargeback). A sanctioned,
--      audited correction path may bypass via the app.allow_invoice_correction
--      GUC (mirrors the app.allow_lifecycle_write convention used elsewhere).
--   2. Adds billing_reconciliation_reports — a review table the nightly
--      reconciliation cron writes mismatches into (humans resolve; the cron only
--      ever self-heals the one safe direction: an actually-paid-at-Paymob invoice
--      that never finalized on our side).
--   3. Adds recurring_charge_declines — an append-only record of each failed
--      recurring (MIT) charge's decline code / classification / issuer info, so we
--      can learn which Egyptian issuers reject merchant-initiated transactions.
--
-- NOTE on the tamper guard: the previous definition (applied to the live DB
-- out-of-band, never tracked in a migration) blocked ALL status/money changes
-- unconditionally — including the legitimate finalizer write — and had no bypass.
-- It only ever covered center invoices by accident (it is owner-agnostic). This
-- migration brings it into the repo, fixes the over-broad block, and makes the
-- "paid invoice is immutable" contract explicit for centers AND teachers.

-- ---------------------------------------------------------------------------
-- 1. Invoice tamper guard — finalized-invoice immutability, owner-agnostic.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chq_prevent_invoice_tampering()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Sanctioned, audited correction path (credit/adjustment tooling) opens this
  -- GUC for the duration of its transaction. Everything else is guarded.
  IF coalesce(current_setting('app.allow_invoice_correction', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  -- Owner identity is immutable for EVERY invoice (center + teacher), always:
  -- an invoice can never be re-pointed to a different owner.
  IF NEW.owner_type IS DISTINCT FROM OLD.owner_type THEN
    RAISE EXCEPTION 'invoices: cannot modify owner_type';
  END IF;
  IF NEW.center_id IS DISTINCT FROM OLD.center_id THEN
    RAISE EXCEPTION 'invoices: cannot modify center_id';
  END IF;
  IF NEW.teacher_id IS DISTINCT FROM OLD.teacher_id THEN
    RAISE EXCEPTION 'invoices: cannot modify teacher_id';
  END IF;

  -- A finalized (paid) invoice is immutable on its money-critical fields, for
  -- BOTH owner types. Corrections must go through the explicit, audited
  -- credit/adjustment path (which sets app.allow_invoice_correction), never an
  -- in-place edit. The only sanctioned in-place transition out of 'paid' is an
  -- externally-forced reversal (Paymob void/refund -> 'chargeback').
  IF OLD.status = 'paid' THEN
    IF NEW.total_amount IS DISTINCT FROM OLD.total_amount THEN
      RAISE EXCEPTION 'invoices: cannot modify total_amount of a paid invoice';
    END IF;
    IF NEW.amount_received IS DISTINCT FROM OLD.amount_received THEN
      RAISE EXCEPTION 'invoices: cannot modify amount_received of a paid invoice';
    END IF;
    IF NEW.paid_at IS DISTINCT FROM OLD.paid_at THEN
      RAISE EXCEPTION 'invoices: cannot modify paid_at of a paid invoice';
    END IF;
    IF NEW.invoice_type IS DISTINCT FROM OLD.invoice_type THEN
      RAISE EXCEPTION 'invoices: cannot modify invoice_type of a paid invoice';
    END IF;
    IF NEW.paymob_transaction_id IS DISTINCT FROM OLD.paymob_transaction_id THEN
      RAISE EXCEPTION 'invoices: cannot modify paymob_transaction_id of a paid invoice';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'chargeback' THEN
      RAISE EXCEPTION 'invoices: cannot change status of a paid invoice (except chargeback)';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.chq_prevent_invoice_tampering() IS
  'Invoice tamper guard (owner-agnostic): a paid invoice''s money fields are immutable for centers AND teachers; only paid->chargeback or the audited app.allow_invoice_correction bypass may change them.';

-- Trigger already exists in the live DB; re-assert it idempotently so a fresh DB
-- (built from migrations) gets it too. BEFORE UPDATE, per row.
DROP TRIGGER IF EXISTS trg_chq_prevent_invoice_tampering ON public.invoices;
CREATE TRIGGER trg_chq_prevent_invoice_tampering
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.chq_prevent_invoice_tampering();

-- ---------------------------------------------------------------------------
-- 2. Reconciliation review table — nightly invoice <-> Paymob cross-check.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_reconciliation_reports (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'paid_without_paymob_success' | 'paymob_paid_unfinalized' | 'amount_mismatch'
  kind                  text NOT NULL,
  owner_type            text,            -- 'center' | 'teacher'
  owner_id              uuid,
  invoice_id            uuid,
  paymob_order_id       text,
  paymob_transaction_id text,
  expected_amount       numeric,         -- what our invoice says
  paymob_amount         numeric,         -- what Paymob reports (when known)
  -- 'open' | 'self_healed' | 'resolved' | 'ignored'
  status                text NOT NULL DEFAULT 'open',
  detail                jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  resolved_at           timestamptz,
  resolved_by           uuid
);

-- Re-running the cron must not pile up duplicate open rows for the same finding.
CREATE UNIQUE INDEX IF NOT EXISTS billing_reconciliation_open_uidx
  ON public.billing_reconciliation_reports (kind, invoice_id)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS billing_reconciliation_status_idx
  ON public.billing_reconciliation_reports (status, created_at);

COMMENT ON TABLE public.billing_reconciliation_reports IS
  'Mismatches found by the nightly invoice<->Paymob reconciliation cron. Humans resolve; the cron only auto-mutates the one safe direction (paymob_paid_unfinalized -> finalize).';

-- ---------------------------------------------------------------------------
-- 3. Recurring-charge decline / issuer tracking — append-only.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.recurring_charge_declines (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type            text NOT NULL,   -- 'center' | 'teacher'
  owner_id              uuid NOT NULL,
  invoice_id            uuid,
  billing_period        text,
  attempt_index         integer,
  decline_code          text,            -- Paymob txn_response_code (ISO-8583-ish)
  decline_classification text,           -- 'auth_required' | 'hard_final' | 'soft_retryable'
  error_message         text,
  card_brand            text,            -- weak issuer proxy
  card_last4            text,
  issuer_bank           text,            -- populated only when Paymob exposes it
  paymob_order_id       text,
  paymob_transaction_id text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recurring_charge_declines_owner_idx
  ON public.recurring_charge_declines (owner_type, owner_id, created_at);

CREATE INDEX IF NOT EXISTS recurring_charge_declines_code_idx
  ON public.recurring_charge_declines (decline_code, created_at);

COMMENT ON TABLE public.recurring_charge_declines IS
  'Append-only record of each failed merchant-initiated (MIT) recurring charge: decline code, classification, issuer info. For learning which issuers reject MIT and for support visibility.';

-- ---------------------------------------------------------------------------
-- Security: service_role-only, mirroring webhook_inbox / saved_card_* tables.
-- RLS on, no user-facing policies; revoke direct grants from anon/authenticated.
-- ---------------------------------------------------------------------------
ALTER TABLE public.billing_reconciliation_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_charge_declines      ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.billing_reconciliation_reports FROM anon, authenticated;
REVOKE ALL ON public.recurring_charge_declines      FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
