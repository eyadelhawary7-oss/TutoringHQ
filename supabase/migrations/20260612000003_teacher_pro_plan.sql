-- Phase 3 Pro tier, migration 003: make teacher_699 (Pro) a real purchasable plan.
--
-- Catalog reality (verified via introspection before writing this):
--   * teacher subscription lifecycle (status, current_period_*, price_*) lives on
--     public.teacher_subscriptions, NOT on teacher_profiles.
--   * teacher_profiles carries a mirrored plan_key (nullable) for fast reads.
--   * NO plan_key CHECK constraint existed on either table, so we ADD one here
--     (the Step 1 "drop+recreate" branch does not apply).
--   * combined_payment_sessions.session_type CHECK did not include the teacher
--     session types, so the upgrade (and the latent resubscribe) flow would fail
--     the constraint the moment Paymob goes live. We extend it here so the Pro
--     upgrade payment session can be inserted.

-- 1. Pro plan config. 699 EGP gross, VAT-inclusive at 14%.
--    Net = 699 / 1.14 = 613.16 ; VAT = 699 - 613.16 = 85.84. No trial for Pro.
INSERT INTO public.platform_config (key, value)
VALUES (
  'teacher_subscription_plan_pro',
  jsonb_build_object(
    'plan_key', 'teacher_699',
    'price_gross', 699,
    'price_net', 613.16,
    'price_vat', 85.84,
    'trial_days', 0,
    'blast_credits_monthly', 100,
    'group_limit', null,
    'student_limit', null
  )
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- 2. plan_key CHECK constraints. None existed before (catalog-verified), so we
--    ADD rather than drop+recreate. teacher_subscriptions.plan_key is NOT NULL;
--    teacher_profiles.plan_key is nullable (mirror), so NULL is allowed.
ALTER TABLE public.teacher_subscriptions
  DROP CONSTRAINT IF EXISTS teacher_subscriptions_plan_key_chk;
ALTER TABLE public.teacher_subscriptions
  ADD CONSTRAINT teacher_subscriptions_plan_key_chk
  CHECK (plan_key IN ('teacher_299', 'teacher_699'));

ALTER TABLE public.teacher_profiles
  DROP CONSTRAINT IF EXISTS teacher_profiles_plan_key_chk;
ALTER TABLE public.teacher_profiles
  ADD CONSTRAINT teacher_profiles_plan_key_chk
  CHECK (plan_key IS NULL OR plan_key IN ('teacher_299', 'teacher_699'));

-- 3. Allow the teacher payment session types. The existing center types are
--    preserved; we add teacher_upgrade (this phase) and teacher_resubscribe
--    (already referenced by combinedPaymentFinalize but missing from the check).
ALTER TABLE public.combined_payment_sessions
  DROP CONSTRAINT IF EXISTS combined_payment_sessions_session_type_check;
ALTER TABLE public.combined_payment_sessions
  ADD CONSTRAINT combined_payment_sessions_session_type_check
  CHECK (session_type = ANY (ARRAY[
    'reactivation_tier1',
    'reactivation_tier2',
    'signup',
    'upgrade',
    'pack',
    'cards',
    'teacher_resubscribe',
    'teacher_upgrade'
  ]));

NOTIFY pgrst, 'reload schema';
