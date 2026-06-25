-- Stack traces for cron failures (health dashboard); error_message already holds truncated message.
ALTER TABLE public.cron_log ADD COLUMN IF NOT EXISTS error_stack TEXT;
