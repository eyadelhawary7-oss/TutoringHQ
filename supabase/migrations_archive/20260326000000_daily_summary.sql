-- Daily WhatsApp operations summary
-- Centers: daily_summary_enabled toggle
-- pg_cron at 5:55am UTC daily → daily-summary Edge Function

ALTER TABLE centers ADD COLUMN IF NOT EXISTS daily_summary_enabled BOOLEAN DEFAULT true;

COMMENT ON COLUMN centers.daily_summary_enabled IS 'Send daily operations summary via WhatsApp at 5:55am UTC';

-- pg_cron: 5:55am UTC daily → daily-summary Edge Function
-- SELECT cron.schedule(
--   'daily-summary',
--   '55 5 * * *',
--   $$ SELECT net.http_post(
--        url := 'https://<project>.supabase.co/functions/v1/daily-summary',
--        headers := '{"Authorization": "Bearer <anon_key>"}'::jsonb,
--        body := '{}'::jsonb
--      ) $$
-- );
