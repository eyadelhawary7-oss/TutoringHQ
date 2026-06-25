-- Teacher subscription: pricing config + auto-provision on first private group + access helper.
-- Captured from live prod (config row + pg_get_functiondef + pg_get_triggerdef). Repo sync; already applied.

insert into public.platform_config (key, value)
values ('teacher_subscription_plan',
  jsonb_build_object('plan_key','teacher_299','price_gross',299,'price_net',262.28,'vat_amount',36.72,'trial_days',14))
on conflict (key) do update set value = excluded.value;

CREATE OR REPLACE FUNCTION public.provision_teacher_subscription_on_first_private_group()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  v_plan jsonb;
  v_trial_days int;
begin
  if new.kind <> 'private' or new.teacher_id is null then
    return new;
  end if;

  -- Already has a subscription row? do nothing (idempotent across 2nd/3rd group).
  if exists (select 1 from public.teacher_subscriptions ts where ts.teacher_id = new.teacher_id) then
    return new;
  end if;

  select value into v_plan from public.platform_config where key = 'teacher_subscription_plan';
  if v_plan is null then
    raise exception 'teacher_subscription_plan config missing; cannot provision subscription';
  end if;
  v_trial_days := coalesce((v_plan->>'trial_days')::int, 14);

  insert into public.teacher_subscriptions
    (teacher_id, plan_key, status, trial_ends_at, current_period_start, current_period_end,
     price_gross, price_net, snap_vat_amount, next_billing_at)
  values (
    new.teacher_id,
    v_plan->>'plan_key',
    'trialing',
    now() + make_interval(days => v_trial_days),
    now(),
    now() + make_interval(days => v_trial_days),
    (v_plan->>'price_gross')::numeric,
    (v_plan->>'price_net')::numeric,
    (v_plan->>'vat_amount')::numeric,
    now() + make_interval(days => v_trial_days)
  );

  insert into public.audit_log (action, entity_type, entity_id, user_id, details)
  values ('teacher_subscription_provisioned','teacher_subscription', new.teacher_id, new.teacher_id,
          jsonb_build_object('trigger_group_id', new.id, 'trial_days', v_trial_days));

  return new;
end; $function$;

drop trigger if exists trg_provision_teacher_subscription on public.student_groups;
create trigger trg_provision_teacher_subscription
  after insert on public.student_groups
  for each row execute function public.provision_teacher_subscription_on_first_private_group();

CREATE OR REPLACE FUNCTION public.teacher_private_access(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select exists (
    select 1 from public.teacher_subscriptions ts
    where ts.teacher_id = p_user_id
      and ts.status in ('trialing','active')
  );
$function$;

notify pgrst, 'reload schema';
