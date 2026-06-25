-- Summer-2026 billing brief — Section 4 (trial 7→14) + Section 5 (processing fee controls).
--
-- 1) Teacher free trial: 7 → 14 days. The provisioning trigger
--    (provision_teacher_subscription_on_first_private_group) already reads
--    trial_days from this config row dynamically, so this is the only DB change
--    needed for the new trial length to take effect.
UPDATE public.platform_config
   SET value = jsonb_set(value, '{trial_days}', '14'::jsonb),
       updated_at = now()
 WHERE key = 'teacher_subscription_plan';

-- 2) Processing fee — two editable controls (no rebuild needed; surfaced in
--    /admin/platform-config as a toggle + a number input):
--      processing_fee_enabled : hides/shows the fee everywhere at once. Default ON.
--      processing_fee_amount  : flat EGP amount. Default 20 (can change to e.g. 9).
INSERT INTO public.platform_config (key, value)
VALUES
  ('processing_fee_enabled', 'true'::jsonb),
  ('processing_fee_amount', '20'::jsonb)
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
