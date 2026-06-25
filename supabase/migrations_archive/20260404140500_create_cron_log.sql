CREATE TABLE IF NOT EXISTS cron_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cron_name TEXT NOT NULL,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL CHECK (status IN ('success','failure','partial')),
  duration_ms INTEGER,
  records_processed INTEGER DEFAULT 0,
  error_message TEXT,
  metadata JSONB
);

CREATE INDEX idx_cron_log_name_ran ON cron_log(cron_name, ran_at DESC);

ALTER TABLE cron_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_cron_log"
  ON cron_log FOR ALL TO service_role USING (true);
