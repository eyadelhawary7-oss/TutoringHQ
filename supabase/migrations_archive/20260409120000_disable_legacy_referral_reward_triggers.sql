-- Legacy create_referral_reward populated referral_rewards from pricing_plans.monthly_fee * %.
-- Referral payouts now use public.referral_commissions + /api/cron/referral-automation (net revenue base).
DROP TRIGGER IF EXISTS on_center_insert_referral ON centers;
DROP TRIGGER IF EXISTS on_center_subscribe_referral ON centers;
