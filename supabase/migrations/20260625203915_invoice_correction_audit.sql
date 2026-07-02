-- ============================================================================
-- 20260625203915_invoice_correction_audit.sql
-- ----------------------------------------------------------------------------
-- MEDIUM audit fix: the sanctioned invoice-correction path bypasses the
-- tamper guard by opening the `app.allow_invoice_correction` GUC, but that
-- bypass was NOT recorded anywhere — a paid invoice's money fields could be
-- corrected with no trace of who/when/what.
--
-- This makes the bypass APPEND-ONLY auditable AT THE TRIGGER BOUNDARY: any
-- UPDATE that takes the `app.allow_invoice_correction = 'on'` branch now writes
-- one public.audit_log row capturing actor, time (created_at default), the
-- invoice, the reason, and the full before/after of the money-critical fields.
-- Because it lives in the guard itself, EVERY correction that uses the bypass is
-- traced regardless of which caller performs it — there is no unaudited path.
--
-- The correction remains a CREDIT/adjustment mechanism (this only observes the
-- UPDATE; it issues no refund and changes no guard semantics). Optional
-- companion GUCs let a caller attribute the change without being required:
--   set_config('app.correction_actor', '<user uuid>', true)
--   set_config('app.correction_reason', '<text>', true)
-- Absent/invalid values are recorded as NULL rather than aborting the fix.
--
-- Additive + reversible. ROLLBACK: re-run CREATE OR REPLACE with the prior body
-- (the audit INSERT block removed) — preserved verbatim in
-- supabase/migrations/00000000000000_baseline.sql. No data migration; the only
-- object touched is the function body of chq_prevent_invoice_tampering().
-- ============================================================================

CREATE OR REPLACE FUNCTION public.chq_prevent_invoice_tampering()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(current_setting('app.allow_invoice_correction', true), '') = 'on' THEN
    -- Append-only audit of the sanctioned bypass. If this INSERT fails the whole
    -- correction aborts (atomic) — a correction may NEVER proceed unaudited.
    INSERT INTO public.audit_log (center_id, user_id, action, entity_type, entity_id, details)
    VALUES (
      NEW.center_id,
      CASE
        WHEN coalesce(current_setting('app.correction_actor', true), '') ~ '^[0-9a-fA-F-]{36}$'
          THEN current_setting('app.correction_actor', true)::uuid
        ELSE NULL
      END,
      'invoice_correction',
      'invoice',
      NEW.id,
      jsonb_build_object(
        'owner_type', NEW.owner_type,
        'teacher_id', NEW.teacher_id,
        'reason', nullif(current_setting('app.correction_reason', true), ''),
        'before', jsonb_build_object(
          'status', OLD.status,
          'total_amount', OLD.total_amount,
          'amount_received', OLD.amount_received,
          'paid_at', OLD.paid_at,
          'invoice_type', OLD.invoice_type,
          'paymob_transaction_id', OLD.paymob_transaction_id
        ),
        'after', jsonb_build_object(
          'status', NEW.status,
          'total_amount', NEW.total_amount,
          'amount_received', NEW.amount_received,
          'paid_at', NEW.paid_at,
          'invoice_type', NEW.invoice_type,
          'paymob_transaction_id', NEW.paymob_transaction_id
        )
      )
    );
    RETURN NEW;
  END IF;

  IF NEW.owner_type IS DISTINCT FROM OLD.owner_type THEN
    RAISE EXCEPTION 'invoices: cannot modify owner_type';
  END IF;
  IF NEW.center_id IS DISTINCT FROM OLD.center_id THEN
    RAISE EXCEPTION 'invoices: cannot modify center_id';
  END IF;
  IF NEW.teacher_id IS DISTINCT FROM OLD.teacher_id THEN
    RAISE EXCEPTION 'invoices: cannot modify teacher_id';
  END IF;

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
  'Invoice tamper guard (owner-agnostic): a paid invoice''s money fields are immutable for centers AND teachers; only paid->chargeback or the audited app.allow_invoice_correction bypass may change them. The bypass branch writes an append-only audit_log entry (actor/reason/before/after) so every correction is traceable.';
