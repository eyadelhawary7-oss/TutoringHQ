-- Automation 5: one WhatsApp weekly owner report per center per calendar week (week_start = Monday UTC date)
CREATE TABLE IF NOT EXISTS public.weekly_report_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id UUID NOT NULL REFERENCES public.centers (id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (center_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_weekly_report_log_center ON public.weekly_report_log (center_id);
CREATE INDEX IF NOT EXISTS idx_weekly_report_log_week ON public.weekly_report_log (week_start DESC);

ALTER TABLE public.weekly_report_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_weekly_report_log" ON public.weekly_report_log;
CREATE POLICY "service_role_all_weekly_report_log"
  ON public.weekly_report_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
