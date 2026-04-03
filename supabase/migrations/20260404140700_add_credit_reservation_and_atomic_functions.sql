ALTER TABLE centers
  ADD COLUMN IF NOT EXISTS credit_reserved NUMERIC NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION earn_credits_atomic(
  p_center_id UUID,
  p_amount NUMERIC,
  p_reference_id UUID,
  p_reference_type TEXT
) RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_balance NUMERIC;
  v_current_plan TEXT;
  v_all_in_price NUMERIC;
  v_max_balance NUMERIC;
  v_new_balance NUMERIC;
  v_expires_at TIMESTAMPTZ;
BEGIN
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
$$;

CREATE OR REPLACE FUNCTION spend_credits_atomic(
  p_center_id UUID,
  p_amount NUMERIC,
  p_reference_id UUID,
  p_reference_type TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_remaining NUMERIC := p_amount;
  v_batch RECORD;
  v_use_amount NUMERIC;
BEGIN
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
$$;

CREATE OR REPLACE FUNCTION reserve_credits_atomic(
  p_center_id UUID,
  p_amount NUMERIC
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_available NUMERIC;
BEGIN
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
$$;

CREATE OR REPLACE FUNCTION cancel_reservation_atomic(
  p_center_id UUID,
  p_amount NUMERIC
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE centers
  SET credit_reserved = GREATEST(0,
    COALESCE(credit_reserved, 0) - p_amount)
  WHERE id = p_center_id;
END;
$$;
