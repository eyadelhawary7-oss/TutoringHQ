-- ============================================================================
-- H6 — parent_portal_tokens hardening (minors' PII)
-- ----------------------------------------------------------------------------
-- Before: token stored in plaintext (looked up by equality), no revocation
--         column, minted with a 1-year TTL. A forwarded WhatsApp link exposed a
--         minor's data for up to a year, unrevokable.
-- After:  the raw token is stored only as a SHA-256 hash (compared by hash);
--         a revoked_at column is checked on every lookup (a revoked link is
--         dead); the lifetime moves to platform_config with a conservative
--         30-day interim default.
--
-- The table has 0 rows, so dropping the plaintext column is safe (no re-hash of
-- existing tokens needed). Access is service-role only (unchanged policy).
--
-- FLAG (Adsero-pending): 30 days is an interim safe default to stop the
-- year-long exposure now. Adsero confirms the final PDPL-allowed window; it is
-- then a one-value change to the platform_config row below — no code change.
-- ============================================================================

ALTER TABLE public.parent_portal_tokens ADD COLUMN token_hash text;
ALTER TABLE public.parent_portal_tokens ADD COLUMN revoked_at timestamptz;

-- 0 existing rows → drop the plaintext column outright.
ALTER TABLE public.parent_portal_tokens DROP COLUMN token;

ALTER TABLE public.parent_portal_tokens ALTER COLUMN token_hash SET NOT NULL;

-- Lookup is by token_hash; enforce uniqueness + fast probe.
CREATE UNIQUE INDEX parent_portal_tokens_token_hash_key
  ON public.parent_portal_tokens (token_hash);

-- Interim link lifetime (days). Adsero confirms the final PDPL window later.
INSERT INTO public.platform_config (key, value)
VALUES ('parent_portal.link_lifetime_days', '30'::jsonb)
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
