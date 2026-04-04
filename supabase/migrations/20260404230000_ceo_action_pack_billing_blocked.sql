-- Allow CEO queue rows when top_centers pack billing is blocked (missing custom minimum)
ALTER TABLE ceo_action_queue DROP CONSTRAINT IF EXISTS ceo_action_queue_type_check;
ALTER TABLE ceo_action_queue ADD CONSTRAINT ceo_action_queue_type_check
  CHECK (type IN (
    'churn_risk','activation','collection','sales','ops','renewal','cancellation_request',
    'pack_billing_blocked'
  ));
