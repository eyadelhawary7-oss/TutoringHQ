-- Allow method NULL while a lesson charge is pending (method unknown until parent pays).
-- Require a real method once status leaves pending.

begin;

alter table public.transactions
  alter column method drop not null;

alter table public.transactions
  drop constraint transactions_method_chk;

alter table public.transactions
  add constraint transactions_method_chk check (
    (status = 'pending' and (method is null or method = any (array['card','wallet','apple_pay','google_pay','instapay','cash'])))
    or
    (status <> 'pending' and method = any (array['card','wallet','apple_pay','google_pay','instapay','cash']))
  );

commit;

notify pgrst, 'reload schema';
