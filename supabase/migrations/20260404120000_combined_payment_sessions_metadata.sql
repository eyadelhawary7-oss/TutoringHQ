-- Store upgrade/reactivation payload for webhook finalization (Paymob order id is idempotency key).
ALTER TABLE combined_payment_sessions
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
