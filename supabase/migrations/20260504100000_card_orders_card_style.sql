ALTER TABLE card_orders
  ADD COLUMN IF NOT EXISTS card_style TEXT
  CHECK (card_style IN ('dark', 'light'))
  DEFAULT 'dark';

COMMENT ON COLUMN card_orders.card_style IS 'QR card design: dark = Option B (Navy+Teal), light = Option C (White+Teal)';
