CREATE OR REPLACE FUNCTION public.create_enrollment(p_group_id uuid, p_student_id uuid, p_payer text DEFAULT NULL::text, p_actor_id uuid DEFAULT NULL::uuid, p_source text DEFAULT NULL::text)
 RETURNS TABLE(enrollment_id uuid, status text)
 LANGUAGE plpgsql
AS $function$
declare
  v_group       public.student_groups%rowtype;
  v_teacher_id  uuid;
  v_live_count  int;
  v_status      text;
  v_new_id      uuid;
begin
  select * into v_group from public.student_groups sg where sg.id = p_group_id for update;
  if not found then
    raise exception 'group % not found', p_group_id using errcode = 'P0002';
  end if;
  if v_group.status <> 'active' then
    raise exception 'group % is not active (status %)', p_group_id, v_group.status using errcode = '23514';
  end if;

  if p_payer is not null and p_payer not in ('student','parent') then
    raise exception 'invalid payer %', p_payer using errcode = '23514';
  end if;
  if p_source is not null and p_source not in ('self_link','walk_in','inherited','import') then
    raise exception 'invalid source %', p_source using errcode = '23514';
  end if;

  v_teacher_id := v_group.teacher_id;
  if v_teacher_id is not null
     and exists (select 1 from public.teacher_subscriptions ts
                 where ts.teacher_id = v_teacher_id and ts.status = 'suspended') then
    raise exception 'teacher % is suspended; enrollment blocked', v_teacher_id using errcode = '23514';
  end if;

  if not exists (select 1 from public.students st where st.id = p_student_id) then
    raise exception 'student % not found', p_student_id using errcode = 'P0002';
  end if;

  if exists (select 1 from public.enrollments e
             where e.group_id = p_group_id and e.student_id = p_student_id
               and e.status in ('pending','active')) then
    raise exception 'student % already has a live enrollment in group %', p_student_id, p_group_id
      using errcode = '23505';
  end if;

  if v_group.capacity_cap is not null then
    select count(*) into v_live_count
    from public.enrollments e
    where e.group_id = p_group_id and e.status in ('pending','active');
    if v_live_count >= v_group.capacity_cap then
      raise exception 'group % is at capacity (% / %)', p_group_id, v_live_count, v_group.capacity_cap
        using errcode = '23514';
    end if;
  end if;

  if coalesce(v_group.approval_mode, 'manual') = 'auto_cap' then
    v_status := 'active';
  else
    v_status := 'pending';
  end if;

  insert into public.enrollments (group_id, student_id, status, payer, source, approved_by, joined_at)
  values (
    p_group_id, p_student_id, v_status, p_payer, p_source,
    case when v_status = 'active' then p_actor_id else null end,
    case when v_status = 'active' then now() else null end
  )
  returning id into v_new_id;

  insert into public.audit_log (action, entity_type, entity_id, user_id, center_id, details)
  values (
    'enrollment_created', 'enrollment', v_new_id, p_actor_id, v_group.center_id,
    jsonb_build_object('group_id', p_group_id, 'student_id', p_student_id, 'status', v_status, 'source', p_source)
  );

  return query select v_new_id, v_status;
end;
$function$
;
revoke execute on function public.create_enrollment(uuid,uuid,text,uuid,text) from public, anon, authenticated;
grant execute on function public.create_enrollment(uuid,uuid,text,uuid,text) to service_role;
notify pgrst, 'reload schema';
