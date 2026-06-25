ALTER TABLE card_orders
  ADD COLUMN IF NOT EXISTS bosta_status TEXT,
  ADD COLUMN IF NOT EXISTS bosta_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bosta_notes TEXT,
  ADD COLUMN IF NOT EXISTS bosta_shipment_id TEXT;

CREATE TABLE IF NOT EXISTS card_order_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  card_order_id UUID NOT NULL REFERENCES card_orders(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  bosta_event_id TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE card_order_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_card_order_events"
  ON card_order_events FOR ALL TO service_role USING (true);
