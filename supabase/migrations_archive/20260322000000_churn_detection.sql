-- Churn detection early warning system
-- Tables: wa_inactivity_alerts, admin_alerts
-- pg_cron at 2am UTC daily → detect-churn Edge Function
-- Trigger: on attendance_scans INSERT → resolve unresolved inactivity alerts for center

-- wa_inactivity_alerts: track scanner inactivity by center
CREATE TABLE IF NOT EXISTS wa_inactivity_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('day3', 'day7', 'day14')),
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_scan_at TIMESTAMPTZ,
  monthly_fee NUMERIC,
  alert_sent BOOLEAN DEFAULT false,
  response_received BOOLEAN DEFAULT false,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_inactivity_alerts_center ON wa_inactivity_alerts(center_id);
CREATE INDEX IF NOT EXISTS idx_wa_inactivity_alerts_resolved ON wa_inactivity_alerts(center_id, resolved_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_wa_inactivity_alerts_triggered ON wa_inactivity_alerts(center_id, alert_type, triggered_at);

ALTER TABLE wa_inactivity_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wa_inactivity_alerts_service_only" ON wa_inactivity_alerts;
CREATE POLICY "wa_inactivity_alerts_service_only" ON wa_inactivity_alerts FOR ALL USING (false);

-- admin_alerts: critical alerts for admin panel (churn, payment, support)
CREATE TABLE IF NOT EXISTS admin_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('critical_inactivity', 'payment_overdue', 'support_escalation')),
  message TEXT NOT NULL,
  is_resolved BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_alerts_center ON admin_alerts(center_id);
CREATE INDEX IF NOT EXISTS idx_admin_alerts_unresolved ON admin_alerts(is_resolved) WHERE is_resolved = false;

ALTER TABLE admin_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_alerts_admin_read" ON admin_alerts;
-- Service role bypasses RLS for INSERT; admin users can read
CREATE POLICY "admin_alerts_admin_read" ON admin_alerts FOR SELECT
  USING (EXISTS (SELECT 1 FROM admin_users WHERE id = auth.uid()));

-- Trigger: on new attendance_scans INSERT → resolve unresolved wa_inactivity_alerts for that center
CREATE OR REPLACE FUNCTION resolve_inactivity_alerts_on_scan()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE wa_inactivity_alerts
  SET resolved_at = now()
  WHERE center_id = NEW.center_id
    AND resolved_at IS NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_resolve_inactivity_on_scan ON attendance_scans;
CREATE TRIGGER trigger_resolve_inactivity_on_scan
  AFTER INSERT ON attendance_scans
  FOR EACH ROW
  EXECUTE FUNCTION resolve_inactivity_alerts_on_scan();

-- pg_cron: 2am UTC daily, invoke detect-churn Edge Function
-- Uncomment and configure after deploying the function:
-- SELECT cron.schedule(
--   'detect-churn',
--   '0 2 * * *',
--   $$ SELECT net.http_post(
--        url := current_setting('app.detect_churn_url', true),
--        headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.detect_churn_service_role_key', true), 'Content-Type', 'application/json'),
--        body := '{}'::jsonb
--      ) AS request_id $$
-- );

-- Register churn Meta templates (create in Meta Business Manager)
INSERT INTO wa_meta_templates (template_name, category, variables_count, status)
VALUES
  ('chq_inactivity_day3', 'churn', 2, 'APPROVED'),
  ('chq_internal_churn_alert', 'churn', 5, 'APPROVED')
ON CONFLICT (template_name) DO UPDATE SET
  category = EXCLUDED.category,
  variables_count = EXCLUDED.variables_count,
  updated_at = now();

COMMENT ON TABLE wa_inactivity_alerts IS 'Scanner inactivity alerts: day3, day7, day14';
COMMENT ON TABLE admin_alerts IS 'Critical alerts for admin panel: churn, payment, support';
