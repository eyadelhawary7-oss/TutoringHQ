ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS is_guest boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_students_is_guest
  ON public.students(is_guest) WHERE is_guest = true;

NOTIFY pgrst, 'reload schema';
