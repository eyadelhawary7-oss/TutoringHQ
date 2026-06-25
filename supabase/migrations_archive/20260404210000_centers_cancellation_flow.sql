-- Center self-cancellation + CEO queue type for cancellation requests
ALTER TABLE centers
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancellation_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_approved_at TIMESTAMPTZ;

ALTER TABLE centers DROP CONSTRAINT IF EXISTS centers_status_check;
ALTER TABLE centers ADD CONSTRAINT centers_status_check
  CHECK (status IN (
    'pending','active','suspended','rejected',
    'cancelled','paid_pending_activation','pending_cancellation'
  ));

ALTER TABLE ceo_action_queue DROP CONSTRAINT IF EXISTS ceo_action_queue_type_check;
ALTER TABLE ceo_action_queue ADD CONSTRAINT ceo_action_queue_type_check
  CHECK (type IN (
    'churn_risk','activation','collection','sales','ops','renewal','cancellation_request'
  ));
