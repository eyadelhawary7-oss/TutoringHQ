-- Add max_teachers to centers based on plan (starter=2, pro=5, enterprise=20)
ALTER TABLE centers ADD COLUMN IF NOT EXISTS max_teachers SMALLINT DEFAULT 2;

-- Backfill based on plan
UPDATE centers SET max_teachers = 2 WHERE plan = 'starter' OR plan IS NULL;
UPDATE centers SET max_teachers = 5 WHERE plan = 'pro';
UPDATE centers SET max_teachers = 20 WHERE plan = 'enterprise';
