-- Automation 3: onboarding stall cron (nudges + step timestamps)
ALTER TABLE centers ADD COLUMN IF NOT EXISTS owner_phone TEXT;
UPDATE centers SET owner_phone = phone WHERE owner_phone IS NULL AND phone IS NOT NULL;

ALTER TABLE centers ADD COLUMN IF NOT EXISTS onboarding_step_updated_at TIMESTAMPTZ;
ALTER TABLE centers ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;
ALTER TABLE centers ADD COLUMN IF NOT EXISTS onboarding_nudge_sent_at TIMESTAMPTZ;
ALTER TABLE centers ADD COLUMN IF NOT EXISTS wa_notifications_enabled BOOLEAN DEFAULT false;

UPDATE centers
SET wa_notifications_enabled = true
WHERE COALESCE(individual_alerts_enabled, false) = true
  AND COALESCE(wa_notifications_enabled, false) = false;

UPDATE centers
SET onboarding_completed_at = COALESCE(onboarding_completed_at, NOW())
WHERE COALESCE(onboarding_completed, false) = true
  AND onboarding_completed_at IS NULL;
