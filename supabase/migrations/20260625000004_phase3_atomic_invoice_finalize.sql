-- ============================================================================
-- Phase 3 / Fix 3 — make the invoice "paid" side-effects atomic (all-or-nothing)
-- ----------------------------------------------------------------------------
-- Problem: finalizeInvoicePaymentSuccess marked the invoice paid first (one
-- write) and THEN applied the dependent side-effects as separate, unwrapped
-- awaits:
--   * Centre subscription invoice: invoice->paid, then INSERT renewal_history,
--     then UPDATE centers (extend billing window / reactivate). If the centers
--     UPDATE failed after the invoice was already marked paid, the centre was
--     left paid-but-not-extended — and because the finalizer short-circuits on
--     an already-paid invoice (`if status='paid' return`), a re-delivered
--     webhook never repaired it. Permanent inconsistency.
--   * Teacher subscription invoice: invoice->paid, then UPDATE
--     teacher_subscriptions (restore access). Same split-write hazard: paid but
--     access not restored, never retried.
--
-- Fix: two SECURITY DEFINER RPCs that perform the invoice mark-paid AND its
-- dependent writes in ONE transaction. A failure in any step rolls the whole
-- thing back — the invoice stays unpaid, so the next webhook / poll / cron
-- retries cleanly. Mirrors the existing atomic-RPC pattern
-- (finalize_combined_session_paid, process_payment_rpc); no parallel machinery.
--
--   (1) finalize_subscription_invoice_paid(...)  — centre recurring path.
--       Marks the invoice paid, inserts renewal_history, extends centers
--       billing, all together. Guarded by assert_caller_center_access (defence
--       in depth, identical to the Phase 1 money RPCs).
--   (2) finalize_teacher_invoice_paid(...)        — teacher recurring path.
--       Marks the invoice paid and advances teacher_subscriptions together. The
--       status change goes through the sanctioned apply_teacher_subscription_
--       transition (the lifecycle guard blocks direct status writes); the
--       period/payment columns are updated directly (not guarded). This also
--       closes a latent hazard where the old direct status write would have
--       tripped the lifecycle guard when a late teacher paid from a non-active
--       state.
--
-- Date/timestamp values are computed in TypeScript (Cairo-aware) and passed in;
-- the RPCs do not re-derive billing windows. Date params are text and rely on
-- the same text->date assignment cast PostgREST used, so the stored values are
-- byte-identical to the prior path.
--
-- Idempotency: each RPC advances only a not-yet-paid invoice
-- (status <> 'paid'); a concurrent / replayed finalize that finds it already
-- paid returns 'already_paid' and applies no side-effects (the winner did).
--
-- Reversible. ROLLBACK:
--   * DROP FUNCTION public.finalize_subscription_invoice_paid(uuid, uuid, numeric, text, jsonb, numeric, text, text, text, text, boolean);
--   * DROP FUNCTION public.finalize_teacher_invoice_paid(uuid, uuid, numeric, text, jsonb, timestamptz, timestamptz);
--   * Restore src/lib/invoicePaymobPayment.ts from git (the version that does the
--     invoice update + side-effects as separate awaits).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- (1) Centre subscription invoice: invoice paid + renewal_history + centers,
--     atomically.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_subscription_invoice_paid(
  p_invoice_id uuid,
  p_center_id uuid,
  p_amount_received numeric,
  p_txn_id text,
  p_metadata jsonb,
  p_total_amount numeric,
  p_renewal_date text,
  p_next_payment_due text,
  p_auto_suspend_at text,
  p_last_payment_date text,
  p_was_suspended boolean
)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_updated integer;
BEGIN
  PERFORM public.assert_caller_center_access(p_center_id);

  -- (a) Mark the invoice paid. Idempotency + race guard: only a not-yet-paid
  -- invoice is advanced. If a concurrent finalize already paid it, the side
  -- effects below are skipped — the winner applied them.
  UPDATE invoices
     SET status = 'paid',
         amount_received = p_amount_received,
         payment_method = 'paymob',
         payment_reference = p_txn_id,
         paymob_transaction_id = p_txn_id,
         paid_at = NOW(),
         metadata = p_metadata
   WHERE id = p_invoice_id
     AND center_id = p_center_id
     AND status <> 'paid';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RETURN 'already_paid';
  END IF;

  -- (b) Record the renewal.
  INSERT INTO renewal_history (center_id, renewal_date, amount_paid, payment_method, recorded_by)
  VALUES (p_center_id, p_renewal_date::date, p_total_amount, 'paymob', NULL);

  -- (c) Extend the centre billing window (+ reactivate if it was billing-suspended).
  UPDATE centers
     SET billing_status = 'paid',
         next_payment_due = p_next_payment_due::date,
         auto_suspend_at = p_auto_suspend_at::date,
         last_payment_date = p_last_payment_date::date,
         upgrade_count_this_period = 0,
         status = CASE WHEN p_was_suspended THEN 'active' ELSE status END,
         subscription_status = CASE WHEN p_was_suspended THEN 'active' ELSE subscription_status END
   WHERE id = p_center_id;

  RETURN 'completed';
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.finalize_subscription_invoice_paid(uuid, uuid, numeric, text, jsonb, numeric, text, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_subscription_invoice_paid(uuid, uuid, numeric, text, jsonb, numeric, text, text, text, text, boolean) TO service_role;

-- ---------------------------------------------------------------------------
-- (2) Teacher subscription invoice: invoice paid + subscription advance,
--     atomically. Status transition via the sanctioned RPC; period columns
--     updated directly.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_teacher_invoice_paid(
  p_invoice_id uuid,
  p_teacher_id uuid,
  p_amount_received numeric,
  p_txn_id text,
  p_metadata jsonb,
  p_period_start timestamptz,
  p_period_end timestamptz
)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_updated integer;
  v_sub_id uuid;
  v_sub_status text;
BEGIN
  -- (a) Mark the teacher invoice paid (idempotent / race guard, as above).
  UPDATE invoices
     SET status = 'paid',
         amount_received = p_amount_received,
         payment_method = 'paymob',
         payment_reference = p_txn_id,
         paymob_transaction_id = p_txn_id,
         paid_at = NOW(),
         metadata = p_metadata
   WHERE id = p_invoice_id
     AND owner_type = 'teacher'
     AND teacher_id = p_teacher_id
     AND status <> 'paid';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RETURN 'already_paid';
  END IF;

  -- (b) Advance the subscription in the SAME transaction. Status changes go
  -- through the sanctioned transition (the lifecycle guard blocks direct status
  -- writes); period/payment columns are not guarded.
  SELECT id, status INTO v_sub_id, v_sub_status
    FROM teacher_subscriptions
   WHERE teacher_id = p_teacher_id
   ORDER BY created_at DESC
   LIMIT 1
   FOR UPDATE;

  IF FOUND THEN
    IF v_sub_status IS DISTINCT FROM 'active' THEN
      PERFORM public.apply_teacher_subscription_transition(v_sub_id, 'active', p_teacher_id);
    END IF;
    UPDATE teacher_subscriptions
       SET current_period_start = p_period_start,
           current_period_end = p_period_end,
           next_billing_at = p_period_end,
           last_payment_at = p_period_start,
           grace_until = NULL,
           dunning_attempts = 0
     WHERE id = v_sub_id;
  END IF;

  RETURN 'completed';
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.finalize_teacher_invoice_paid(uuid, uuid, numeric, text, jsonb, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_teacher_invoice_paid(uuid, uuid, numeric, text, jsonb, timestamptz, timestamptz) TO service_role;

NOTIFY pgrst, 'reload schema';
