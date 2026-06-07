create or replace function public.apply_enrollment_transition(
  p_enrollment_id uuid,
  p_new_status   text,
  p_actor_id     uuid default null
)
returns public.enrollments
language plpgsql
as $$
declare
  v_enr        public.enrollments;
  v_old_status text;
  v_center_id  uuid;
begin
  select * into v_enr from public.enrollments where id = p_enrollment_id for update;
  if not found then
    raise exception 'enrollment % not found', p_enrollment_id using errcode = 'P0002';
  end if;

  v_old_status := v_enr.status;

  if p_new_status not in ('pending','active','rejected','removed') then
    raise exception 'invalid enrollment status %', p_new_status using errcode = '23514';
  end if;

  if v_old_status = p_new_status then
    return v_enr;
  end if;

  -- rejected and removed are terminal; a returning student is enrolled fresh, not revived
  if not (
        (v_old_status = 'pending' and p_new_status in ('active','rejected','removed'))
     or (v_old_status = 'active'  and p_new_status = 'removed')
  ) then
    raise exception 'illegal enrollment transition: % -> %', v_old_status, p_new_status
      using errcode = '23514';
  end if;

  update public.enrollments
     set status      = p_new_status,
         approved_by = case when p_new_status in ('active','rejected')
                            then coalesce(p_actor_id, approved_by) else approved_by end,
         joined_at   = case when p_new_status = 'active' and joined_at is null
                            then now() else joined_at end
   where id = p_enrollment_id
   returning * into v_enr;

  select sg.center_id into v_center_id
    from public.student_groups sg
   where sg.id = v_enr.group_id;

  insert into public.audit_log (action, entity_type, entity_id, user_id, center_id, details)
  values (
    'enrollment_transition',
    'enrollment',
    v_enr.id,
    p_actor_id,
    v_center_id,
    jsonb_build_object('from', v_old_status, 'to', p_new_status)
  );

  return v_enr;
end;
$$;

revoke execute on function public.apply_enrollment_transition(uuid, text, uuid) from public, anon, authenticated;
grant  execute on function public.apply_enrollment_transition(uuid, text, uuid) to service_role;

notify pgrst, 'reload schema';
