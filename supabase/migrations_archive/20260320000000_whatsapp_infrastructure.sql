-- WhatsApp Cloud API infrastructure (Direct Meta API)
-- Tables: wa_conversations, wa_message_queue, wa_keyword_routes, wa_meta_templates

-- wa_conversations: track conversation state per center/contact
CREATE TABLE IF NOT EXISTS wa_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  contact_phone TEXT NOT NULL,
  current_flow TEXT,
  flow_step TEXT,
  is_in_human_queue BOOLEAN DEFAULT false,
  last_message_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(center_id, contact_phone)
);

CREATE INDEX IF NOT EXISTS idx_wa_conversations_center ON wa_conversations(center_id);
CREATE INDEX IF NOT EXISTS idx_wa_conversations_phone ON wa_conversations(contact_phone);
CREATE INDEX IF NOT EXISTS idx_wa_conversations_human_queue ON wa_conversations(center_id, is_in_human_queue) WHERE is_in_human_queue = true;

-- wa_message_queue: outbound message queue for Meta API
CREATE TABLE IF NOT EXISTS wa_message_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  to_phone TEXT NOT NULL,
  template_name TEXT,
  variables JSONB DEFAULT '{}',
  body TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed')),
  waba_message_id TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_message_queue_center ON wa_message_queue(center_id);
CREATE INDEX IF NOT EXISTS idx_wa_message_queue_status ON wa_message_queue(status);
CREATE INDEX IF NOT EXISTS idx_wa_message_queue_waba_id ON wa_message_queue(waba_message_id) WHERE waba_message_id IS NOT NULL;

-- wa_keyword_routes: keyword matching for auto-responses
CREATE TABLE IF NOT EXISTS wa_keyword_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keywords TEXT[] NOT NULL,
  match_type TEXT NOT NULL DEFAULT 'any' CHECK (match_type IN ('any', 'all', 'exact')),
  response_template TEXT NOT NULL,
  category TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- wa_meta_templates: Meta Cloud API approved template registry
CREATE TABLE IF NOT EXISTS wa_meta_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'APPROVED' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  variables_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_meta_templates_name ON wa_meta_templates(template_name);

-- Pre-populate keyword routes
INSERT INTO wa_keyword_routes (keywords, match_type, response_template, category)
SELECT v.keywords, v.match_type, v.response_template, v.category
FROM (VALUES
  (ARRAY['PIN', 'كلمة السر', 'نسيت', 'password', 'forgot']::text[], 'any', 'pin_reset', 'pin_reset'),
  (ARRAY['الماسح', 'مش شاغل', 'scanner', 'ماسح']::text[], 'any', 'scanner_help', 'scanner_help'),
  (ARRAY['دفع', 'مدفوعات', 'payment', 'دفعته']::text[], 'any', 'payment_help', 'payment_help')
) AS v(keywords, match_type, response_template, category)
WHERE NOT EXISTS (SELECT 1 FROM wa_keyword_routes WHERE category = v.category);

-- RLS: all wa_ tables service role only (no anon/authenticated access)
ALTER TABLE wa_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_message_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_keyword_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_meta_templates ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any, then create restrictive policies
DROP POLICY IF EXISTS "wa_conversations_service_only" ON wa_conversations;
DROP POLICY IF EXISTS "wa_message_queue_service_only" ON wa_message_queue;
DROP POLICY IF EXISTS "wa_keyword_routes_service_only" ON wa_keyword_routes;
DROP POLICY IF EXISTS "wa_meta_templates_service_only" ON wa_meta_templates;

-- Service role bypasses RLS; these policies deny anon/authenticated
CREATE POLICY "wa_conversations_service_only" ON wa_conversations
  FOR ALL USING (false);

CREATE POLICY "wa_message_queue_service_only" ON wa_message_queue
  FOR ALL USING (false);

CREATE POLICY "wa_keyword_routes_service_only" ON wa_keyword_routes
  FOR ALL USING (false);

CREATE POLICY "wa_meta_templates_service_only" ON wa_meta_templates
  FOR ALL USING (false);

-- pg_cron: every 2 minutes, invoke process-queue Edge Function
-- Requires pg_cron and pg_net extensions. Configure SUPABASE_URL and SERVICE_ROLE_KEY in vault.
-- The Edge Function URL: {SUPABASE_URL}/functions/v1/process-queue
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('process-wa-queue');
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Schedule cron (uncomment and configure after deploying process-queue Edge Function)
-- SELECT cron.schedule(
--   'process-wa-queue',
--   '*/2 * * * *',
--   $$ SELECT net.http_post(
--        url := current_setting('app.wa_process_queue_url', true),
--        headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.wa_service_role_key', true), 'Content-Type', 'application/json'),
--        body := '{}'::jsonb
--      ) AS request_id $$
-- );

COMMENT ON TABLE wa_conversations IS 'WhatsApp conversation state per center/contact';
COMMENT ON TABLE wa_message_queue IS 'Outbound message queue for Meta WhatsApp Cloud API';
COMMENT ON TABLE wa_keyword_routes IS 'Keyword matching for auto-responses';
COMMENT ON TABLE wa_meta_templates IS 'Meta Cloud API approved template registry';
