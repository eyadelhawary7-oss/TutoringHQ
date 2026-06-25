-- Super-admin pricing panel: enable/disable plans from UI
ALTER TABLE pricing_plans ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
