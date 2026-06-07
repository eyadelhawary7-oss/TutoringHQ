create or replace function public.apply_session_transition(
  p_session_id uuid,
  p_new_status text,
  p_actor_id   uuid default null
)
returns public.sessions
language plpgsql
as $$
declare
  v_sess       public.sessions;
  v_old_status text;
  v_center_id  uuid;
begin
  select * into v_sess from public.sessions where id = p_session_id for update;
  if not found then
    raise exception 'session % not found', p_session_id using errcode = 'P0002';
  end if;

  v_old_status := v_sess.status;

  if p_new_status not in ('scheduled','live','finished','cancelled') then
    raise exception 'invalid session status %', p_new_status using errcode = '23514';
  end if;

  if v_old_status = p_new_status then
    return v_sess;
  end if;

  if not (
        (v_old_status = 'scheduled' and p_new_status in ('live','finished','cancelled'))
     or (v_old_status = 'live'      and p_new_status in ('finished','cancelled'))
  ) then
    raise exception 'illegal session transition: % -> %', v_old_status, p_new_status
      using errcode = '23514';
  end if;

  update public.sessions
     set status      = p_new_status,
         finished_at = case when p_new_status = 'finished' and finished_at is null
                            then now() else finished_at end
   where id = p_session_id
   returning * into v_sess;

  select sg.center_id into v_center_id
    from public.student_groups sg
   where sg.id = v_sess.group_id;

  insert into public.audit_log (action, entity_type, entity_id, user_id, center_id, details)
  values (
    'session_transition',
    'session',
    v_sess.id,
    p_actor_id,
    v_center_id,
    jsonb_build_object('from', v_old_status, 'to', p_new_status)
  );

  return v_sess;
end;
$$;

revoke execute on function public.apply_session_transition(uuid, text, uuid) from public, anon, authenticated;
grant  execute on function public.apply_session_transition(uuid, text, uuid) to service_role;

notify pgrst, 'reload schema';
