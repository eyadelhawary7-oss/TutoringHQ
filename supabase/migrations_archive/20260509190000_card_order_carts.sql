-- Saved card-order carts (per centre, persistent until checkout or abandonment)

CREATE TABLE public.card_order_carts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id UUID NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('open','submitted','abandoned')),
  card_style TEXT CHECK (card_style IN ('dark','light')),
  delivery_governorate TEXT,
  delivery_address TEXT,
  delivery_phone TEXT,
  notes TEXT,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_modified_by UUID REFERENCES auth.users(id),
  last_modified_by_name TEXT,
  submitted_at TIMESTAMPTZ,
  abandoned_at TIMESTAMPTZ,
  card_order_id UUID REFERENCES public.card_orders(id)
);

CREATE UNIQUE INDEX card_order_carts_one_open_per_center ON public.card_order_carts (center_id) WHERE status = 'open';
CREATE INDEX card_order_carts_center_status_idx ON public.card_order_carts (center_id, status);
CREATE INDEX card_order_carts_open_idle_idx ON public.card_order_carts (updated_at) WHERE status = 'open';

CREATE TABLE public.card_order_cart_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id UUID NOT NULL REFERENCES public.card_order_carts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('student','blank')),
  student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
  quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  saved_for_later BOOLEAN NOT NULL DEFAULT false,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (kind = 'student' AND student_id IS NOT NULL AND quantity = 1) OR
    (kind = 'blank' AND student_id IS NULL AND quantity > 0)
  )
);

CREATE UNIQUE INDEX card_order_cart_items_unique_student ON public.card_order_cart_items (cart_id, student_id) WHERE kind = 'student';
CREATE INDEX card_order_cart_items_cart_idx ON public.card_order_cart_items (cart_id);
CREATE INDEX card_order_cart_items_active_idx ON public.card_order_cart_items (cart_id) WHERE saved_for_later = false;

CREATE OR REPLACE FUNCTION public.bump_cart_on_item_change() RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.card_order_carts
    SET updated_at = now(), version = version + 1
    WHERE id = COALESCE(NEW.cart_id, OLD.cart_id);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER card_order_cart_items_bump_parent
  AFTER INSERT OR UPDATE OR DELETE ON public.card_order_cart_items
  FOR EACH ROW EXECUTE FUNCTION public.bump_cart_on_item_change();

ALTER TABLE public.card_order_carts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.card_order_cart_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Centers manage own card_order_carts" ON public.card_order_carts
  FOR ALL TO authenticated
  USING (center_id IN (SELECT center_id FROM users WHERE id = auth.uid()))
  WITH CHECK (center_id IN (SELECT center_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Centers manage own card_order_cart_items" ON public.card_order_cart_items
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.card_order_carts c
      WHERE c.id = cart_id
        AND c.center_id IN (SELECT center_id FROM users WHERE id = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.card_order_carts c
      WHERE c.id = cart_id
        AND c.center_id IN (SELECT center_id FROM users WHERE id = auth.uid())
    )
  );

INSERT INTO public.platform_config (key, value)
VALUES ('card_order_minimum_quantity', '1'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.platform_config (key, value)
VALUES ('card_order_cart_idle_days', '30'::jsonb)
ON CONFLICT (key) DO NOTHING;
