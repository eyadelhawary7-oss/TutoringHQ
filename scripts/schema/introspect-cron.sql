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
-- READ-ONLY ROLE REQUIREMENT: cron.job carries row-level security
-- (cron_job_policy: USING (username = current_user)), so a role only ever sees
-- the jobs it OWNS. Prod jobs are owned by `postgres`, so a plain read-only
-- drift role sees ZERO rows and this snapshot comes back empty — every job
-- false-trips as "removed". Unlike the public-schema grants (which moved to
-- catalog columns any role can read), cron.job has no RLS-free catalog mirror,
-- so the fix here is provisioning, not SQL: the read-only DSN role used by the
-- live-drift job must be able to see all cron jobs — grant it BYPASSRLS, or
-- point the DSN at the `postgres` role that owns the jobs. Reading cron.job is
-- otherwise correct and unchanged.
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
