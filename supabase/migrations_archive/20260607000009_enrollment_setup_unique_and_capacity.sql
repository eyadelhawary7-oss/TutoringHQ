-- Relax enrollments uniqueness to one LIVE enrollment per (group, student);
-- add capacity_cap to student_groups. Captured from live prod (repo sync; already applied).

begin;

alter table public.enrollments
  drop constraint if exists enrollments_unique;

create unique index if not exists enrollments_one_live_uq
  on public.enrollments using btree (group_id, student_id)
  where (status = any (array['pending'::text, 'active'::text]));

alter table public.student_groups
  add column if not exists capacity_cap integer;

alter table public.student_groups
  drop constraint if exists student_groups_capacity_cap_chk;

alter table public.student_groups
  add constraint student_groups_capacity_cap_chk
  check (capacity_cap is null or capacity_cap > 0);

commit;

notify pgrst, 'reload schema';
