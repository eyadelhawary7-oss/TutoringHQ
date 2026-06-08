-- Lifecycle enforcement: 5 writer functions open a one-statement-wide
-- app.allow_lifecycle_write window; 4 guard triggers block direct writes to
-- protected columns. Captured verbatim from live prod (repo sync; already applied).

CREATE OR REPLACE FUNCTION public.apply_transaction_transition(p_transaction_id uuid, p_new_status text, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS transactions
 LANGUAGE plpgsql
AS $function$
declare v_txn public.transactions; v_old_status text;
begin
  select * into v_txn from public.transactions where id=p_transaction_id for update;
  if not found then raise exception 'transaction % not found', p_transaction_id using errcode='P0002'; end if;
  v_old_status:=v_txn.status;
  if p_new_status not in ('pending','paid','failed','cancelled') then raise exception 'invalid transaction status %', p_new_status using errcode='23514'; end if;
  if v_old_status=p_new_status then return v_txn; end if;
  if not (v_old_status='pending' and p_new_status in ('paid','failed','cancelled')) then
    raise exception 'illegal transaction transition: % -> %', v_old_status, p_new_status using errcode='23514'; end if;
  set local app.allow_lifecycle_write='on';
  update public.transactions set status=p_new_status,
    paid_at=case when p_new_status='paid' and paid_at is null then now() else paid_at end,
    marked_paid_by=case when p_new_status='paid' then coalesce(p_actor_id,marked_paid_by) else marked_paid_by end
   where id=p_transaction_id returning * into v_txn;
  set local app.allow_lifecycle_write='off';
  insert into public.audit_log (action,entity_type,entity_id,user_id,center_id,details)
  values ('transaction_transition','transaction',v_txn.id,p_actor_id,v_txn.center_id,
          jsonb_build_object('from',v_old_status,'to',p_new_status,'is_test',v_txn.is_test));
  return v_txn;
end; $function$;

CREATE OR REPLACE FUNCTION public.apply_enrollment_transition(p_enrollment_id uuid, p_new_status text, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS enrollments
 LANGUAGE plpgsql
AS $function$
declare v_enr public.enrollments; v_old_status text; v_center_id uuid;
begin
  select * into v_enr from public.enrollments where id=p_enrollment_id for update;
  if not found then raise exception 'enrollment % not found', p_enrollment_id using errcode='P0002'; end if;
  v_old_status:=v_enr.status;
  if p_new_status not in ('pending','active','rejected','removed') then raise exception 'invalid enrollment status %', p_new_status using errcode='23514'; end if;
  if v_old_status=p_new_status then return v_enr; end if;
  if not ((v_old_status='pending' and p_new_status in ('active','rejected','removed'))
       or (v_old_status='active' and p_new_status='removed')) then
    raise exception 'illegal enrollment transition: % -> %', v_old_status, p_new_status using errcode='23514'; end if;
  set local app.allow_lifecycle_write='on';
  update public.enrollments set status=p_new_status,
    approved_by=case when p_new_status in ('active','rejected') then coalesce(p_actor_id,approved_by) else approved_by end,
    joined_at=case when p_new_status='active' and joined_at is null then now() else joined_at end
   where id=p_enrollment_id returning * into v_enr;
  set local app.allow_lifecycle_write='off';
  select sg.center_id into v_center_id from public.student_groups sg where sg.id=v_enr.group_id;
  insert into public.audit_log (action,entity_type,entity_id,user_id,center_id,details)
  values ('enrollment_transition','enrollment',v_enr.id,p_actor_id,v_center_id,
          jsonb_build_object('from',v_old_status,'to',p_new_status));
  return v_enr;
end; $function$;

CREATE OR REPLACE FUNCTION public.apply_session_transition(p_session_id uuid, p_new_status text, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS sessions
 LANGUAGE plpgsql
AS $function$
declare v_sess public.sessions; v_old_status text; v_center_id uuid;
begin
  select * into v_sess from public.sessions where id=p_session_id for update;
  if not found then raise exception 'session % not found', p_session_id using errcode='P0002'; end if;
  v_old_status:=v_sess.status;
  if p_new_status not in ('scheduled','live','finished','cancelled') then raise exception 'invalid session status %', p_new_status using errcode='23514'; end if;
  if v_old_status=p_new_status then return v_sess; end if;
  if not ((v_old_status='scheduled' and p_new_status in ('live','finished','cancelled'))
       or (v_old_status='live' and p_new_status in ('finished','cancelled'))) then
    raise exception 'illegal session transition: % -> %', v_old_status, p_new_status using errcode='23514'; end if;
  set local app.allow_lifecycle_write='on';
  update public.sessions set status=p_new_status,
    finished_at=case when p_new_status='finished' and finished_at is null then now() else finished_at end
   where id=p_session_id returning * into v_sess;
  set local app.allow_lifecycle_write='off';
  select sg.center_id into v_center_id from public.student_groups sg where sg.id=v_sess.group_id;
  insert into public.audit_log (action,entity_type,entity_id,user_id,center_id,details)
  values ('session_transition','session',v_sess.id,p_actor_id,v_center_id,
          jsonb_build_object('from',v_old_status,'to',p_new_status));
  return v_sess;
end; $function$;

CREATE OR REPLACE FUNCTION public.apply_teacher_subscription_transition(p_subscription_id uuid, p_new_status text, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS teacher_subscriptions
 LANGUAGE plpgsql
AS $function$
declare v_sub public.teacher_subscriptions; v_old_status text;
begin
  select * into v_sub from public.teacher_subscriptions where id=p_subscription_id for update;
  if not found then raise exception 'teacher subscription % not found', p_subscription_id using errcode='P0002'; end if;
  v_old_status:=v_sub.status;
  if p_new_status not in ('trialing','active','past_due','suspended','cancelled') then raise exception 'invalid teacher subscription status %', p_new_status using errcode='23514'; end if;
  if v_old_status=p_new_status then return v_sub; end if;
  if not ((v_old_status='trialing' and p_new_status in ('active','past_due','cancelled'))
       or (v_old_status='active' and p_new_status in ('past_due','suspended','cancelled'))
       or (v_old_status='past_due' and p_new_status in ('active','suspended','cancelled'))
       or (v_old_status='suspended' and p_new_status in ('active','cancelled'))
       or (v_old_status='cancelled' and p_new_status='active')) then
    raise exception 'illegal teacher subscription transition: % -> %', v_old_status, p_new_status using errcode='23514'; end if;
  set local app.allow_lifecycle_write='on';
  update public.teacher_subscriptions set status=p_new_status where id=p_subscription_id returning * into v_sub;
  set local app.allow_lifecycle_write='off';
  insert into public.audit_log (action,entity_type,entity_id,user_id,center_id,details)
  values ('teacher_subscription_transition','teacher_subscription',v_sub.id,p_actor_id,null,
          jsonb_build_object('from',v_old_status,'to',p_new_status,'teacher_id',v_sub.teacher_id));
  return v_sub;
end; $function$;

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
end; $function$;

revoke execute on function public.finish_class_and_bill(uuid, uuid) from public, anon, authenticated;
grant execute on function public.finish_class_and_bill(uuid, uuid) to service_role;

CREATE OR REPLACE FUNCTION public.guard_transactions_lifecycle()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if coalesce(current_setting('app.allow_lifecycle_write', true), '') = 'on' then
    return new;
  end if;
  if new.status is distinct from old.status
     or new.lesson_fee is distinct from old.lesson_fee
     or new.amount_billed is distinct from old.amount_billed
     or new.customer_commission_amt is distinct from old.customer_commission_amt
     or new.processing_fee_amt is distinct from old.processing_fee_amt
     or new.teacher_commission_amt is distinct from old.teacher_commission_amt
     or new.teacher_net is distinct from old.teacher_net
     or new.platform_gross is distinct from old.platform_gross
     or new.platform_net is distinct from old.platform_net
     or new.snap_vat_amount is distinct from old.snap_vat_amount
     or new.snap_customer_pct is distinct from old.snap_customer_pct
     or new.snap_teacher_pct is distinct from old.snap_teacher_pct
     or new.snap_processing_flat is distinct from old.snap_processing_flat
     or new.method is distinct from old.method
     or new.settlement_status is distinct from old.settlement_status
     or new.paid_at is distinct from old.paid_at
     or new.marked_paid_by is distinct from old.marked_paid_by
  then
    raise exception 'direct UPDATE of protected transactions columns is not allowed; use apply_transaction_transition'
      using errcode = '23514';
  end if;
  return new;
end; $function$;

CREATE OR REPLACE FUNCTION public.guard_sessions_lifecycle()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if coalesce(current_setting('app.allow_lifecycle_write', true), '') = 'on' then
    return new;
  end if;
  if new.status is distinct from old.status
     or new.billed is distinct from old.billed
     or new.billed_at is distinct from old.billed_at
     or new.finished_at is distinct from old.finished_at
  then
    raise exception 'direct UPDATE of protected sessions columns is not allowed; use apply_session_transition / finish_class_and_bill'
      using errcode = '23514';
  end if;
  return new;
end; $function$;

CREATE OR REPLACE FUNCTION public.guard_enrollments_lifecycle()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if coalesce(current_setting('app.allow_lifecycle_write', true), '') = 'on' then
    return new;
  end if;
  if new.status is distinct from old.status then
    raise exception 'direct UPDATE of enrollments.status is not allowed; use apply_enrollment_transition'
      using errcode = '23514';
  end if;
  return new;
end; $function$;

CREATE OR REPLACE FUNCTION public.guard_teacher_subscriptions_lifecycle()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if coalesce(current_setting('app.allow_lifecycle_write', true), '') = 'on' then
    return new;
  end if;
  if new.status is distinct from old.status then
    raise exception 'direct UPDATE of teacher_subscriptions.status is not allowed; use apply_teacher_subscription_transition'
      using errcode = '23514';
  end if;
  return new;
end; $function$;

drop trigger if exists trg_guard_transactions_lifecycle on public.transactions;
create trigger trg_guard_transactions_lifecycle
  before update on public.transactions
  for each row execute function public.guard_transactions_lifecycle();

drop trigger if exists trg_guard_sessions_lifecycle on public.sessions;
create trigger trg_guard_sessions_lifecycle
  before update on public.sessions
  for each row execute function public.guard_sessions_lifecycle();

drop trigger if exists trg_guard_enrollments_lifecycle on public.enrollments;
create trigger trg_guard_enrollments_lifecycle
  before update on public.enrollments
  for each row execute function public.guard_enrollments_lifecycle();

drop trigger if exists trg_guard_teacher_subscriptions_lifecycle on public.teacher_subscriptions;
create trigger trg_guard_teacher_subscriptions_lifecycle
  before update on public.teacher_subscriptions
  for each row execute function public.guard_teacher_subscriptions_lifecycle();

notify pgrst, 'reload schema';
