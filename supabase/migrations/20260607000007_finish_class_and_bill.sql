CREATE OR REPLACE FUNCTION public.finish_class_and_bill(p_session_id uuid, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(session_id uuid, billed_now boolean, charges_created integer)
 LANGUAGE plpgsql
AS $function$
declare v_session public.sessions%rowtype; v_group public.student_groups%rowtype;
  v_fee numeric; v_teacher_id uuid; v_center_id uuid; v_count int:=0;
  v_attendee record; v_payer text; v_payer_phone text;
begin
  select * into v_session from public.sessions where id=p_session_id for update;
  if not found then raise exception 'session % not found', p_session_id using errcode='P0002'; end if;
  if v_session.billed then return query select v_session.id,false,0; return; end if;
  if v_session.status='cancelled' then raise exception 'cannot bill a cancelled session %', p_session_id using errcode='23514'; end if;
  if v_session.kind<>'private' then raise exception 'finish_class_and_bill is private-only; session % is kind %', p_session_id, v_session.kind using errcode='23514'; end if;
  select * into v_group from public.student_groups where id=v_session.group_id for update;
  if not found then raise exception 'group % for session % not found', v_session.group_id, p_session_id using errcode='P0002'; end if;
  v_fee:=v_group.fee_per_class; v_teacher_id:=v_group.teacher_id; v_center_id:=v_group.center_id;
  if v_fee is null then raise exception 'group % has no fee_per_class; cannot bill', v_group.id using errcode='23514'; end if;
  if v_teacher_id is null then raise exception 'group % has no teacher_id; cannot bill', v_group.id using errcode='23514'; end if;
  if not exists (select 1 from public.teacher_profiles tp where tp.user_id=v_teacher_id) then
    raise exception 'no teacher_profile for user %; cannot bill group %', v_teacher_id, v_group.id using errcode='23503'; end if;
  if v_session.status<>'finished' then perform public.apply_session_transition(p_session_id,'finished',p_actor_id); end if;
  for v_attendee in select a.student_id from public.attendance_scans a where a.session_id=p_session_id and a.billable=true
  loop
    v_payer:=null; v_payer_phone:=null;
    select e.payer into v_payer from public.enrollments e where e.group_id=v_session.group_id and e.student_id=v_attendee.student_id;
    if v_payer='parent' then select s.parent_phone into v_payer_phone from public.students s where s.id=v_attendee.student_id;
    elsif v_payer='student' then select s.phone into v_payer_phone from public.students s where s.id=v_attendee.student_id; end if;
    insert into public.transactions (kind,session_id,enrollment_id,student_id,group_id,teacher_id,center_id,
      lesson_fee,amount_billed,payer_type,payer_phone,status,idempotency_key,created_by)
    select 'lesson',p_session_id,
      (select e.id from public.enrollments e where e.group_id=v_session.group_id and e.student_id=v_attendee.student_id),
      v_attendee.student_id,v_session.group_id,v_teacher_id,v_center_id,v_fee,v_fee,v_payer,v_payer_phone,'pending',
      'lesson:'||p_session_id::text||':'||v_attendee.student_id::text,p_actor_id
    where not exists (select 1 from public.transactions t where t.idempotency_key='lesson:'||p_session_id::text||':'||v_attendee.student_id::text);
    if found then v_count:=v_count+1; end if;
  end loop;
  set local app.allow_lifecycle_write='on';
  update public.sessions set billed=true, billed_at=now() where id=p_session_id;
  set local app.allow_lifecycle_write='off';
  insert into public.audit_log (action,entity_type,entity_id,user_id,center_id,details)
  values ('class_finished_billed','session',p_session_id,p_actor_id,v_center_id,
          jsonb_build_object('charges_created',v_count,'fee_per_class',v_fee,'teacher_id',v_teacher_id));
  return query select p_session_id,true,v_count;
end; $function$
;
revoke execute on function public.finish_class_and_bill(uuid,uuid) from public, anon, authenticated;
grant execute on function public.finish_class_and_bill(uuid,uuid) to service_role;
notify pgrst, 'reload schema';
