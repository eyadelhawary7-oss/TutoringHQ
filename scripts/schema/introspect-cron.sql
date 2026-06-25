-- ============================================================================
-- introspect-cron.sql — pg_cron job snapshot (live-drift check only)
-- ----------------------------------------------------------------------------
-- pg_cron jobs are operational scheduling state that a bare-postgres CI rebuild
-- cannot reproduce, so they are NOT part of the main introspect.sql / CI gate.
-- The scheduled LIVE-drift check runs this against prod (which has pg_cron) and
-- diffs the result against db/cron.snapshot to catch a job created or changed
-- directly on prod. Run only against an environment that has the pg_cron
-- extension installed (i.e. production).
-- ============================================================================
SELECT 'CRON_JOB ' || j.jobname
       || ' schedule=' || j.schedule
       || ' active=' || j.active
       -- redact bearer tokens (the CRON_SECRET): never persist secrets in the
       -- committed snapshot. Secret rotation is not schema drift; schedule/URL
       -- changes still surface.
       || ' command=' || regexp_replace(
            regexp_replace(j.command, 'Bearer\s+[A-Za-z0-9._-]+', 'Bearer ***', 'g'),
            '\s+', ' ', 'g') AS line
FROM cron.job j
ORDER BY j.jobid;
