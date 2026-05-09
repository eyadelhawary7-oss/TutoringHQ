-- Checkout flow: centre card-style memory, cart vendor notes, card_order line items, card_orders delivery columns

ALTER TABLE public.centers ADD COLUMN IF NOT EXISTS last_card_style TEXT;

ALTER TABLE public.card_order_carts
  ADD COLUMN IF NOT EXISTS vendor_notes TEXT;

ALTER TABLE public.card_orders ADD COLUMN IF NOT EXISTS delivery_governorate TEXT;
ALTER TABLE public.card_orders ADD COLUMN IF NOT EXISTS delivery_phone TEXT;
ALTER TABLE public.card_orders ADD COLUMN IF NOT EXISTS payment_status TEXT;
ALTER TABLE public.card_orders ADD COLUMN IF NOT EXISTS paymob_order_id TEXT;
ALTER TABLE public.card_orders ADD COLUMN IF NOT EXISTS paymob_transaction_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS card_orders_paymob_order_id_uidx
  ON public.card_orders (paymob_order_id)
  WHERE paymob_order_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.card_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_order_id UUID NOT NULL REFERENCES public.card_orders(id) ON DELETE CASCADE,
  student_id UUID REFERENCES public.students(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('student', 'blank')),
  quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (kind = 'student' AND student_id IS NOT NULL AND quantity = 1) OR
    (kind = 'blank' AND student_id IS NULL AND quantity > 0)
  )
);

CREATE INDEX IF NOT EXISTS card_order_items_order_idx ON public.card_order_items (card_order_id);

ALTER TABLE public.card_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Centers manage own card_order_items"
  ON public.card_order_items
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.card_orders co
      WHERE co.id = card_order_items.card_order_id
        AND co.center_id IN (
          SELECT u.center_id FROM public.users u
          WHERE u.id = auth.uid() AND u.center_id IS NOT NULL
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.card_orders co
      WHERE co.id = card_order_items.card_order_id
        AND co.center_id IN (
          SELECT u.center_id FROM public.users u
          WHERE u.id = auth.uid() AND u.center_id IS NOT NULL
        )
    )
  );
