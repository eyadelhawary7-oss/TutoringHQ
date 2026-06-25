-- Ensure centers.plan accepts valid values (upper or lower case for flexibility)
ALTER TABLE centers DROP CONSTRAINT IF EXISTS centers_plan_check;
ALTER TABLE centers ADD CONSTRAINT centers_plan_check
  CHECK (UPPER(plan) IN ('STARTER', 'PRO', 'BUSINESS', 'ENTERPRISE', 'TOP_CENTERS', 'PAYG'));
