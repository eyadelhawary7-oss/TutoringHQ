create or replace function public.apply_transaction_transition(
  p_transaction_id uuid,
  p_new_status     text,
  p_actor_id       uuid default null
)
returns public.transactions
language plpgsql
as $$
declare
  v_txn        public.transactions;
  v_old_status text;
begin
  select * into v_txn from public.transactions where id = p_transaction_id for update;
  if not found then
    raise exception 'transaction % not found', p_transaction_id using errcode = 'P0002';
  end if;

  v_old_status := v_txn.status;

  if p_new_status not in ('pending','paid','failed','cancelled') then
    raise exception 'invalid transaction status %', p_new_status using errcode = '23514';
  end if;

  if v_old_status = p_new_status then
    return v_txn;
  end if;

  if not (v_old_status = 'pending' and p_new_status in ('paid','failed','cancelled')) then
    raise exception 'illegal transaction transition: % -> %', v_old_status, p_new_status
      using errcode = '23514';
  end if;

  update public.transactions
     set status         = p_new_status,
         paid_at        = case when p_new_status = 'paid' and paid_at is null
                               then now() else paid_at end,
         marked_paid_by = case when p_new_status = 'paid'
                               then coalesce(p_actor_id, marked_paid_by) else marked_paid_by end
   where id = p_transaction_id
   returning * into v_txn;

  insert into public.audit_log (action, entity_type, entity_id, user_id, center_id, details)
  values (
    'transaction_transition',
    'transaction',
    v_txn.id,
    p_actor_id,
    v_txn.center_id,
    jsonb_build_object('from', v_old_status, 'to', p_new_status, 'is_test', v_txn.is_test)
  );

  return v_txn;
end;
$$;

revoke execute on function public.apply_transaction_transition(uuid, text, uuid) from public, anon, authenticated;
grant  execute on function public.apply_transaction_transition(uuid, text, uuid) to service_role;

notify pgrst, 'reload schema';
