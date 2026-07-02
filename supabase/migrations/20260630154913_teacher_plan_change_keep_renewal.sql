-- G7: a teacher tier change must NOT reset the renewal clock. set_teacher_plan_key
-- previously stamped current_period_start/end + next_billing_at to now()+30d on every
-- change, which (combined with prorated upgrade pricing) would have handed out a fresh
-- near-free period. The plan/price change now keeps the existing renewal date; the
-- billing cadence is owned by the recurring engine, not by the plan change. Downgrades
-- no longer call this at all (they schedule for the next renewal).
CREATE OR REPLACE FUNCTION public.set_teacher_plan_key(p_user_id uuid, p_plan_key text, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_sub public.teacher_subscriptions;
  v_gross numeric; v_net numeric; v_vat numeric; v_blast numeric;
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
         last_payment_at=now(), grace_until=null, dunning_attempts=0
   where id=v_sub.id;
  update public.teacher_profiles set plan_key=p_plan_key, blast_credits_subscription=v_blast where user_id=p_user_id;
  insert into public.audit_log (action,entity_type,entity_id,user_id,center_id,details)
  values ('teacher_plan_changed','teacher_subscription',v_sub.id,p_actor_id,null,
          jsonb_build_object('from_plan',v_sub.plan_key,'to_plan',p_plan_key,'current_period_end',v_sub.current_period_end));
  return jsonb_build_object('changed', true, 'plan_key', p_plan_key, 'current_period_end', v_sub.current_period_end);
end; $function$
;

notify pgrst, 'reload schema';
