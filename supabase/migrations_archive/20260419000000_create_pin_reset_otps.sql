-- OTP storage for public PIN reset (WhatsApp delivery). Accessed only via service role.

CREATE TABLE IF NOT EXISTS pin_reset_otps (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone      TEXT NOT NULL,
  otp_hash   TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
  used       BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pin_reset_otps_phone
  ON pin_reset_otps (phone, expires_at);

CREATE INDEX IF NOT EXISTS idx_pin_reset_otps_expires
  ON pin_reset_otps (expires_at);

ALTER TABLE pin_reset_otps ENABLE ROW LEVEL SECURITY;
