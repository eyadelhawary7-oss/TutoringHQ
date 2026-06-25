-- WhatsApp onboarding Flow 1: 8-message automated sequence
-- pg_cron every 5 minutes → process-onboarding Edge Function

CREATE TABLE IF NOT EXISTS wa_onboarding_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  to_phone TEXT NOT NULL,
  step INTEGER NOT NULL CHECK (step >= 1 AND step <= 8),
  scheduled_for TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'skipped')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(center_id, step)
);

CREATE INDEX IF NOT EXISTS idx_wa_onboarding_schedule_center ON wa_onboarding_schedule(center_id);
CREATE INDEX IF NOT EXISTS idx_wa_onboarding_schedule_pending ON wa_onboarding_schedule(scheduled_for, status) WHERE status = 'pending';

ALTER TABLE wa_onboarding_schedule ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wa_onboarding_schedule_service_only" ON wa_onboarding_schedule;
CREATE POLICY "wa_onboarding_schedule_service_only" ON wa_onboarding_schedule FOR ALL USING (false);

-- pg_cron: every 5 minutes, invoke process-onboarding Edge Function
-- Configure SUPABASE_URL and SERVICE_ROLE_KEY; uncomment after deploying the function.
-- SELECT cron.schedule(
--   'process-wa-onboarding',
--   '*/5 * * * *',
--   $$ SELECT net.http_post(
--        url := current_setting('app.wa_process_onboarding_url', true),
--        headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.wa_service_role_key', true), 'Content-Type', 'application/json'),
--        body := '{}'::jsonb
--      ) AS request_id $$
-- );

COMMENT ON TABLE wa_onboarding_schedule IS 'WhatsApp onboarding Flow 1: 8-step scheduled sequence';
