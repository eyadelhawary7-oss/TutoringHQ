CREATE TABLE card_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id uuid REFERENCES centers(id),
  created_by uuid REFERENCES users(id),
  students jsonb,
  quantity int,
  price_per_card numeric DEFAULT 3,
  delivery_fee numeric DEFAULT 0,
  total_amount numeric,
  status text DEFAULT 'pending',
  delivery_address text,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE card_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Centers can manage own orders" ON card_orders
  FOR ALL TO authenticated
  USING (center_id IN (
    SELECT center_id FROM users WHERE id = auth.uid()
  ));
