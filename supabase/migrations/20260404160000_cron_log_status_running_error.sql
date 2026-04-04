-- Allow cron routes to log in-progress and error states (e.g. automated backups)
ALTER TABLE cron_log DROP CONSTRAINT IF EXISTS cron_log_status_check;
ALTER TABLE cron_log ADD CONSTRAINT cron_log_status_check
  CHECK (status IN ('success', 'failure', 'partial', 'running', 'error'));
