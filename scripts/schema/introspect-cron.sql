-- ============================================================================
-- introspect-cron.sql — pg_cron job snapshot (live-drift check only)
-- ----------------------------------------------------------------------------
-- pg_cron jobs are operational scheduling state that a bare-postgres CI rebuild
-- cannot reproduce, so they are NOT part of the main introspect.sql / CI gate.
-- The scheduled LIVE-drift check runs this against prod (which has pg_cron) and
-- diffs the result against db/cron.snapshot to catch a job created or changed
-- directly on prod. Run only against an environment that has the pg_cron
-- extension installed (i.e. production).
--
-- RUN THIS WITH A PRIVILEGED CONNECTION — NOT the read-only drift role.
-- cron.job carries row-level security (cron_job_policy: USING (username =
-- current_user)) and has no RLS-free catalog mirror, so a role only ever sees
-- the jobs it OWNS. Prod jobs are owned by `postgres`, so a plain read-only role
-- sees ZERO rows and this snapshot comes back empty. We deliberately do NOT
-- grant the read-only drift role BYPASSRLS or any other elevated privilege, so
-- the scheduled live-drift job (schema-drift-live.yml) SKIPS cron entirely and
-- watches the public schema only. Use this file for an on-demand cron check via
-- a connection that can see cron.job (the `postgres` job owner, or a role with
-- BYPASSRLS), diffing its output against db/cron.snapshot.
-- ============================================================================
-- rtrim() strips trailing whitespace: a job command that ends in a newline (e.g.
-- a heredoc-style multi-line INSERT) would otherwise collapse to a trailing
-- space via the '\s+' -> ' ' rule and register as spurious one-byte drift.
SELECT rtrim(
         'CRON_JOB ' || j.jobname
         || ' schedule=' || j.schedule
         || ' active=' || j.active
         -- redact bearer tokens (the CRON_SECRET): never persist secrets in the
         -- committed snapshot. Secret rotation is not schema drift; schedule/URL
         -- changes still surface. (As of 2026-06 the secret is no longer embedded
         -- in job SQL at all — jobs read it from Supabase Vault at runtime — so
         -- this redaction is now defence-in-depth.)
         || ' command=' || regexp_replace(
              regexp_replace(j.command, 'Bearer\s+[A-Za-z0-9._-]+', 'Bearer ***', 'g'),
              '\s+', ' ', 'g')
       ) AS line
FROM cron.job j
ORDER BY j.jobid;
