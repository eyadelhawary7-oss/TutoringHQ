-- ============================================================================
-- Phase 1 / Fix A — close the "free money" doors on money/credit/billing RPCs
-- ----------------------------------------------------------------------------
-- Problem: these SECURITY DEFINER RPCs were GRANT EXECUTE ... TO authenticated,
-- so any signed-in user could POST /rest/v1/rpc/<fn> directly and bypass every
-- server-side wrapper — minting credit (earn_credits_atomic) or marking a
-- subscription invoice paid for a token amount (process_payment_rpc, which did
-- not check the amount covered the invoice).
--
-- Two layers:
--   (1) Revoke EXECUTE from PUBLIC, anon, authenticated on every money/credit/
--       billing definer RPC; keep service_role. All legitimate callers use the
--       service-role client (verified: billingEngine, crons, Paymob webhook,
--       requireCenterAuth().supabaseAdmin), which bypasses GRANTs — unaffected.
--   (2) Defense in depth INSIDE each credit/money function so a future
--       re-exposure cannot be exploited: do NOT trust p_center_id as authority.
--       assert_caller_center_access() raises if an *authenticated* end-user calls
--       for a center they do not belong to. Server-side / service-role context
--       has auth.uid() = NULL and is allowed (GRANTs remain the gate there).
--   (2b) process_payment_rpc additionally refuses to mark an invoice paid /
--        advance the billing date unless the amount applied covers the invoice
--        total (underpayment must never clear an invoice).
--
-- Reversible. ROLLBACK:
--   * Restore grants:  GRANT EXECUTE ON FUNCTION <sig> TO authenticated;
--     for each function listed in the revoke block below.
--   * Restore pre-Phase-1 bodies: CREATE OR REPLACE each function from
--     supabase/migrations/00000000000000_baseline.sql (drops the guard call and
--     the underpayment check).
--   * DROP FUNCTION public.assert_caller_center_access(uuid);
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Shared guard. Called from within the SECURITY DEFINER money RPCs (which run as
-- the function owner), so it needs no PostgREST exposure of its own.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_caller_center_access(p_center_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid    uuid;
  v_center uuid;
BEGIN
  v_uid := auth.uid();
  -- No authenticated end-user (service-role / server-side): GRANTs are the gate.
  IF v_uid IS NULL THEN
    RETURN;
  END IF;
  SELECT center_id INTO v_center FROM public.users WHERE id = v_uid;
  IF v_center IS NULL OR v_center IS DISTINCT FROM p_center_id THEN
    RAISE EXCEPTION 'forbidden: caller does not belong to center %', p_center_id
      USING ERRCODE = '42501';
  END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.assert_caller_center_access(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_caller_center_access(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- earn_credits_atomic — + caller-center guard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.earn_credits_atomic(p_center_id uuid, p_amount numeric, p_reference_id uuid, p_reference_type text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current_balance NUMERIC;
  v_current_plan TEXT;
  v_all_in_price NUMERIC;
  v_max_balance NUMERIC;
  v_new_balance NUMERIC;
  v_expires_at TIMESTAMPTZ;
BEGIN
  PERFORM public.assert_caller_center_access(p_center_id);

  SELECT credit_balance, plan, all_in_price
  INTO v_current_balance, v_current_plan, v_all_in_price
  FROM centers WHERE id = p_center_id FOR UPDATE;

  v_max_balance := COALESCE(v_all_in_price, 0) * 3;
  v_expires_at := NOW() + INTERVAL '6 months';

  INSERT INTO credit_ledger (
    center_id, amount, type,
    reference_id, reference_type, expires_at
  ) VALUES (
    p_center_id, p_amount, 'earned',
    p_reference_id, p_reference_type, v_expires_at
  );

  v_new_balance := LEAST(v_max_balance, v_current_balance + p_amount);

  UPDATE centers
  SET credit_balance = v_new_balance
  WHERE id = p_center_id;

  RETURN v_new_balance;
END;
$function$;

-- ---------------------------------------------------------------------------
-- spend_credits_atomic — + caller-center guard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.spend_credits_atomic(p_center_id uuid, p_amount numeric, p_reference_id uuid, p_reference_type text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_remaining NUMERIC := p_amount;
  v_batch RECORD;
  v_use_amount NUMERIC;
BEGIN
  PERFORM public.assert_caller_center_access(p_center_id);

  PERFORM id FROM centers WHERE id = p_center_id FOR UPDATE;

  FOR v_batch IN
    SELECT id, amount FROM credit_ledger
    WHERE center_id = p_center_id
      AND type = 'earned'
      AND amount > 0
      AND expires_at > NOW()
    ORDER BY created_at ASC
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_use_amount := LEAST(v_batch.amount, v_remaining);

    UPDATE credit_ledger
    SET amount = amount - v_use_amount
    WHERE id = v_batch.id;

    INSERT INTO credit_ledger (
      center_id, amount, type,
      reference_id, reference_type
    ) VALUES (
      p_center_id, -v_use_amount, 'spent',
      p_reference_id, p_reference_type
    );

    v_remaining := v_remaining - v_use_amount;
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Insufficient credits';
  END IF;

  UPDATE centers
  SET credit_balance = GREATEST(0,
    credit_balance - p_amount)
  WHERE id = p_center_id;

  RETURN TRUE;
END;
$function$;

-- ---------------------------------------------------------------------------
-- reserve_credits_atomic — + caller-center guard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reserve_credits_atomic(p_center_id uuid, p_amount numeric)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_available NUMERIC;
BEGIN
  PERFORM public.assert_caller_center_access(p_center_id);

  SELECT credit_balance - COALESCE(credit_reserved, 0)
  INTO v_available
  FROM centers WHERE id = p_center_id FOR UPDATE;

  IF v_available < p_amount THEN
    RETURN FALSE;
  END IF;

  UPDATE centers
  SET credit_reserved = COALESCE(credit_reserved, 0) + p_amount
  WHERE id = p_center_id;

  RETURN TRUE;
END;
$function$;

-- ---------------------------------------------------------------------------
-- cancel_reservation_atomic — + caller-center guard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_reservation_atomic(p_center_id uuid, p_amount numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assert_caller_center_access(p_center_id);

  UPDATE centers
  SET credit_reserved = GREATEST(0,
    COALESCE(credit_reserved, 0) - p_amount)
  WHERE id = p_center_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- process_payment_rpc — + caller-center guard + underpayment guard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_payment_rpc(p_center_id uuid, p_invoice_id uuid, p_amount numeric, p_payment_method text DEFAULT 'paymob'::text, p_recorded_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_invoice     RECORD;
  v_center      RECORD;
  v_payment_id  UUID;
BEGIN
  PERFORM public.assert_caller_center_access(p_center_id);

  SELECT * INTO v_invoice
  FROM invoices
  WHERE id = p_invoice_id AND center_id = p_center_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invoice_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_invoice.status = 'paid' THEN
    RAISE EXCEPTION 'invoice_already_paid' USING ERRCODE = 'P0002';
  END IF;

  -- Underpayment guard: the amount applied must cover the invoice total before
  -- the invoice is marked paid and the billing date is advanced. A partial
  -- amount must NOT clear the invoice (aligns with the underpayment rules).
  IF p_amount IS NULL OR p_amount < v_invoice.total_amount THEN
    RAISE EXCEPTION 'underpayment: amount % is below invoice total %', p_amount, v_invoice.total_amount
      USING ERRCODE = 'P0003';
  END IF;

  INSERT INTO payments (
    center_id, amount, method, paid_at, recorded_by
  )
  VALUES (
    p_center_id, p_amount, p_payment_method, NOW(), p_recorded_by
  )
  RETURNING id INTO v_payment_id;

  UPDATE invoices
  SET status = 'paid', paid_at = NOW()
  WHERE id = p_invoice_id;

  SELECT * INTO v_center FROM centers WHERE id = p_center_id FOR UPDATE;

  UPDATE centers
  SET
    billing_status   = 'paid',
    next_payment_due = CASE
      WHEN v_center.billing_cycle = 'monthly'
        THEN (v_center.next_payment_due + INTERVAL '1 month')::date
      WHEN v_center.billing_cycle = 'annual'
        THEN (v_center.next_payment_due + INTERVAL '1 year')::date
      ELSE
        (v_center.next_payment_due + INTERVAL '3 months')::date
    END
  WHERE id = p_center_id;

  INSERT INTO center_metrics_daily (
    center_id, metric_date,
    payments_recorded, last_payment_at, last_upserted_at
  )
  VALUES (
    p_center_id, CURRENT_DATE, 1, NOW(), NOW()
  )
  ON CONFLICT (center_id, metric_date) DO UPDATE SET
    payments_recorded = center_metrics_daily.payments_recorded + 1,
    last_payment_at   = NOW(),
    last_upserted_at  = NOW();

  RETURN jsonb_build_object(
    'success',    true,
    'payment_id', v_payment_id,
    'invoice_id', p_invoice_id
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$function$;

-- ---------------------------------------------------------------------------
-- deduct_blast_balance_rpc — + caller-center guard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.deduct_blast_balance_rpc(p_center_id uuid, p_blast_type text, p_parent_count integer, p_message_body text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cap           INTEGER;
  v_current_month TEXT;
  v_current_count INTEGER;
  v_blast_id      UUID;
  v_cap_config    JSONB;
BEGIN
  PERFORM public.assert_caller_center_access(p_center_id);

  v_current_month := to_char(NOW(), 'YYYY-MM');

  -- Fetch cap from platform_config (key-value pattern)
  SELECT value INTO v_cap_config
  FROM platform_config
  WHERE key = 'announcement_cap_monthly';

  v_cap := COALESCE((v_cap_config)::INTEGER, 2);

  -- Count blasts this month for this center
  SELECT COUNT(*) INTO v_current_count
  FROM announcement_blasts
  WHERE center_id = p_center_id
    AND to_char(created_at, 'YYYY-MM') = v_current_month;

  IF v_current_count >= v_cap THEN
    RETURN jsonb_build_object(
      'success',       false,
      'error',         'cap_exceeded',
      'current_count', v_current_count,
      'cap',           v_cap
    );
  END IF;

  -- Insert announcement blast record
  INSERT INTO announcement_blasts (
    center_id,
    sent_by,
    template_name,
    blast_type,
    message,
    parents_notified,
    base_amount,
    service_fee,
    vat,
    total_amount,
    billing_status
  )
  VALUES (
    p_center_id,
    NULL,
    CASE
      WHEN p_blast_type = 'promo' THEN 'chq_parent_announcement_promo'
      ELSE 'chq_parent_announcement_ops'
    END,
    p_blast_type,
    p_message_body,
    p_parent_count,
    -- base: 8 EGP * parent_count
    ROUND((8 * p_parent_count)::NUMERIC, 2),
    -- service fee 6.5% of base
    ROUND((8 * p_parent_count * 0.065)::NUMERIC, 2),
    -- VAT 14% of base
    ROUND((8 * p_parent_count * 0.14)::NUMERIC, 2),
    -- total inclusive: 9.71 * parent_count
    ROUND((9.71 * p_parent_count)::NUMERIC, 2),
    'pending'
  )
  RETURNING id INTO v_blast_id;

  RETURN jsonb_build_object(
    'success',     true,
    'blast_id',    v_blast_id,
    'new_count',   v_current_count + 1,
    'cap',         v_cap,
    'total_amount', ROUND((9.71 * p_parent_count)::NUMERIC, 2)
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$function$;

-- ---------------------------------------------------------------------------
-- Layer 1: revoke the authenticated/anon/PUBLIC PostgREST surface on every
-- money/credit/billing definer RPC. service_role retained (re-grant idempotent).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  names text[] := ARRAY[
    'earn_credits_atomic','spend_credits_atomic','reserve_credits_atomic',
    'cancel_reservation_atomic','process_payment_rpc','deduct_blast_balance_rpc',
    'redeem_promo_code','increment_promo_uses','try_finalize_payment_session'
  ];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
    WHERE p.proname = ANY(names)
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
