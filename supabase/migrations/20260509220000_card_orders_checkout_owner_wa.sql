-- Idempotent owner WhatsApp after checkout success page (first render)

ALTER TABLE public.card_orders ADD COLUMN IF NOT EXISTS checkout_owner_wa_sent_at TIMESTAMPTZ;
