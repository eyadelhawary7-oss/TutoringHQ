-- Phase 2: group recurring schedule + one-time exceptions
-- All writes go through service-role API routes only.
-- RLS allows authenticated reads scoped to own groups only.

CREATE TABLE IF NOT EXISTS public.group_schedule (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id         uuid        NOT NULL REFERENCES public.student_groups(id) ON DELETE CASCADE,
  day_of_week      smallint    NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  time_start       time        NOT NULL,
  duration_minutes smallint    NOT NULL CHECK (duration_minutes > 0),
  created_at       timestamptz DEFAULT now(),
  UNIQUE (group_id, day_of_week, time_start)
);

CREATE INDEX IF NOT EXISTS idx_group_schedule_group
  ON public.group_schedule(group_id);

ALTER TABLE public.group_schedule ENABLE ROW LEVEL SECURITY;

CREATE POLICY "teacher reads own group schedule"
  ON public.group_schedule FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.student_groups sg
      WHERE sg.id = group_schedule.group_id
        AND sg.teacher_id = auth.uid()
    )
  );

REVOKE INSERT, UPDATE, DELETE
  ON public.group_schedule FROM authenticated, anon;

CREATE TABLE IF NOT EXISTS public.schedule_exceptions (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id             uuid        NOT NULL REFERENCES public.student_groups(id) ON DELETE CASCADE,
  schedule_id          uuid        NOT NULL REFERENCES public.group_schedule(id) ON DELETE CASCADE,
  exception_date       date        NOT NULL,
  kind                 text        NOT NULL CHECK (kind IN ('cancelled','rescheduled')),
  new_date             date,
  new_time_start       time,
  new_duration_minutes smallint    CHECK (new_duration_minutes > 0),
  note                 text,
  created_at           timestamptz DEFAULT now(),
  UNIQUE (group_id, schedule_id, exception_date)
);

CREATE INDEX IF NOT EXISTS idx_schedule_exceptions_group_date
  ON public.schedule_exceptions(group_id, exception_date);

CREATE INDEX IF NOT EXISTS idx_schedule_exceptions_schedule
  ON public.schedule_exceptions(schedule_id);

ALTER TABLE public.schedule_exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "teacher reads own group exceptions"
  ON public.schedule_exceptions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.student_groups sg
      WHERE sg.id = schedule_exceptions.group_id
        AND sg.teacher_id = auth.uid()
    )
  );

REVOKE INSERT, UPDATE, DELETE
  ON public.schedule_exceptions FROM authenticated, anon;

NOTIFY pgrst, 'reload schema';
