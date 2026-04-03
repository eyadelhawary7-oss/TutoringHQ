-- Allow centers paid while new-signup intake is paused (auto-approval + pause_new_signups)
ALTER TABLE centers DROP CONSTRAINT IF EXISTS centers_status_check;
ALTER TABLE centers ADD CONSTRAINT centers_status_check
  CHECK (status IN (
    'pending',
    'pending_verification',
    'paid_pending_activation',
    'active',
    'suspended',
    'rejected',
    'deleted'
  ));
