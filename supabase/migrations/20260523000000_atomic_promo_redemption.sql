-- Atomic promo redemption RPC.
--
-- Replaces the previous two-step flow (validate row, then call
-- increment_promo_uses) which was racy: two concurrent redemptions at
-- uses_count = max_uses_total - 1 could both pass validation, both pay,
-- both increment, and exceed max_uses_total. The earlier flow also did
-- not re-check is_active / expires_at at the moment of redemption, only
-- at /api/promo/validate.
--
-- redeem_promo_code() does the check + increment + redemption insert in a
-- single statement (function body runs in one transaction). Zero rows
-- returned means redemption was denied (inactive, expired, exhausted) OR
-- already redeemed by the same centre.

CREATE OR REPLACE FUNCTION redeem_promo_code(
  p_code_id UUID,
  p_user_id UUID,
  p_center_id UUID,
  p_paymob_order_id TEXT,
  p_original_amount_egp INTEGER,
  p_discount_amount_egp INTEGER
)
RETURNS TABLE (
  redemption_id UUID,
  discount_pct INTEGER,
  uses_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_redemption_id UUID;
  v_pct INTEGER;
  v_uses INTEGER;
BEGIN
  -- Atomic check + increment.
  UPDATE promo_codes
     SET uses_count = uses_count + 1
   WHERE id = p_code_id
     AND is_active = true
     AND (expires_at IS NULL OR expires_at > now())
     AND (max_uses_total IS NULL OR uses_count < max_uses_total)
  RETURNING promo_codes.discount_pct, promo_codes.uses_count
       INTO v_pct, v_uses;

  IF NOT FOUND THEN
    -- Code is inactive, expired, or exhausted. Deny redemption.
    RETURN;
  END IF;

  -- Per-centre idempotency: UNIQUE(promo_code_id, center_id) on
  -- promo_code_redemptions. If a redemption already exists for this centre,
  -- ON CONFLICT DO NOTHING + the rollback below keep uses_count consistent.
  INSERT INTO promo_code_redemptions (
    promo_code_id, user_id, center_id, paymob_order_id,
    original_amount_egp, discount_amount_egp
  ) VALUES (
    p_code_id, p_user_id, p_center_id, p_paymob_order_id,
    p_original_amount_egp, p_discount_amount_egp
  )
  ON CONFLICT (promo_code_id, center_id) DO NOTHING
  RETURNING id INTO v_redemption_id;

  IF v_redemption_id IS NULL THEN
    -- Already redeemed by this centre. Roll the increment back so
    -- uses_count reflects unique-centre redemptions only.
    UPDATE promo_codes
       SET uses_count = uses_count - 1
     WHERE id = p_code_id;
    RETURN;
  END IF;

  RETURN QUERY SELECT v_redemption_id, v_pct, v_uses;
END;
$$;

COMMENT ON FUNCTION redeem_promo_code(UUID, UUID, UUID, TEXT, INTEGER, INTEGER) IS
  'Atomic promo redemption: checks is_active / expires_at / max_uses_total, inserts a redemption row, and increments uses_count in one statement. Empty result = denied or already-redeemed.';

COMMENT ON FUNCTION increment_promo_uses(UUID) IS
  'DEPRECATED: use redeem_promo_code() which atomically enforces is_active / expires_at / max_uses_total. Kept for backward compatibility only.';

-- ── Verification (Rule 146) ──────────────────────────────────────────────────
-- After applying, paste this into the Supabase SQL editor to confirm the
-- function exists with the right signature. Do NOT rely on schema_migrations.
--
--   SELECT p.proname,
--          pg_catalog.pg_get_function_identity_arguments(p.oid) AS args
--     FROM pg_proc p
--     JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.proname = 'redeem_promo_code';
--
-- Expected one row: proname='redeem_promo_code', args matching the signature above.
