-- Automation 6a: watchdog columns + expected intervals (matches vercel.json crons)
ALTER TABLE public.cron_health_log
  ADD COLUMN IF NOT EXISTS last_failure_at TIMESTAMPTZ;

ALTER TABLE public.cron_health_log
  ADD COLUMN IF NOT EXISTS expected_interval_minutes INTEGER NOT NULL DEFAULT 1440;

INSERT INTO public.cron_health_log (cron_name, expected_interval_minutes, failure_count)
VALUES
  ('check-stuck-payments', 30, 0),
  ('cleanup-expired-sessions', 1440, 0),
  ('expire-credits', 1440, 0),
  ('parent-pack-billing', 44640, 0),
  ('parent-absence-alerts', 1440, 0),
  ('parent-balance-alerts', 1440, 0),
  ('pack-request-check', 1440, 0),
  ('ceo-briefing', 1440, 0),
  ('payg-billing', 44640, 0),
  ('commission-t2-check', 1440, 0),
  ('loyalty-bonus-check', 1440, 0),
  ('process-renewals', 1440, 0),
  ('detect-churn', 1440, 0),
  ('daily-summary', 1440, 0),
  ('compute-benchmarks', 1440, 0),
  ('recompute-health-scores', 1440, 0),
  ('status-ping', 5, 0),
  ('mrr-snapshot', 1440, 0),
  ('check-token-health', 10080, 0),
  ('renewal-reminders', 1440, 0),
  ('weekly-backup', 10080, 0),
  ('monthly-backup', 44640, 0),
  ('cleanup-status-checks', 10080, 0),
  ('referral-automation', 44640, 0),
  ('dormancy-warnings', 44640, 0),
  ('onboarding-stall', 360, 0),
  ('upgrade-nudge', 1440, 0),
  ('weekly-owner-report', 10080, 0),
  ('watchdog', 60, 0),
  ('payment-alert', 120, 0),
  ('payment-retry', 1440, 0)
ON CONFLICT (cron_name) DO UPDATE
SET expected_interval_minutes = EXCLUDED.expected_interval_minutes;
