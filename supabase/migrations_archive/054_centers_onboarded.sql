-- Add onboarded flag to centers for wizard completion
ALTER TABLE centers ADD COLUMN IF NOT EXISTS onboarded BOOLEAN DEFAULT false;
