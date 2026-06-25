-- Onboarding wizard: step tracking on centers
-- Steps: 0=not started, 1=profile, 2=students, 3=QR, 4=scanner, 5=complete

ALTER TABLE centers ADD COLUMN IF NOT EXISTS onboarding_step INTEGER DEFAULT 0;
ALTER TABLE centers ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false;
ALTER TABLE centers ADD COLUMN IF NOT EXISTS onboarding_started_at TIMESTAMPTZ;

-- Sync existing onboarded centers
UPDATE centers
SET onboarding_step = 5, onboarding_completed = true
WHERE onboarded = true AND (onboarding_completed IS NULL OR onboarding_completed = false);

COMMENT ON COLUMN centers.onboarding_step IS '0=not started, 1=profile, 2=students, 3=QR, 4=scanner, 5=complete';
COMMENT ON COLUMN centers.onboarding_completed IS 'True when onboarding wizard is finished';
COMMENT ON COLUMN centers.onboarding_started_at IS 'When user first entered the onboarding wizard';
