-- vendor_courier_fulfillment: internal vendors, system settings, card_orders fulfillment + Paymob columns

CREATE TABLE IF NOT EXISTS vendors (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name            TEXT NOT NULL,
  whatsapp_number TEXT NOT NULL,
  pickup_address  TEXT NOT NULL,
  city            TEXT NOT NULL DEFAULT 'Cairo',
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS system_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

INSERT INTO system_settings (key, value)
VALUES ('centerhq_ops_note', 'CenterHQ')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE card_orders
  ADD COLUMN IF NOT EXISTS payment_status TEXT,
  ADD COLUMN IF NOT EXISTS paymob_order_id TEXT,
  ADD COLUMN IF NOT EXISTS paymob_transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES vendors(id),
  ADD COLUMN IF NOT EXISTS vendor_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bosta_order_id TEXT,
  ADD COLUMN IF NOT EXISTS tracking_number TEXT,
  ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

ALTER TABLE card_orders DROP CONSTRAINT IF EXISTS card_orders_status_check;

ALTER TABLE card_orders ADD CONSTRAINT card_orders_status_check CHECK (
  status IN (
    'pending_payment',
    'pending',
    'paid',
    'confirmed',
    'printing',
    'ready_for_pickup',
    'shipped',
    'delivered'
  )
);

CREATE INDEX IF NOT EXISTS idx_card_orders_tracking
  ON card_orders (tracking_number)
  WHERE tracking_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_card_orders_bosta
  ON card_orders (bosta_order_id)
  WHERE bosta_order_id IS NOT NULL;

UPDATE card_orders SET payment_status = 'unpaid' WHERE payment_status IS NULL;
