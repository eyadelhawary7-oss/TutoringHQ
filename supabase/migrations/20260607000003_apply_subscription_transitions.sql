-- Center subscription status machine: active|past_due|suspended|cancelled
create or replace function public.apply_center_subscription_transition(
  p_subscription_id uuid,
  p_new_status      text,
  p_actor_id        uuid default null
)
returns public.subscriptions
language plpgsql
as $$
declare
  v_sub        public.subscriptions;
  v_old_status text;
begin
  select * into v_sub from public.subscriptions where id = p_subscription_id for update;
  if not found then
    raise exception 'subscription % not found', p_subscription_id using errcode = 'P0002';
  end if;

  v_old_status := v_sub.status;

  if p_new_status not in ('active','past_due','suspended','cancelled') then
    raise exception 'invalid subscription status %', p_new_status using errcode = '23514';
  end if;

  if v_old_status = p_new_status then
    return v_sub;
  end if;

  if not (
        (v_old_status = 'active'    and p_new_status in ('past_due','suspended','cancelled'))
     or (v_old_status = 'past_due'  and p_new_status in ('active','suspended','cancelled'))
     or (v_old_status = 'suspended' and p_new_status in ('active','cancelled'))
     or (v_old_status = 'cancelled' and p_new_status = 'active')
  ) then
    raise exception 'illegal subscription transition: % -> %', v_old_status, p_new_status
      using errcode = '23514';
  end if;

  update public.subscriptions
     set status     = p_new_status,
         updated_at = now()
   where id = p_subscription_id
   returning * into v_sub;

  insert into public.audit_log (action, entity_type, entity_id, user_id, center_id, details)
  values (
    'center_subscription_transition',
    'subscription',
    v_sub.id,
    p_actor_id,
    v_sub.center_id,
    jsonb_build_object('from', v_old_status, 'to', p_new_status)
  );

  return v_sub;
end;
$$;

-- Teacher subscription status machine: trialing|active|past_due|suspended|cancelled
create or replace function public.apply_teacher_subscription_transition(
  p_subscription_id uuid,
  p_new_status      text,
  p_actor_id        uuid default null
)
returns public.teacher_subscriptions
language plpgsql
as $$
declare
  v_sub        public.teacher_subscriptions;
  v_old_status text;
begin
  select * into v_sub from public.teacher_subscriptions where id = p_subscription_id for update;
  if not found then
    raise exception 'teacher subscription % not found', p_subscription_id using errcode = 'P0002';
  end if;

  v_old_status := v_sub.status;

  if p_new_status not in ('trialing','active','past_due','suspended','cancelled') then
    raise exception 'invalid teacher subscription status %', p_new_status using errcode = '23514';
  end if;

  if v_old_status = p_new_status then
    return v_sub;
  end if;

  if not (
        (v_old_status = 'trialing'  and p_new_status in ('active','past_due','cancelled'))
     or (v_old_status = 'active'    and p_new_status in ('past_due','suspended','cancelled'))
     or (v_old_status = 'past_due'  and p_new_status in ('active','suspended','cancelled'))
     or (v_old_status = 'suspended' and p_new_status in ('active','cancelled'))
     or (v_old_status = 'cancelled' and p_new_status = 'active')
  ) then
    raise exception 'illegal teacher subscription transition: % -> %', v_old_status, p_new_status
      using errcode = '23514';
  end if;

  update public.teacher_subscriptions
     set status = p_new_status
   where id = p_subscription_id
   returning * into v_sub;

  insert into public.audit_log (action, entity_type, entity_id, user_id, center_id, details)
  values (
    'teacher_subscription_transition',
    'teacher_subscription',
    v_sub.id,
    p_actor_id,
    null,
    jsonb_build_object('from', v_old_status, 'to', p_new_status, 'teacher_id', v_sub.teacher_id)
  );

  return v_sub;
end;
$$;

revoke execute on function public.apply_center_subscription_transition(uuid, text, uuid)  from public, anon, authenticated;
grant  execute on function public.apply_center_subscription_transition(uuid, text, uuid)  to service_role;
revoke execute on function public.apply_teacher_subscription_transition(uuid, text, uuid) from public, anon, authenticated;
grant  execute on function public.apply_teacher_subscription_transition(uuid, text, uuid) to service_role;

notify pgrst, 'reload schema';
