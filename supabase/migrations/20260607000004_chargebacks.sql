create table if not exists public.chargebacks (
  id             uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete restrict,
  center_id      uuid references public.centers(id) on delete set null,
  teacher_id     uuid references public.teacher_profiles(user_id) on delete set null,
  amount         numeric not null default 0,
  reason         text,
  status         text not null default 'opened',
  gateway_ref    text,
  opened_at      timestamptz not null default now(),
  resolved_at    timestamptz,
  reconciled     boolean not null default false,
  reconciled_at  timestamptz,
  is_test        boolean not null default false,
  details        jsonb not null default '{}'::jsonb,
  created_by     uuid references public.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  constraint chargebacks_status_chk        check (status in ('opened','won','lost')),
  constraint chargebacks_amount_nonneg_chk check (amount >= 0)
);

create unique index if not exists chargebacks_gateway_ref_key
  on public.chargebacks (gateway_ref) where gateway_ref is not null;
create index if not exists chargebacks_transaction_id_idx on public.chargebacks (transaction_id);
create index if not exists chargebacks_center_id_idx      on public.chargebacks (center_id);
create index if not exists chargebacks_status_idx         on public.chargebacks (status);

alter table public.chargebacks enable row level security;

create or replace function public.apply_chargeback_transition(
  p_chargeback_id uuid,
  p_new_status    text,
  p_actor_id      uuid default null
)
returns public.chargebacks
language plpgsql
as $$
declare
  v_cb         public.chargebacks;
  v_old_status text;
begin
  select * into v_cb from public.chargebacks where id = p_chargeback_id for update;
  if not found then
    raise exception 'chargeback % not found', p_chargeback_id using errcode = 'P0002';
  end if;

  v_old_status := v_cb.status;

  if p_new_status not in ('opened','won','lost') then
    raise exception 'invalid chargeback status %', p_new_status using errcode = '23514';
  end if;

  if v_old_status = p_new_status then
    return v_cb;
  end if;

  if not (v_old_status = 'opened' and p_new_status in ('won','lost')) then
    raise exception 'illegal chargeback transition: % -> %', v_old_status, p_new_status
      using errcode = '23514';
  end if;

  update public.chargebacks
     set status      = p_new_status,
         resolved_at = now()
   where id = p_chargeback_id
   returning * into v_cb;

  insert into public.audit_log (action, entity_type, entity_id, user_id, center_id, details)
  values (
    'chargeback_transition',
    'chargeback',
    v_cb.id,
    p_actor_id,
    v_cb.center_id,
    jsonb_build_object('from', v_old_status, 'to', p_new_status, 'transaction_id', v_cb.transaction_id)
  );

  return v_cb;
end;
$$;

revoke execute on function public.apply_chargeback_transition(uuid, text, uuid) from public, anon, authenticated;
grant  execute on function public.apply_chargeback_transition(uuid, text, uuid) to service_role;

notify pgrst, 'reload schema';
