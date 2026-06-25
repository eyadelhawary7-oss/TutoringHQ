-- One-time write guard: once finalized_at is set, session cannot be finalized again
ALTER TABLE combined_payment_sessions
  ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finalized_by TEXT
    CHECK (finalized_by IS NULL OR finalized_by IN ('webhook', 'cron', 'credits'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_combined_sessions_order_paid
  ON combined_payment_sessions (paymob_order_id)
  WHERE status = 'paid';

CREATE OR REPLACE FUNCTION try_finalize_payment_session(
  p_session_id UUID,
  p_finalized_by TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock_key BIGINT;
  v_status TEXT;
  v_finalized_at TIMESTAMPTZ;
BEGIN
  IF p_finalized_by IS NULL OR p_finalized_by NOT IN ('webhook', 'cron', 'credits') THEN
    RETURN FALSE;
  END IF;

  v_lock_key := ('x' || substr(p_session_id::TEXT, 1, 16))::bit(64)::BIGINT;

  IF NOT pg_try_advisory_xact_lock(v_lock_key) THEN
    RETURN FALSE;
  END IF;

  SELECT status, finalized_at
  INTO v_status, v_finalized_at
  FROM combined_payment_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF v_status = 'paid' OR v_finalized_at IS NOT NULL THEN
    RETURN FALSE;
  END IF;

  UPDATE combined_payment_sessions
  SET
    finalized_at = NOW(),
    finalized_by = p_finalized_by
  WHERE id = p_session_id
    AND finalized_at IS NULL;

  RETURN FOUND;
END;
$$;
