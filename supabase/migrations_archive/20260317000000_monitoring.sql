-- Monitoring: backup_log table + pg_cron job for backup check
-- The pg_cron job runs at 4am UTC and inserts a heartbeat row.
-- External backup verification (e.g. verify-backup.js) should update last_verified_at.

CREATE TABLE IF NOT EXISTS public.backup_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checked_at timestamptz NOT NULL DEFAULT now(),
  last_verified_at timestamptz,
  status text CHECK (status IN ('ok', 'pending', 'alert')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_backup_log_checked_at ON public.backup_log (checked_at DESC);

COMMENT ON TABLE public.backup_log IS 'Audit log for backup verification. pg_cron inserts at 4am UTC; external scripts update last_verified_at.';

ALTER TABLE public.backup_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only" ON public.backup_log
  FOR ALL USING (auth.role() = 'service_role');

-- Enable pg_cron if available (Supabase Pro+; skip on free tier if extension unavailable)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Grant usage to postgres (cron runs as postgres)
GRANT USAGE ON SCHEMA cron TO postgres;

-- Schedule daily backup check at 4am UTC
-- Inserts a row to record the check ran; alerts if last_verified_at is stale
SELECT cron.schedule(
  'backup-check-daily',
  '0 4 * * *',  -- 4am UTC daily
  $$
  INSERT INTO public.backup_log (checked_at, status, notes)
  VALUES (
    now(),
    CASE
      WHEN (SELECT last_verified_at FROM public.backup_log ORDER BY checked_at DESC LIMIT 1) IS NULL
        OR (SELECT last_verified_at FROM public.backup_log ORDER BY checked_at DESC LIMIT 1) < now() - interval '36 hours'
      THEN 'alert'
      ELSE 'ok'
    END,
    'pg_cron backup check at 4am UTC'
  );
  $$
);
