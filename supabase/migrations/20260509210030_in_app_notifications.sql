-- In-app notifications (center dashboard) + idempotent card-order WhatsApp dedupe rows

CREATE TABLE IF NOT EXISTS public.in_app_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  center_id UUID REFERENCES public.centers(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  href TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS in_app_notifications_user_unread_idx
  ON public.in_app_notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS in_app_notifications_user_created_idx
  ON public.in_app_notifications (user_id, created_at DESC);

COMMENT ON TABLE public.in_app_notifications IS 'Centre dashboard notifications; inserts via service role from API/crons.';

ALTER TABLE public.in_app_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "in_app_notifications_select_own" ON public.in_app_notifications;
CREATE POLICY "in_app_notifications_select_own" ON public.in_app_notifications
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "in_app_notifications_update_own" ON public.in_app_notifications;
CREATE POLICY "in_app_notifications_update_own" ON public.in_app_notifications
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Idempotent WhatsApp card-order status sends: one notify per (order, target status)
CREATE TABLE IF NOT EXISTS public.card_order_status_wa_dedupe (
  card_order_id UUID NOT NULL REFERENCES public.card_orders(id) ON DELETE CASCADE,
  to_status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (card_order_id, to_status)
);

COMMENT ON TABLE public.card_order_status_wa_dedupe IS 'Dedupe key for Meta WA templates per card_orders lifecycle status; INSERT ON CONFLICT DO NOTHING.';

-- Registry placeholders until Meta approves (admin sync may flip to APPROVED)
INSERT INTO public.wa_meta_templates (template_name, category, status, variables_count)
SELECT v.name, 'card_orders', 'PENDING', v.vars
FROM (VALUES
  ('chq_card_order_status_update', 3),
  ('chq_card_order_paid', 2),
  ('chq_card_order_in_production', 2),
  ('chq_card_order_in_transit', 2),
  ('chq_card_order_delivered', 2),
  ('chq_card_order_cancelled', 2),
  ('chq_card_order_refunded', 2)
) AS v(name, vars)
WHERE NOT EXISTS (SELECT 1 FROM public.wa_meta_templates t WHERE t.template_name = v.name);
