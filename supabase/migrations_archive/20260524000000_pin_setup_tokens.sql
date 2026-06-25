-- pin_setup_tokens — Set-PIN-on-first-login onboarding (Option B).
--
-- Authority to set the initial PIN on a freshly-created owner account.
-- Rows are issued by:
--   1. /api/paymob/webhook (HMAC-verified) after payment confirms — happy path,
--      no plaintext token stored (token_hash NULL); authorization at use time
--      comes from the signed signup-session cookie + paid+activated DB state.
--   2. /api/auth/request-pin-setup-link (anti-enumerated, rate-limited) — fallback
--      for closed-tab / cross-device; row carries a SHA256 token_hash and the
--      plaintext is delivered out-of-band via chq_pin_setup_link WhatsApp.
--
-- Consumed atomically by /api/auth/set-initial-pin via single-row UPDATE
-- ... WHERE used_at IS NULL AND expires_at > now() RETURNING ... — first claim
-- wins, replays land on rowCount=0.
--
-- Idempotent at MIGRATION level (IF NOT EXISTS) and at WEBHOOK level
-- (partial unique index prevents a webhook replay from issuing a second alive
-- webhook-issued row for the same user_id).

BEGIN;

CREATE TABLE IF NOT EXISTS public.pin_setup_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash   text NULL,
  source       text NOT NULL CHECK (source IN ('webhook_paymob', 'fallback_link')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz NULL,
  used_ip      text NULL,
  CONSTRAINT pin_setup_tokens_hash_required_for_fallback
    CHECK (source <> 'fallback_link' OR token_hash IS NOT NULL),
  CONSTRAINT pin_setup_tokens_hash_absent_for_webhook
    CHECK (source <> 'webhook_paymob' OR token_hash IS NULL)
);

-- Live token lookup by user_id (cookie path on set-initial-pin).
CREATE INDEX IF NOT EXISTS pin_setup_tokens_user_live_idx
  ON public.pin_setup_tokens (user_id)
  WHERE used_at IS NULL;

-- Live token lookup by hash (fallback URL path on set-initial-pin).
CREATE UNIQUE INDEX IF NOT EXISTS pin_setup_tokens_hash_unique_idx
  ON public.pin_setup_tokens (token_hash)
  WHERE token_hash IS NOT NULL;

-- Webhook idempotency: at most one alive webhook-issued grant per user_id.
-- Paymob webhook replays land on this constraint and are no-ops (INSERT ...
-- ON CONFLICT DO NOTHING in the application code).
CREATE UNIQUE INDEX IF NOT EXISTS pin_setup_tokens_one_live_webhook_per_user_idx
  ON public.pin_setup_tokens (user_id)
  WHERE source = 'webhook_paymob' AND used_at IS NULL;

ALTER TABLE public.pin_setup_tokens ENABLE ROW LEVEL SECURITY;

-- No RLS policies defined: this table is service-role only. The set-initial-pin
-- and request-pin-setup-link routes use the admin client (RLS bypass) and gate
-- access at the application layer (signed cookie + paid state, or hashed token
-- + paid state). Owners must NEVER be able to read or mutate this table via
-- their own session.

COMMIT;
