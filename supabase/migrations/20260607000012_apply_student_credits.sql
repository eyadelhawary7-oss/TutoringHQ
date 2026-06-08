CREATE OR REPLACE FUNCTION public.apply_student_credits(p_student_id uuid, p_teacher_id uuid, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(credits_applied integer, amount_applied numeric)
 LANGUAGE plpgsql
AS $function$
declare
  v_outstanding numeric;
  v_oldest_txn  uuid;
  v_credit      record;
  v_count       int := 0;
  v_applied     numeric := 0;
begin
  -- Outstanding = sum of this student's pending lesson bills for this teacher.
  select coalesce(sum(t.amount_billed), 0) into v_outstanding
  from public.transactions t
  where t.student_id = p_student_id
    and t.teacher_id = p_teacher_id
    and t.kind = 'lesson'
    and t.status = 'pending';

  if v_outstanding <= 0 then
    return query select 0, 0::numeric;
    return;
  end if;

  -- Oldest open pending lesson txn, for applied_to_transaction_id traceability.
  select t.id into v_oldest_txn
  from public.transactions t
  where t.student_id = p_student_id
    and t.teacher_id = p_teacher_id
    and t.kind = 'lesson'
    and t.status = 'pending'
  order by t.created_at asc
  limit 1;

  -- Walk active credits oldest-first, lock them.
  for v_credit in
    select sc.id, sc.amount
    from public.student_credits sc
    where sc.student_id = p_student_id
      and sc.teacher_id = p_teacher_id
      and sc.status = 'active'
    order by sc.created_at asc
    for update
  loop
    -- Model X: apply a credit only if it fits whole within remaining outstanding.
    if v_credit.amount <= v_outstanding then
      update public.student_credits
      set status = 'applied',
          applied_to_transaction_id = v_oldest_txn
      where id = v_credit.id;

      v_outstanding := v_outstanding - v_credit.amount;
      v_applied := v_applied + v_credit.amount;
      v_count := v_count + 1;

      if v_outstanding <= 0 then
        exit;
      end if;
    end if;
    -- Overflowing credit is left active (carried forward whole).
  end loop;

  if v_count > 0 then
    insert into public.audit_log (action, entity_type, entity_id, user_id, details)
    values (
      'credits_applied', 'student', p_student_id, p_actor_id,
      jsonb_build_object('teacher_id', p_teacher_id, 'credits_applied', v_count,
                         'amount_applied', v_applied, 'applied_to_transaction_id', v_oldest_txn)
    );
  end if;

  return query select v_count, v_applied;
end;
$function$
;
revoke execute on function public.apply_student_credits(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.apply_student_credits(uuid,uuid,uuid) to service_role;
notify pgrst, 'reload schema';
