-- Pack fulfillment pipeline (physical pack / ops stages after approval request).
-- Complements centers.pack_request_status (none|pending|approved|rejected|suspended).

CREATE TABLE IF NOT EXISTS public.pack_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id UUID NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending_approval',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pack_requests_status_check CHECK (
    status IN (
      'pending_approval',
      'approved',
      'in_production',
      'dispatched',
      'in_transit',
      'delivered',
      'issued',
      'cancelled'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_pack_requests_center_updated ON public.pack_requests(center_id, updated_at DESC);

-- At most one non-terminal fulfillment row per center
CREATE UNIQUE INDEX IF NOT EXISTS pack_requests_one_open_per_center
  ON public.pack_requests (center_id)
  WHERE status NOT IN ('issued', 'cancelled');

ALTER TABLE public.pack_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pack_requests_deny_all ON public.pack_requests;
CREATE POLICY pack_requests_deny_all ON public.pack_requests FOR ALL USING (false);

CREATE OR REPLACE FUNCTION public.touch_pack_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pack_requests_touch_updated ON public.pack_requests;
CREATE TRIGGER pack_requests_touch_updated
  BEFORE UPDATE ON public.pack_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_pack_requests_updated_at();

COMMENT ON TABLE public.pack_requests IS 'WhatsApp parent pack fulfillment stages after owner requests pack';

-- Default courier label for vendor WhatsApp template variable {{courier_name}}
INSERT INTO public.platform_config (key, value) VALUES ('courier_name', '"Bosta"'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Backfill pending centers
INSERT INTO public.pack_requests (center_id, status)
SELECT c.id, 'pending_approval'
FROM public.centers c
WHERE c.pack_request_status = 'pending'
  AND NOT EXISTS (
    SELECT 1
    FROM public.pack_requests pr
    WHERE pr.center_id = c.id
      AND pr.status NOT IN ('issued', 'cancelled')
  );

-- Backfill live approved packs (single historical issued snapshot)
INSERT INTO public.pack_requests (center_id, status)
SELECT c.id, 'issued'
FROM public.centers c
WHERE c.pack_request_status = 'approved'
  AND COALESCE(c.parent_pack_enabled, false) = true
  AND NOT EXISTS (SELECT 1 FROM public.pack_requests pr WHERE pr.center_id = c.id);

-- Vendor order template: fourth body variable {{courier_name}} (Meta registration must match parameter order).
UPDATE public.wa_meta_templates
SET variables_count = GREATEST(variables_count, 4),
    updated_at = NOW()
WHERE template_name = 'chq_vendor_new_order';

INSERT INTO public.wa_meta_templates (template_name, category, variables_count, status)
SELECT 'chq_vendor_new_order', 'vendor', 4, 'APPROVED'
WHERE NOT EXISTS (SELECT 1 FROM public.wa_meta_templates WHERE template_name = 'chq_vendor_new_order');

INSERT INTO public.wa_meta_templates (template_name, category, variables_count, status)
SELECT 'chq_pin_delivery', 'auth', 1, 'APPROVED'
WHERE NOT EXISTS (SELECT 1 FROM public.wa_meta_templates WHERE template_name = 'chq_pin_delivery');
