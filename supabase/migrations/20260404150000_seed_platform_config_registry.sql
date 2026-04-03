INSERT INTO platform_config (key, value) VALUES
  ('auto_approve_signups', 'false'::jsonb),
  ('auto_approve_pack', 'false'::jsonb),
  ('pause_new_signups', 'false'::jsonb),
  ('payment_failed_enabled', 'false'::jsonb),
  ('pack_invoice_enabled', 'false'::jsonb),
  ('bosta_auto_reship_on_lost', 'false'::jsonb),
  ('breakeven_target', '77'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO platform_config (key, value)
VALUES ('wa_sending_enabled', 'true'::jsonb)
ON CONFLICT (key) DO NOTHING;
