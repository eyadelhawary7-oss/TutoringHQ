-- ============================================================================
-- cron-remove-redundant-jobs.sql — remove the redundant HTTP pg_cron jobs (Phase 6 / Fix C)
-- ----------------------------------------------------------------------------
-- WHAT / WHY
--   Ten pg_cron jobs do nothing but `net.http_post(...)` to a /api/cron/* Vercel
--   endpoint. Every one of those endpoints is ALSO scheduled by Vercel Cron in
--   vercel.json (the authoritative scheduler that runs + authenticates via
--   CRON_SECRET / requireCronSecret.ts). The pg_cron copies are therefore pure
--   duplicates — and currently failing: they 401 against Vercel and, in the case
--   of `daily-mrr-snapshot`, POST to /api/cron/mrr-snapshot which does not even
--   exist (the live route is snapshot-mrr). Removing them stops the constant
--   401s and makes the Vault/CRON_SECRET value moot for these jobs.
--
--   Step-0 cron-coverage check (live cron.job vs vercel.json), each duplicate ->
--   its covering Vercel cron:
--     process-renewals        -> /api/cron/process-renewals
--     detect-churn            -> /api/cron/detect-churn
--     daily-summary           -> /api/cron/daily-summary
--     ceo-briefing            -> /api/cron/ceo-briefing
--     compute-benchmarks      -> /api/cron/compute-benchmarks
--     recompute-health-scores -> /api/cron/recompute-health-scores
--     status-ping             -> /api/cron/status-ping
--     daily-mrr-snapshot      -> /api/cron/snapshot-mrr   (pg_cron posted to a dead path)
--     check-token-health      -> /api/cron/check-token-health
--     pack-billing            -> /api/cron/parent-pack-billing
--
-- DELIBERATELY KEPT: `backup-check-daily`. It is the ONLY pg_cron job that is
--   not an HTTP duplicate — a self-contained SQL freshness check that inserts an
--   'alert'/'ok' row into public.backup_log. It has NO Vercel equivalent, no
--   CRON_SECRET dependency, and is not failing. Removing it would silently end
--   daily backup-freshness alerting, so it stays in pg_cron.
--
-- IDEMPOTENT: each unschedule is guarded by an existence check, so re-running is
-- a no-op. Operational cron-catalog change (pg_cron jobs can't be rebuilt from
-- CI migrations) — applied LIVE against prod and captured in db/cron.snapshot.
-- Intentionally NOT a supabase/migrations/ file.
--
-- ROLLBACK: see the bottom of this file (recreate each job reading the bearer
-- from Vault, exactly as Phase 5 left them).
-- ============================================================================

DO $$
DECLARE
  j text;
  redundant text[] := ARRAY[
    'process-renewals','detect-churn','daily-summary','ceo-briefing',
    'compute-benchmarks','recompute-health-scores','status-ping',
    'daily-mrr-snapshot','check-token-health','pack-billing'
  ];
BEGIN
  FOREACH j IN ARRAY redundant LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = j) THEN
      PERFORM cron.unschedule(j);
      RAISE NOTICE 'unscheduled redundant pg_cron job: %', j;
    END IF;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- ROLLBACK — recreate the 10 jobs (each reads the bearer from Vault at runtime,
-- the Phase-5 state). Schedules/URLs are the pre-removal values.
--
--   SELECT cron.schedule('process-renewals',        '0 7 * * *',   $cmd$SELECT net.http_post(url := 'https://center-hq.vercel.app/api/cron/process-renewals',        headers := jsonb_build_object('Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')), body := '{}'::jsonb);$cmd$);
--   SELECT cron.schedule('detect-churn',            '0 2 * * *',   $cmd$SELECT net.http_post(url := 'https://center-hq.vercel.app/api/cron/detect-churn',            headers := jsonb_build_object('Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')), body := '{}'::jsonb);$cmd$);
--   SELECT cron.schedule('daily-summary',           '55 5 * * *',  $cmd$SELECT net.http_post(url := 'https://center-hq.vercel.app/api/cron/daily-summary',           headers := jsonb_build_object('Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')), body := '{}'::jsonb);$cmd$);
--   SELECT cron.schedule('ceo-briefing',            '0 7 * * *',   $cmd$SELECT net.http_post(url := 'https://center-hq.vercel.app/api/cron/ceo-briefing',            headers := jsonb_build_object('Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')), body := '{}'::jsonb);$cmd$);
--   SELECT cron.schedule('compute-benchmarks',      '0 1 * * *',   $cmd$SELECT net.http_post(url := 'https://center-hq.vercel.app/api/cron/compute-benchmarks',      headers := jsonb_build_object('Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')), body := '{}'::jsonb);$cmd$);
--   SELECT cron.schedule('recompute-health-scores', '0 2 * * *',   $cmd$SELECT net.http_post(url := 'https://center-hq.vercel.app/api/cron/recompute-health-scores', headers := jsonb_build_object('Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')), body := '{}'::jsonb);$cmd$);
--   SELECT cron.schedule('status-ping',             '*/5 * * * *', $cmd$SELECT net.http_post(url := 'https://center-hq.vercel.app/api/cron/status-ping',             headers := jsonb_build_object('Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')), body := '{}'::jsonb);$cmd$);
--   SELECT cron.schedule('daily-mrr-snapshot',      '0 0 * * *',   $cmd$SELECT net.http_post(url := 'https://center-hq.vercel.app/api/cron/mrr-snapshot',             headers := jsonb_build_object('Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')), body := '{}'::jsonb);$cmd$);
--   SELECT cron.schedule('check-token-health',      '0 8 * * 1',   $cmd$SELECT net.http_post(url := 'https://center-hq.vercel.app/api/cron/check-token-health',      headers := jsonb_build_object('Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')), body := '{}'::jsonb);$cmd$);
--   SELECT cron.schedule('pack-billing',            '0 8 1 * *',   $cmd$SELECT net.http_post(url := 'https://center-hq.vercel.app/api/cron/parent-pack-billing',      headers := jsonb_build_object('Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')), body := '{}'::jsonb);$cmd$);
--
-- (Rollback re-introduces the redundant 401-ing duplicates; use only to revert.)
-- ============================================================================
