-- Grace period (calendar days after next_payment_due before auto_suspend_at); consumed when computing suspend date.
INSERT INTO public.platform_config (key, value)
VALUES ('subscription_grace_period_days', '7'::jsonb)
ON CONFLICT (key) DO NOTHING;
