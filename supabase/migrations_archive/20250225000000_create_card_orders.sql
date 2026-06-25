-- Card Orders table for ID card ordering system
CREATE TABLE IF NOT EXISTS card_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id uuid NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  students jsonb NOT NULL DEFAULT '[]'::jsonb,
  quantity int NOT NULL DEFAULT 0,
  price_per_card numeric NOT NULL DEFAULT 3,
  delivery_fee numeric NOT NULL DEFAULT 0,
  total_amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'printing', 'shipped', 'delivered')),
  delivery_address text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for faster lookups by center
CREATE INDEX IF NOT EXISTS idx_card_orders_center_id ON card_orders(center_id);
CREATE INDEX IF NOT EXISTS idx_card_orders_created_at ON card_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_card_orders_status ON card_orders(status);

-- RLS: authenticated users can insert and select their own center's orders
ALTER TABLE card_orders ENABLE ROW LEVEL SECURITY;

-- Policy: Users can INSERT orders for their center
CREATE POLICY "Users can insert own center orders"
  ON card_orders FOR INSERT
  TO authenticated
  WITH CHECK (
    center_id IN (
      SELECT center_id FROM users WHERE id = auth.uid() AND center_id IS NOT NULL
    )
  );

-- Policy: Users can SELECT orders for their center
CREATE POLICY "Users can select own center orders"
  ON card_orders FOR SELECT
  TO authenticated
  USING (
    center_id IN (
      SELECT center_id FROM users WHERE id = auth.uid() AND center_id IS NOT NULL
    )
  );

-- Policy: Admin users can SELECT all orders (for Realtime subscriptions)
CREATE POLICY "Admin users can select all card orders"
  ON card_orders FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM admin_users WHERE id = auth.uid())
  );

-- Enable Realtime for card_orders
ALTER PUBLICATION supabase_realtime ADD TABLE card_orders;
