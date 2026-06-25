-- Section F: replace the flat 299/699 teacher tiers with the new ladder.
--   Standard teacher_standard  499  cap 20   7-day trial
--   Pro      teacher_pro        999  cap 50   "Best for Part-Time"
--   Scale    teacher_scale     2499  cap 100  +20 EGP / active student above 100
-- Prices are VAT-14%-inclusive (net = round(gross/1.14,2), vat = gross - net).
-- Source of truth mirrored in src/lib/teacherPlans.ts.

-- 1) Plan config rows (read by the provisioning trigger + status/upgrade routes).
INSERT INTO public.platform_config (key, value) VALUES
  ('teacher_subscription_plan',
   '{"plan_key":"teacher_standard","price_gross":499,"price_net":437.72,"vat_amount":61.28,"trial_days":7,"student_limit":20}'::jsonb),
  ('teacher_subscription_plan_pro',
   '{"plan_key":"teacher_pro","price_gross":999,"price_net":876.32,"vat_amount":122.68,"price_vat":122.68,"trial_days":0,"blast_credits_monthly":100,"student_limit":50,"group_limit":null}'::jsonb),
  ('teacher_subscription_plan_scale',
   '{"plan_key":"teacher_scale","price_gross":2499,"price_net":2192.11,"vat_amount":306.89,"price_vat":306.89,"trial_days":0,"blast_credits_monthly":100,"student_limit":100,"overage_per_student":20}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- 2) Drop the old CHECK constraints FIRST so the data migration to the new keys
-- is not rejected by the pre-existing 299/699-only constraint.
ALTER TABLE public.teacher_subscriptions DROP CONSTRAINT IF EXISTS teacher_subscriptions_plan_key_chk;
ALTER TABLE public.teacher_profiles DROP CONSTRAINT IF EXISTS teacher_profiles_plan_key_chk;

-- 3) Migrate the (handful of) existing rows. plan_key/price changes do not touch
-- status, so the lifecycle guard is not tripped.
UPDATE public.teacher_subscriptions
   SET plan_key='teacher_standard', price_gross=499, price_net=437.72, snap_vat_amount=61.28
 WHERE plan_key='teacher_299';
UPDATE public.teacher_subscriptions
   SET plan_key='teacher_pro', price_gross=999, price_net=876.32, snap_vat_amount=122.68
 WHERE plan_key='teacher_699';
UPDATE public.teacher_profiles SET plan_key='teacher_standard' WHERE plan_key='teacher_299';
UPDATE public.teacher_profiles SET plan_key='teacher_pro' WHERE plan_key='teacher_699';

-- 4) Add the new-ladder CHECK constraints.
ALTER TABLE public.teacher_subscriptions ADD CONSTRAINT teacher_subscriptions_plan_key_chk
  CHECK (plan_key = ANY (ARRAY['teacher_standard'::text,'teacher_pro'::text,'teacher_scale'::text]));
ALTER TABLE public.teacher_profiles ADD CONSTRAINT teacher_profiles_plan_key_chk
  CHECK ((plan_key IS NULL) OR (plan_key = ANY (ARRAY['teacher_standard'::text,'teacher_pro'::text,'teacher_scale'::text])));

-- 4) Generic plan setter (any tier). Sets price + blast credits, transitions to
-- active, opens a fresh 30-day period. Used by upgrades to Pro and Scale.
CREATE OR REPLACE FUNCTION public.set_teacher_plan_key(p_user_id uuid, p_plan_key text, p_actor_id uuid DEFAULT NULL::uuid)
RETURNS jsonb LANGUAGE plpgsql AS $fn$
declare
  v_sub public.teacher_subscriptions;
  v_gross numeric; v_net numeric; v_vat numeric; v_blast numeric;
  v_period_end timestamptz := now() + interval '30 days';
begin
  if p_plan_key not in ('teacher_standard','teacher_pro','teacher_scale') then
    raise exception 'invalid teacher plan_key %', p_plan_key using errcode='23514';
  end if;
  select * into v_sub from public.teacher_subscriptions where teacher_id=p_user_id for update;
  if not found then raise exception 'no teacher subscription for %', p_user_id using errcode='P0002'; end if;

  v_gross := case p_plan_key when 'teacher_standard' then 499 when 'teacher_pro' then 999 else 2499 end;
  v_net   := case p_plan_key when 'teacher_standard' then 437.72 when 'teacher_pro' then 876.32 else 2192.11 end;
  v_vat   := case p_plan_key when 'teacher_standard' then 61.28 when 'teacher_pro' then 122.68 else 306.89 end;
  v_blast := case p_plan_key when 'teacher_standard' then 0 else 100 end;

  if v_sub.plan_key = p_plan_key then
    return jsonb_build_object('already_on_plan', true, 'plan_key', p_plan_key);
  end if;
  if v_sub.status <> 'active' then
    perform public.apply_teacher_subscription_transition(v_sub.id, 'active', p_actor_id);
  end if;

  update public.teacher_subscriptions
     set plan_key=p_plan_key, price_gross=v_gross, price_net=v_net, snap_vat_amount=v_vat,
         current_period_start=now(), current_period_end=v_period_end, next_billing_at=v_period_end,
         last_payment_at=now(), grace_until=null, dunning_attempts=0
   where id=v_sub.id;
  update public.teacher_profiles set plan_key=p_plan_key, blast_credits_subscription=v_blast where user_id=p_user_id;
  insert into public.audit_log (action,entity_type,entity_id,user_id,center_id,details)
  values ('teacher_plan_changed','teacher_subscription',v_sub.id,p_actor_id,null,
          jsonb_build_object('from_plan',v_sub.plan_key,'to_plan',p_plan_key,'current_period_end',v_period_end));
  return jsonb_build_object('changed', true, 'plan_key', p_plan_key, 'current_period_end', v_period_end);
end; $fn$;

-- 5) Upgrade-to-Pro stays a named entry point (combinedPaymentFinalize calls it);
-- now a thin wrapper over the generic setter.
CREATE OR REPLACE FUNCTION public.upgrade_teacher_to_pro(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql AS $fn$
declare v_res jsonb;
begin
  v_res := public.set_teacher_plan_key(p_user_id, 'teacher_pro', p_user_id);
  return v_res || jsonb_build_object('upgraded', coalesce((v_res->>'changed')::boolean, (v_res->>'already_on_plan')::boolean, false));
end; $fn$;

-- 6) Upgrade-to-Scale entry point.
CREATE OR REPLACE FUNCTION public.upgrade_teacher_to_scale(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql AS $fn$
declare v_res jsonb;
begin
  v_res := public.set_teacher_plan_key(p_user_id, 'teacher_scale', p_user_id);
  return v_res || jsonb_build_object('upgraded', coalesce((v_res->>'changed')::boolean, (v_res->>'already_on_plan')::boolean, false));
end; $fn$;

-- 7) Downgrade to Standard (Pro or Scale -> Standard); keeps the current period.
CREATE OR REPLACE FUNCTION public.downgrade_teacher_to_standard(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql AS $fn$
declare v_sub public.teacher_subscriptions;
begin
  select * into v_sub from public.teacher_subscriptions where teacher_id=p_user_id for update;
  if not found then raise exception 'no teacher subscription for %', p_user_id using errcode='P0002'; end if;
  if v_sub.plan_key='teacher_standard' then return jsonb_build_object('already_standard', true); end if;
  if v_sub.plan_key not in ('teacher_pro','teacher_scale') then
    raise exception 'unexpected plan_key % on downgrade', v_sub.plan_key using errcode='23514';
  end if;
  update public.teacher_subscriptions
     set plan_key='teacher_standard', price_gross=499, price_net=437.72, snap_vat_amount=61.28
   where id=v_sub.id;
  update public.teacher_profiles set plan_key='teacher_standard', blast_credits_subscription=0 where user_id=p_user_id;
  insert into public.audit_log (action,entity_type,entity_id,user_id,center_id,details)
  values ('teacher_downgraded_to_standard','teacher_subscription',v_sub.id,p_user_id,null,
          jsonb_build_object('from_plan',v_sub.plan_key,'to_plan','teacher_standard'));
  return jsonb_build_object('downgraded', true);
end; $fn$;

-- 8) Monthly blast credits go to Pro AND Scale.
CREATE OR REPLACE FUNCTION public.reset_subscription_blast_credits(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql AS $fn$
declare v_plan_key text;
begin
  select plan_key into v_plan_key from public.teacher_profiles where user_id=p_user_id for update;
  if not found then raise exception 'no teacher profile for %', p_user_id using errcode='P0002'; end if;
  if v_plan_key not in ('teacher_pro','teacher_scale') then
    return jsonb_build_object('reset', false, 'reason', 'not_pro');
  end if;
  update public.teacher_profiles set blast_credits_subscription=100 where user_id=p_user_id;
  insert into public.audit_log (action,entity_type,entity_id,user_id,center_id,details)
  values ('teacher_blast_credits_reset','teacher_profile',p_user_id,p_user_id,null,
          jsonb_build_object('blast_credits_subscription',100));
  return jsonb_build_object('reset', true);
end; $fn$;

NOTIFY pgrst, 'reload schema';
