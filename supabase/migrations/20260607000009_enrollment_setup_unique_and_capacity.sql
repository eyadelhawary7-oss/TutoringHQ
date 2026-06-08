begin;
alter table public.enrollments drop constraint enrollments_unique;
create unique index enrollments_one_live_uq on public.enrollments (group_id, student_id)
  where status in ('pending','active');
alter table public.student_groups add column if not exists capacity_cap int;
alter table public.student_groups add constraint student_groups_capacity_cap_chk
  check (capacity_cap is null or capacity_cap > 0);
commit;
notify pgrst, 'reload schema';
