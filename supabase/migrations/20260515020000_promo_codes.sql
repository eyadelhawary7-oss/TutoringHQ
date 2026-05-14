-- Promo-code system: codes table, redemptions table, and invoice promo columns.

-- ── promo_codes ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS promo_codes (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code             TEXT        NOT NULL,
  discount_pct     INTEGER     NOT NULL CHECK (discount_pct > 0 AND discount_pct <= 100),
  max_uses_total   INTEGER,                            -- NULL = unlimited
  uses_count       INTEGER     NOT NULL DEFAULT 0,
  expires_at       TIMESTAMPTZ,                        -- NULL = no expiry
  is_active        BOOLEAN     NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID,                               -- nullable; references admin user
  CONSTRAINT promo_codes_code_upper CHECK (code = upper(code)),
  CONSTRAINT promo_codes_code_unique UNIQUE (code)
);

CREATE INDEX IF NOT EXISTS idx_promo_codes_code       ON promo_codes (code);
CREATE INDEX IF NOT EXISTS idx_promo_codes_is_active  ON promo_codes (is_active);

-- ── promo_code_redemptions ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS promo_code_redemptions (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_code_id         UUID        NOT NULL REFERENCES promo_codes (id),
  user_id               UUID,                         -- nullable until user is created on auto-approve
  center_id             UUID        NOT NULL,
  redeemed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  paymob_order_id       TEXT,                         -- set after payment confirmed
  original_amount_egp   INTEGER     NOT NULL,
  discount_amount_egp   INTEGER     NOT NULL,
  -- One code use per center (signup path: user may not exist at redemption time)
  CONSTRAINT promo_code_redemptions_unique_center UNIQUE (promo_code_id, center_id)
);

CREATE INDEX IF NOT EXISTS idx_pcr_promo_code_id  ON promo_code_redemptions (promo_code_id);
CREATE INDEX IF NOT EXISTS idx_pcr_center_id      ON promo_code_redemptions (center_id);
CREATE INDEX IF NOT EXISTS idx_pcr_user_id        ON promo_code_redemptions (user_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE promo_codes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_code_redemptions ENABLE ROW LEVEL SECURITY;

-- Service-role (used by all API routes) bypasses RLS automatically.
-- Authenticated users may read active promo codes (client-side validation hint).
CREATE POLICY "promo_codes_select_authenticated"
  ON promo_codes FOR SELECT TO authenticated
  USING (true);

-- Center owners may read their own redemption records.
CREATE POLICY "promo_code_redemptions_select_own"
  ON promo_code_redemptions FOR SELECT TO authenticated
  USING (
    center_id IN (
      SELECT c.id FROM centers c
      JOIN users u ON u.center_id = c.id
      WHERE u.id = auth.uid()
    )
  );

-- ── invoices: add promo tracking columns ─────────────────────────────────────
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS promo_code             TEXT,
  ADD COLUMN IF NOT EXISTS promo_original_amount  NUMERIC;

-- ── Helper RPC: atomically increment uses_count ───────────────────────────────
CREATE OR REPLACE FUNCTION increment_promo_uses(code_id UUID)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE promo_codes SET uses_count = uses_count + 1 WHERE id = code_id;
$$;
