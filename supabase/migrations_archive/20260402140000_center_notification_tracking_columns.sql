-- WhatsApp template idempotency for center lifecycle / billing / inactivity

ALTER TABLE centers
  ADD COLUMN IF NOT EXISTS renewal_reminder_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS overdue_reminder_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS inactivity_alert_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onboarding_step1_sent_at TIMESTAMPTZ;
