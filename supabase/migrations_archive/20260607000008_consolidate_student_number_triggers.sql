-- Consolidate competing student_number triggers to one canonical assign path.
-- assign_student_number skips cleanly for center-less (private) students.
-- Captured from live prod via pg_get_functiondef (repo sync; already applied).

begin;

drop trigger if exists trg_assign_student_number on public.students;
drop trigger if exists set_student_number on public.students;
drop trigger if exists auto_assign_student_number on public.students;
drop function if exists public.generate_student_number();

CREATE OR REPLACE FUNCTION public.assign_student_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_center_code text;
  v_next_seq    integer;
begin
  if new.student_number is not null then
    return new;
  end if;

  -- Private (center-less) student: no center-scoped number. Leave null.
  if new.center_id is null then
    return new;
  end if;

  select student_sequence, center_code
  into   v_next_seq, v_center_code
  from   centers
  where  id = new.center_id
  for update;

  if v_center_code is null then
    raise exception 'assign_student_number: no center found for id %', new.center_id;
  end if;

  new.student_number := '#' || v_center_code || '-' || lpad(v_next_seq::text, 4, '0');

  update centers
  set    student_sequence = student_sequence + 1
  where  id = new.center_id;

  return new;
end;
$function$;

create trigger auto_assign_student_number
  before insert on public.students
  for each row
  when (new.student_number is null)
  execute function public.assign_student_number();

commit;

notify pgrst, 'reload schema';
