-- Plan limits migration: max_teachers and max_students per plan
-- Safe to run multiple times (idempotent)

-- 1. Add plan limit columns to centers table
-- max_teachers may already exist from 016; IF NOT EXISTS skips duplicate
ALTER TABLE centers ADD COLUMN IF NOT EXISTS max_teachers INTEGER DEFAULT 8;
ALTER TABLE centers ADD COLUMN IF NOT EXISTS max_students INTEGER DEFAULT 200;

-- 2. Update existing centers based on their current plan
-- Syncs limits with plan for all rows (idempotent)
UPDATE centers
SET
  max_teachers = CASE
    WHEN plan = 'starter' THEN 8
    WHEN plan = 'pro' THEN 20
    WHEN plan = 'enterprise' THEN 50
    ELSE 8
  END,
  max_students = CASE
    WHEN plan = 'starter' THEN 200
    WHEN plan = 'pro' THEN 600
    WHEN plan = 'enterprise' THEN 999999
    ELSE 200
  END;

-- 3. Create function that auto-updates limits when plan changes
CREATE OR REPLACE FUNCTION update_center_limits()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.plan IS DISTINCT FROM OLD.plan THEN
    NEW.max_teachers := CASE
      WHEN NEW.plan = 'starter' THEN 8
      WHEN NEW.plan = 'pro' THEN 20
      WHEN NEW.plan = 'enterprise' THEN 50
      ELSE 8
    END;
    NEW.max_students := CASE
      WHEN NEW.plan = 'starter' THEN 200
      WHEN NEW.plan = 'pro' THEN 600
      WHEN NEW.plan = 'enterprise' THEN 999999
      ELSE 200
    END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Create trigger to auto-update limits on plan change
DROP TRIGGER IF EXISTS trg_update_center_limits ON centers;
CREATE TRIGGER trg_update_center_limits
  BEFORE UPDATE ON centers
  FOR EACH ROW
  WHEN (OLD.plan IS DISTINCT FROM NEW.plan)
  EXECUTE FUNCTION update_center_limits();

-- 5. Add documentation comments (enforcement in application logic, not DB constraint)
COMMENT ON COLUMN centers.max_teachers IS 'Maximum teachers allowed for this plan';
COMMENT ON COLUMN centers.max_students IS 'Maximum students allowed for this plan';
