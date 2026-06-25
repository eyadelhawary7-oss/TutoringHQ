-- Ensure all platform_config keys used by auto-approval + admin Platform Config UI exist
ALTER TABLE platform_config ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

INSERT INTO platform_config (key, value) VALUES
  ('cron_paused', 'false'::jsonb),
  ('maintenance_mode', 'false'::jsonb),
  ('read_only_mode', 'false'::jsonb),
  ('payment_failed_enabled', 'false'::jsonb),
  ('pack_invoice_enabled', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;
