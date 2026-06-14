-- ITEM 1: persist the ?plan=pro signup intent.
--
-- The teacher signup route writes public.teacher_profiles (it does NOT create a
-- teacher_subscriptions row - that is provisioned by trg_provision_teacher_subscription
-- on the first private group). So the pro-intent flag lives on teacher_profiles,
-- the only signup-time table, alongside the consent columns.
--
-- This is purely a steering hint for the post-signup flow (pre-select / route to
-- Pro). It does NOT change the trial: every teacher still gets the 14-day Standard
-- (teacher_299) trial from the provisioning trigger. NULL = no intent (default,
-- unchanged behaviour). 'pro' = the teacher arrived via ?plan=pro.
--
-- Free text (no CHECK) so future plan hints do not require a constraint migration;
-- the route only ever writes the literal 'pro'.
ALTER TABLE public.teacher_profiles
  ADD COLUMN IF NOT EXISTS signup_plan_intent text;

NOTIFY pgrst, 'reload schema';
