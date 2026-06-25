-- apply_transaction_transition: additive 4th param p_method text DEFAULT NULL.
-- Already applied to prod on 2026-06-10 (catalog-verified); this file keeps the
-- repo in sync. Behaviour:
--   * p_method must be one of card/wallet/apple_pay/google_pay/instapay/cash,
--     else 23514 'invalid payment method'.
--   * A row's method is never overwritten: if method is already set and
--     p_method differs -> 23514 'method already set'.
--   * pending->paid with no resulting method -> 23514 'method required when
--     marking paid' (transactions_method_chk requires method on non-pending).
--   * Same-status call remains a no-op returning the row.
--   * audit_log details now include 'method'.
-- Body below is verbatim from pg_get_functiondef on prod.

CREATE OR REPLACE FUNCTION public.apply_transaction_transition(p_transaction_id uuid, p_new_status text, p_actor_id uuid DEFAULT NULL::uuid, p_method text DEFAULT NULL::text)
 RETURNS transactions
 LANGUAGE plpgsql
AS $function$
declare v_txn public.transactions; v_old_status text; v_method text;
begin
  select * into v_txn from public.transactions where id=p_transaction_id for update;
  if not found then raise exception 'transaction % not found', p_transaction_id using errcode='P0002'; end if;
  v_old_status:=v_txn.status;
  if p_new_status not in ('pending','paid','failed','cancelled') then raise exception 'invalid transaction status %', p_new_status using errcode='23514'; end if;
  if p_method is not null and p_method not in ('card','wallet','apple_pay','google_pay','instapay','cash') then
    raise exception 'invalid payment method %', p_method using errcode='23514'; end if;
  if v_txn.method is not null and p_method is not null and p_method <> v_txn.method then
    raise exception 'method already set to % and cannot be changed', v_txn.method using errcode='23514'; end if;
  if v_old_status=p_new_status then return v_txn; end if;
  if not (v_old_status='pending' and p_new_status in ('paid','failed','cancelled')) then
    raise exception 'illegal transaction transition: % -> %', v_old_status, p_new_status using errcode='23514'; end if;
  v_method := coalesce(v_txn.method, p_method);
  if p_new_status='paid' and v_method is null then
    raise exception 'method required when marking paid' using errcode='23514'; end if;
  set local app.allow_lifecycle_write='on';
  update public.transactions set status=p_new_status,
    method=v_method,
    paid_at=case when p_new_status='paid' and paid_at is null then now() else paid_at end,
    marked_paid_by=case when p_new_status='paid' then coalesce(p_actor_id,marked_paid_by) else marked_paid_by end
   where id=p_transaction_id returning * into v_txn;
  set local app.allow_lifecycle_write='off';
  insert into public.audit_log (action,entity_type,entity_id,user_id,center_id,details)
  values ('transaction_transition','transaction',v_txn.id,p_actor_id,v_txn.center_id,
          jsonb_build_object('from',v_old_status,'to',p_new_status,'is_test',v_txn.is_test,'method',v_method));
  return v_txn;
end; $function$;

DO $$
BEGIN
  RAISE NOTICE 'apply_transaction_transition extended with p_method (cash/instapay manual mark-paid path enabled)';
END $$;
