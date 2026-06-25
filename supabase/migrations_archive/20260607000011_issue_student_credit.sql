-- issue_student_credit: create an active student credit with validation + audit.
-- Captured verbatim from live prod via pg_get_functiondef (repo sync; already applied).

CREATE OR REPLACE FUNCTION public.issue_student_credit(p_student_id uuid, p_teacher_id uuid, p_amount numeric, p_reason text DEFAULT NULL::text, p_source_transaction_id uuid DEFAULT NULL::uuid, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
declare
  v_id uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'credit amount must be > 0, got %', p_amount using errcode = '23514';
  end if;
  if not exists (select 1 from public.students st where st.id = p_student_id) then
    raise exception 'student % not found', p_student_id using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.teacher_profiles tp where tp.user_id = p_teacher_id) then
    raise exception 'teacher % not found', p_teacher_id using errcode = 'P0002';
  end if;
  if p_source_transaction_id is not null
     and not exists (select 1 from public.transactions t where t.id = p_source_transaction_id) then
    raise exception 'source transaction % not found', p_source_transaction_id using errcode = 'P0002';
  end if;

  insert into public.student_credits
    (student_id, teacher_id, amount, reason, source_transaction_id, status, created_by)
  values
    (p_student_id, p_teacher_id, round(p_amount, 2), p_reason, p_source_transaction_id, 'active', p_actor_id)
  returning id into v_id;

  insert into public.audit_log (action, entity_type, entity_id, user_id, details)
  values (
    'credit_issued', 'student_credit', v_id, p_actor_id,
    jsonb_build_object('student_id', p_student_id, 'teacher_id', p_teacher_id,
                       'amount', round(p_amount,2), 'reason', p_reason,
                       'source_transaction_id', p_source_transaction_id)
  );

  return v_id;
end;
$function$;

revoke execute on function public.issue_student_credit(uuid, uuid, numeric, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.issue_student_credit(uuid, uuid, numeric, text, uuid, uuid) to service_role;

notify pgrst, 'reload schema';
