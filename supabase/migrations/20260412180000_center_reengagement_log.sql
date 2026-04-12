CREATE TABLE IF NOT EXISTS public.center_reengagement_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id UUID NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  trigger_type TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_center_reengagement_log_center_sent
  ON public.center_reengagement_log (center_id, sent_at DESC);

ALTER TABLE public.center_reengagement_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_center_reengagement_log" ON public.center_reengagement_log;
CREATE POLICY "service_role_all_center_reengagement_log"
  ON public.center_reengagement_log FOR ALL TO service_role USING (true);
