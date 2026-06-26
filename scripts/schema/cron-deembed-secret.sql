-- ============================================================================
-- cron-deembed-secret.sql — De-embed CRON_SECRET from pg_cron job SQL (Phase 5)
-- ----------------------------------------------------------------------------
-- WHAT / WHY
--   Historically the 10 HTTP pg_cron jobs embedded the CRON_SECRET as a literal
--   bearer token inside their command SQL:
--       headers := '{"Authorization":"Bearer <SECRET>"}'::jsonb
--   That literal is visible in the cron.job catalog, dashboards, and DB
--   snapshots. This script moves the secret into Supabase Vault and rewrites the
--   jobs to read it at runtime, so the literal never sits in the catalog again.
--
--   The VALUE is unchanged by this script (no rotation) — each job sends exactly
--   the same bearer it sent before. Rotation is a separate go-live step; see
--   docs/CRON_SECRET_VAULT.md.
--
-- IDEMPOTENT: the rewrite loop only touches jobs that still embed a literal, so
-- re-running is a no-op. Vault secret creation is guarded.
--
-- This is an operational cron-catalog change (pg_cron jobs cannot be rebuilt
-- from migrations in CI), applied LIVE against prod and captured in
-- db/cron.snapshot. It is intentionally NOT a supabase/migrations/ file.
--
-- ROLLBACK: see the bottom of this file.
-- ============================================================================

-- 1) Store the current secret in Vault, extracting it from an existing job so
--    the literal is handled entirely server-side (never typed in or returned).
--    Guarded so a re-run does not create a duplicate.
DO $$
DECLARE
  v_secret text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'cron_secret') THEN
    v_secret := (regexp_match(
      (SELECT command FROM cron.job WHERE command ~ 'Bearer\s+[A-Za-z0-9._-]{8,}' ORDER BY jobid LIMIT 1),
      'Bearer\s+([A-Za-z0-9._-]+)'
    ))[1];
    IF v_secret IS NULL THEN
      RAISE EXCEPTION 'No embedded bearer literal found to seed vault.cron_secret';
    END IF;
    PERFORM vault.create_secret(
      v_secret,
      'cron_secret',
      'CenterHQ pg_cron Authorization bearer token. Must equal Vercel env CRON_SECRET '
      || '(verified by src/lib/cron/requireCronSecret.ts). De-embedded 2026-06; rotate at go-live.'
    );
  END IF;
END $$;

-- 2) Rewrite every job that still embeds a literal bearer so it reads the secret
--    from Vault at runtime. URL and schedule are preserved from the existing row
--    (cron.schedule upserts by jobname, keeping the same jobid).
DO $$
DECLARE
  j RECORD;
  v_url text;
  new_cmd text;
BEGIN
  FOR j IN
    SELECT jobname, schedule, command
    FROM cron.job
    WHERE command ~ 'Bearer\s+[A-Za-z0-9._-]{8,}'
    ORDER BY jobid
  LOOP
    v_url := (regexp_match(j.command, 'url\s*:=\s*''([^'']+)'''))[1];
    IF v_url IS NULL THEN
      RAISE EXCEPTION 'Could not extract url for job %', j.jobname;
    END IF;
    new_cmd :=
      'SELECT net.http_post(url := ' || quote_literal(v_url) ||
      ', headers := jsonb_build_object(''Authorization'', ''Bearer '' || ' ||
      '(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''cron_secret''))' ||
      ', body := ''{}''::jsonb);';
    PERFORM cron.schedule(j.jobname, j.schedule, new_cmd);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- ROLLBACK (re-embed the literal from Vault, back into each job command):
--
--   DO $$
--   DECLARE j RECORD; v_url text; v_secret text; new_cmd text;
--   BEGIN
--     v_secret := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='cron_secret');
--     FOR j IN SELECT jobname, schedule, command FROM cron.job
--              WHERE command ILIKE '%vault.decrypted_secrets%' ORDER BY jobid LOOP
--       v_url := (regexp_match(j.command, 'url\s*:=\s*''([^'']+)'''))[1];
--       new_cmd := 'SELECT net.http_post(url := ' || quote_literal(v_url) ||
--         ', headers := ' || quote_literal('{"Authorization":"Bearer ' || v_secret || '"}') || '::jsonb' ||
--         ', body := ''{}''::jsonb);';
--       PERFORM cron.schedule(j.jobname, j.schedule, new_cmd);
--     END LOOP;
--   END $$;
--   -- then optionally: SELECT vault.delete_secret(id) FROM vault.secrets WHERE name='cron_secret';
--
-- (Rollback re-introduces the very catalog-visibility issue this fixes; use only
--  to revert in an emergency.)
-- ============================================================================
