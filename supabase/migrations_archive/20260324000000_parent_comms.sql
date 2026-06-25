-- Parent communication suite
-- Add parent fields to students, create parent_portal_tokens
-- pg_cron: weekly-summaries (Sunday 6am UTC), absence-check (every 5 min)

-- 1. Add parent columns to students
ALTER TABLE students ADD COLUMN IF NOT EXISTS parent_phone TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS parent_phone_verified BOOLEAN DEFAULT false;
ALTER TABLE students ADD COLUMN IF NOT EXISTS parent_consent_given BOOLEAN DEFAULT false;
ALTER TABLE students ADD COLUMN IF NOT EXISTS parent_consent_at TIMESTAMPTZ;
ALTER TABLE students ADD COLUMN IF NOT EXISTS notify_on_scan BOOLEAN DEFAULT true;
ALTER TABLE students ADD COLUMN IF NOT EXISTS notify_on_absence BOOLEAN DEFAULT true;
ALTER TABLE students ADD COLUMN IF NOT EXISTS notify_on_balance BOOLEAN DEFAULT true;
ALTER TABLE students ADD COLUMN IF NOT EXISTS balance_alert_threshold NUMERIC DEFAULT 100;

CREATE INDEX IF NOT EXISTS idx_students_parent_phone ON students(parent_phone) WHERE parent_phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_students_parent_consent ON students(center_id, parent_consent_given) WHERE parent_consent_given = true;

-- 2. parent_portal_tokens: token-based access for parent portal
CREATE TABLE IF NOT EXISTS parent_portal_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_parent_portal_tokens_token ON parent_portal_tokens(token) WHERE expires_at > now();
CREATE INDEX IF NOT EXISTS idx_parent_portal_tokens_student ON parent_portal_tokens(student_id);

ALTER TABLE parent_portal_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "parent_portal_tokens_service_only" ON parent_portal_tokens;
CREATE POLICY "parent_portal_tokens_service_only" ON parent_portal_tokens FOR ALL USING (false);

-- 3. pg_cron: weekly-summaries (Sunday 6am UTC)
-- SELECT cron.schedule(
--   'weekly-summaries',
--   '0 6 * * 0',
--   $$ SELECT net.http_post(...) $$
-- );

-- 4. pg_cron: check sessions with no scan 2hrs past start time (every 5 min)
-- SELECT cron.schedule(
--   'absence-check',
--   '*/5 * * * *',
--   $$ SELECT net.http_post(...) $$
-- );

COMMENT ON TABLE parent_portal_tokens IS 'Token-based access for parent portal (30-day attendance, balance, next sessions)';
