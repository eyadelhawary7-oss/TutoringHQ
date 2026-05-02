-- Late fee tier rates as integer percents; blast / announcement / data / QR card pricing keys
INSERT INTO platform_config (key, value) VALUES
  ('late_fee_tier1_percent', '5'::jsonb),
  ('late_fee_tier2_percent', '10'::jsonb),
  ('blast_price_per_parent', '8'::jsonb),
  ('announcement_cap_monthly', '2'::jsonb),
  ('data_deletion_days', '90'::jsonb),
  ('qr_card_price', '55'::jsonb)
ON CONFLICT (key) DO NOTHING;
