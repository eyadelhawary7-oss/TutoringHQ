-- Landing-page promotional popup config keys.
-- All inserts use ON CONFLICT (key) DO NOTHING so existing values are preserved.

INSERT INTO public.platform_config (key, value) VALUES
  ('landing.popup.enabled',     'false'::jsonb),
  ('landing.popup.title_en',    '""'::jsonb),
  ('landing.popup.title_ar',    '""'::jsonb),
  ('landing.popup.body_en',     '""'::jsonb),
  ('landing.popup.body_ar',     '""'::jsonb),
  ('landing.popup.promo_code',  '""'::jsonb),
  ('landing.popup.cta_text_en', '""'::jsonb),
  ('landing.popup.cta_text_ar', '""'::jsonb),
  ('landing.popup.cta_url',     '"/pricing"'::jsonb),
  ('landing.popup.delay_seconds', '3'::jsonb)
ON CONFLICT (key) DO NOTHING;
