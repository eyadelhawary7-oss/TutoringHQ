-- Automation 8b: FAQ match key on inbound log
ALTER TABLE public.whatsapp_inbound_log
  ADD COLUMN IF NOT EXISTS faq_trigger TEXT;
