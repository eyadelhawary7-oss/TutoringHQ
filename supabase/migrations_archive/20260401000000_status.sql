-- Public status page: status_checks, status_incidents
-- pg_cron every 5 min → ping services → insert status_checks

CREATE TABLE IF NOT EXISTS status_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('operational', 'degraded', 'outage')),
  response_time_ms INTEGER,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_status_checks_service_time ON status_checks(service, checked_at DESC);

CREATE TABLE IF NOT EXISTS status_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('minor', 'major', 'critical')),
  started_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  services_affected TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_status_incidents_resolved ON status_incidents(resolved_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_status_incidents_started ON status_incidents(started_at DESC);

-- RLS: status_checks and status_incidents are public read
ALTER TABLE status_checks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "status_checks_public_read" ON status_checks;
CREATE POLICY "status_checks_public_read" ON status_checks FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE status_incidents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "status_incidents_public_read" ON status_incidents;
CREATE POLICY "status_incidents_public_read" ON status_incidents FOR SELECT TO anon, authenticated USING (true);

COMMENT ON TABLE status_checks IS 'Service health pings: api, scanner, payments. Populated by cron every 5 min.';
COMMENT ON TABLE status_incidents IS 'Outage/incident log for status page.';
