-- ============================================================================
-- Phase 1 / Fix C — make the combined wallet+card finalize all-or-nothing
-- ----------------------------------------------------------------------------
-- Problem: try_finalize_payment_session set finalized_at up front (as the lock).
-- The combined finalize then spent the customer's wallet credit
-- (spend_credits_atomic) and only afterwards applied the center/invoice updates.
-- If a post-spend step failed, the session was marked status='failed' but
-- finalized_at was already set and the credit already consumed. The
-- check-stuck-payments cron filters `finalized_at IS NULL`, so it skipped the
-- session forever: credit gone, card charged, session frozen.
--
-- Two DB changes (the TS finalizer is reordered to match, in
-- src/lib/combinedPaymentFinalize.ts):
--   (1) try_finalize_payment_session becomes a NON-mutating claim check — it no
--       longer writes finalized_at. finalized_at is now set ONLY on genuine
--       completion, so a failed/partial attempt never freezes the cron.
--   (2) finalize_combined_session_paid(uuid, numeric, text): one transaction
--       that spends the wallet credit AND marks the session paid + finalized in
--       a single atomic step. If the credit spend raises (e.g. insufficient
--       credit) the whole function rolls back: no credit consumed, status
--       unchanged, finalized_at still NULL — fully recoverable by the cron.
--   The TS finalizer performs all NON-money mutations (center/invoice/log/
--   teacher) first, then calls this RPC as the final atomic money step, so a
--   failure before it cannot consume credit.
--
-- Reversible. ROLLBACK:
--   * Restore try_finalize_payment_session from 00000000000000_baseline.sql
--     (the version that sets finalized_at = NOW()).
--   * DROP FUNCTION public.finalize_combined_session_paid(uuid, numeric, text);
--   * Restore the prior src/lib/combinedPaymentFinalize.ts + cron from git.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- (1) Non-mutating claim check. Returns TRUE if the session is still
-- finalizable; does NOT write finalized_at (that moves to completion).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.try_finalize_payment_session(p_session_id uuid, p_finalized_by text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lock_key BIGINT;
  v_status TEXT;
  v_finalized_at TIMESTAMPTZ;
BEGIN
  IF p_finalized_by IS NULL OR p_finalized_by NOT IN ('webhook', 'cron', 'credits') THEN
    RETURN FALSE;
  END IF;

  -- Hyphens are stripped before the hex->bit cast: substr() over the raw uuid
  -- text would include a '-' (invalid hex) and abort. (The pre-Phase-1
  -- try_finalize_payment_session had this latent bug; it never fired because no
  -- combined session had ever been finalized.)
  v_lock_key := ('x' || substr(replace(p_session_id::TEXT, '-', ''), 1, 16))::bit(64)::BIGINT;

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

  -- Already completed, or already finalized by a concurrent winner.
  IF v_status = 'paid' OR v_finalized_at IS NOT NULL THEN
    RETURN FALSE;
  END IF;

  -- Expired sessions are never finalized.
  IF v_status = 'expired' THEN
    RETURN FALSE;
  END IF;

  -- Claimable (status pending or a recoverable prior 'failed'). finalized_at is
  -- intentionally NOT written here — the real, single source of "done" is
  -- finalize_combined_session_paid, so a later failure leaves nothing stranded.
  RETURN TRUE;
END;
$function$;

-- ---------------------------------------------------------------------------
-- (2) Atomic money step: spend credit + mark paid + set finalized_at, all in
-- one transaction. Reuses spend_credits_atomic (no parallel credit logic).
-- Returns: 'completed' | 'already_done' | 'not_found' | 'expired'.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_combined_session_paid(p_session_id uuid, p_credit_amount numeric, p_finalized_by text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lock_key BIGINT;
  v_status TEXT;
  v_finalized_at TIMESTAMPTZ;
  v_center uuid;
BEGIN
  IF p_finalized_by IS NULL OR p_finalized_by NOT IN ('webhook', 'cron', 'credits') THEN
    RAISE EXCEPTION 'invalid finalized_by: %', p_finalized_by;
  END IF;

  -- Hyphens are stripped before the hex->bit cast: substr() over the raw uuid
  -- text would include a '-' (invalid hex) and abort. (The pre-Phase-1
  -- try_finalize_payment_session had this latent bug; it never fired because no
  -- combined session had ever been finalized.)
  v_lock_key := ('x' || substr(replace(p_session_id::TEXT, '-', ''), 1, 16))::bit(64)::BIGINT;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT status, finalized_at, center_id
  INTO v_status, v_finalized_at, v_center
  FROM combined_payment_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  -- Idempotent: a concurrent/earlier winner already finalized this session.
  IF v_status = 'paid' OR v_finalized_at IS NOT NULL THEN
    RETURN 'already_done';
  END IF;

  IF v_status = 'expired' THEN
    RETURN 'expired';
  END IF;

  -- All-or-nothing money step: the credit spend and the finalize marker commit
  -- together. If spend_credits_atomic raises, the whole function rolls back —
  -- no credit consumed, status unchanged, finalized_at still NULL.
  IF p_credit_amount IS NOT NULL AND p_credit_amount > 0 THEN
    IF v_center IS NULL THEN
      RAISE EXCEPTION 'finalize_combined_session_paid: credit spend requires a center_id (session %)', p_session_id;
    END IF;
    PERFORM spend_credits_atomic(v_center, p_credit_amount, p_session_id, 'subscription');
  END IF;

  UPDATE combined_payment_sessions
  SET status = 'paid',
      finalized_at = NOW(),
      finalized_by = p_finalized_by
  WHERE id = p_session_id;

  RETURN 'completed';
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.finalize_combined_session_paid(uuid, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_combined_session_paid(uuid, numeric, text) TO service_role;

NOTIFY pgrst, 'reload schema';
