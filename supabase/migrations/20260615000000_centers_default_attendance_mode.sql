-- Center-level default attendance capture mode (scan | checklist).
-- Surfaced in Settings → Capture defaults and used as the default when a new
-- group is created. Per-group student_groups.attendance_mode still overrides
-- this for any individual group.
alter table public.centers
  add column if not exists default_attendance_mode text not null default 'scan';

alter table public.centers
  drop constraint if exists centers_default_attendance_mode_check;

alter table public.centers
  add constraint centers_default_attendance_mode_check
  check (default_attendance_mode in ('scan', 'checklist'));

-- Refresh PostgREST schema cache so the new column is queryable immediately.
notify pgrst, 'reload schema';
