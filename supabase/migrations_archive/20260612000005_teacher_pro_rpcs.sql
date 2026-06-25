-- Phase 3 Pro tier, migration 005: lifecycle RPCs (SECURITY DEFINER, service_role-only).
--
-- Schema reality the prompt's pseudo-code did not anticipate (catalog-verified):
--   * status / current_period_* / price_* live on teacher_subscriptions.
--   * plan_key is mirrored on BOTH teacher_subscriptions (NOT NULL, source of
--     truth) and teacher_profiles (nullable mirror, fast reads).
--   * blast_credits_* live on teacher_profiles.
--   * guard_teacher_subscriptions_lifecycle blocks direct UPDATE of *status*
--     only (plan_key / period / price are NOT guarded). Status changes go
--     through apply_teacher_subscription_transition (the sanctioned FSM RPC).
-- So each RPC touches BOTH tables and routes the status change through the FSM.

-- =====================================================================
-- RPC 1: upgrade_teacher_to_pro(p_user_id) - called by Paymob webhook
--        finalize after payment confirmation. Idempotent.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.upgrade_teacher_to_pro(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
declare
  v_sub        public.teacher_subscriptions;
  v_period_end timestamptz := now() + interval '30 days';
begin
  select * into v_sub
    from public.teacher_subscriptions
   where teacher_id = p_user_id
   for update;
  if not found then
    raise exception 'no teacher subscription for %', p_user_id using errcode = 'P0002';
  end if;

  -- Idempotent: a replayed webhook must not double-apply.
  if v_sub.plan_key = 'teacher_699' then
    return jsonb_build_object('already_pro', true);
  end if;

  if v_sub.plan_key <> 'teacher_299' then
    raise exception 'unexpected plan_key % on upgrade', v_sub.plan_key using errcode = '23514';
  end if;
  if v_sub.status not in ('trialing', 'active', 'cancelled') then
    raise exception 'subscription status % not eligible for upgrade', v_sub.status using errcode = '23514';
  end if;

  -- Status -> active via the lifecycle FSM (handles the guard + its own audit).
  if v_sub.status <> 'active' then
    perform public.apply_teacher_subscription_transition(v_sub.id, 'active', p_user_id);
  end if;

  -- Plan / price / period are not status, so a plain UPDATE passes the guard.
  -- Upgrade resets the billing period to the upgrade date (no proration).
  update public.teacher_subscriptions
     set plan_key             = 'teacher_699',
         price_gross          = 699,
         price_net            = 613.16,
         snap_vat_amount      = 85.84,
         current_period_start = now(),
         current_period_end   = v_period_end,
         next_billing_at      = v_period_end,
         last_payment_at      = now(),
         grace_until          = null,
         dunning_attempts     = 0
   where id = v_sub.id;

  -- Mirror plan_key + grant the monthly subscription blast credits.
  update public.teacher_profiles
     set plan_key                   = 'teacher_699',
         blast_credits_subscription = 100
   where user_id = p_user_id;

  insert into public.audit_log (action, entity_type, entity_id, user_id, center_id, details)
  values ('teacher_upgraded_to_pro', 'teacher_subscription', v_sub.id, p_user_id, null,
          jsonb_build_object('from_plan', 'teacher_299', 'to_plan', 'teacher_699',
                             'current_period_end', v_period_end));

  return jsonb_build_object('upgraded', true, 'current_period_end', v_period_end);
end;
$function$;

REVOKE ALL ON FUNCTION public.upgrade_teacher_to_pro(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upgrade_teacher_to_pro(uuid) TO service_role;

-- =====================================================================
-- RPC 2: downgrade_teacher_to_standard(p_user_id) - called by the downgrade
--        API route after caps are resolved. Idempotent.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.downgrade_teacher_to_standard(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
declare
  v_sub public.teacher_subscriptions;
begin
  select * into v_sub
    from public.teacher_subscriptions
   where teacher_id = p_user_id
   for update;
  if not found then
    raise exception 'no teacher subscription for %', p_user_id using errcode = 'P0002';
  end if;

  if v_sub.plan_key = 'teacher_299' then
    return jsonb_build_object('already_standard', true);
  end if;
  if v_sub.plan_key <> 'teacher_699' then
    raise exception 'unexpected plan_key % on downgrade', v_sub.plan_key using errcode = '23514';
  end if;

  -- plan_key + price drop to Standard now; status and current_period_end are
  -- left untouched so the teacher keeps Pro access until the period ends, and
  -- the next renewal charges the Standard price. (status not changed -> guard ok.)
  update public.teacher_subscriptions
     set plan_key        = 'teacher_299',
         price_gross     = 299,
         price_net       = 262.28,
         snap_vat_amount = 36.72
   where id = v_sub.id;

  -- Mirror plan_key; subscription blast credits are forfeited immediately.
  -- Purchased credits are deliberately untouched.
  update public.teacher_profiles
     set plan_key                   = 'teacher_299',
         blast_credits_subscription = 0
   where user_id = p_user_id;

  insert into public.audit_log (action, entity_type, entity_id, user_id, center_id, details)
  values ('teacher_downgraded_to_standard', 'teacher_subscription', v_sub.id, p_user_id, null,
          jsonb_build_object('from_plan', 'teacher_699', 'to_plan', 'teacher_299'));

  return jsonb_build_object('downgraded', true);
end;
$function$;

REVOKE ALL ON FUNCTION public.downgrade_teacher_to_standard(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.downgrade_teacher_to_standard(uuid) TO service_role;

-- =====================================================================
-- RPC 3: deduct_blast_credits(p_user_id, p_amount) - spend subscription
--        credits first, then purchased.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.deduct_blast_credits(p_user_id uuid, p_amount numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
declare
  v_sub         numeric;
  v_purch       numeric;
  v_sub_deduct  numeric;
  v_purch_deduct numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'p_amount must be positive' using errcode = '22023';
  end if;

  select blast_credits_subscription, blast_credits_purchased
    into v_sub, v_purch
    from public.teacher_profiles
   where user_id = p_user_id
   for update;
  if not found then
    raise exception 'no teacher profile for %', p_user_id using errcode = 'P0002';
  end if;

  if (v_sub + v_purch) < p_amount then
    raise exception 'INSUFFICIENT_CREDITS' using errcode = '23514';
  end if;

  v_sub_deduct   := least(v_sub, p_amount);
  v_purch_deduct := p_amount - v_sub_deduct;

  update public.teacher_profiles
     set blast_credits_subscription = v_sub - v_sub_deduct,
         blast_credits_purchased    = v_purch - v_purch_deduct
   where user_id = p_user_id;

  return jsonb_build_object(
    'subscription_used',      v_sub_deduct,
    'purchased_used',         v_purch_deduct,
    'subscription_remaining', v_sub - v_sub_deduct,
    'purchased_remaining',    v_purch - v_purch_deduct
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.deduct_blast_credits(uuid, numeric) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_blast_credits(uuid, numeric) TO service_role;

-- =====================================================================
-- RPC 4: reset_subscription_blast_credits(p_user_id) - called on Pro renewal.
--        Sets subscription credits back to 100. No-op for Standard.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.reset_subscription_blast_credits(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
declare
  v_plan_key text;
begin
  select plan_key into v_plan_key
    from public.teacher_profiles
   where user_id = p_user_id
   for update;
  if not found then
    raise exception 'no teacher profile for %', p_user_id using errcode = 'P0002';
  end if;

  if v_plan_key is distinct from 'teacher_699' then
    return jsonb_build_object('reset', false, 'reason', 'not_pro');
  end if;

  update public.teacher_profiles
     set blast_credits_subscription = 100
   where user_id = p_user_id;

  insert into public.audit_log (action, entity_type, entity_id, user_id, center_id, details)
  values ('teacher_blast_credits_reset', 'teacher_profile', p_user_id, p_user_id, null,
          jsonb_build_object('blast_credits_subscription', 100));

  return jsonb_build_object('reset', true);
end;
$function$;

REVOKE ALL ON FUNCTION public.reset_subscription_blast_credits(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_subscription_blast_credits(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
