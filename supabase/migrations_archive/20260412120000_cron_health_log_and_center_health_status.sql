-- Cron success log for health and related automations
CREATE TABLE IF NOT EXISTS public.cron_health_log (
  cron_name TEXT PRIMARY KEY,
  last_success_at TIMESTAMPTZ,
  failure_count INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE public.cron_health_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_cron_health_log" ON public.cron_health_log;
CREATE POLICY "service_role_all_cron_health_log"
  ON public.cron_health_log FOR ALL TO service_role USING (true);

-- Center automation health (weighted score cron)
ALTER TABLE public.centers ADD COLUMN IF NOT EXISTS health_status TEXT;
ALTER TABLE public.centers ADD COLUMN IF NOT EXISTS health_score_updated_at TIMESTAMPTZ;
