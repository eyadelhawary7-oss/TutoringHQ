-- Automation 8a: inbound WhatsApp messages (FAQ pipeline prep)
CREATE TABLE IF NOT EXISTS public.whatsapp_inbound_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_phone TEXT NOT NULL,
  message_text TEXT,
  center_id UUID REFERENCES public.centers (id) ON DELETE SET NULL,
  matched_faq BOOLEAN NOT NULL DEFAULT FALSE,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_inbound_log_received ON public.whatsapp_inbound_log (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_inbound_log_center ON public.whatsapp_inbound_log (center_id)
  WHERE center_id IS NOT NULL;

ALTER TABLE public.whatsapp_inbound_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_whatsapp_inbound_log" ON public.whatsapp_inbound_log;
CREATE POLICY "service_role_all_whatsapp_inbound_log"
  ON public.whatsapp_inbound_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
