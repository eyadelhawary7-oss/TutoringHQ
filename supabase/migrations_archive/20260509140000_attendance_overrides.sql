-- Audit trail when operators allow entry without payment from the scanner.

CREATE TABLE IF NOT EXISTS public.attendance_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  override_by_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (char_length(reason) >= 1 AND char_length(reason) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attendance_overrides_student ON public.attendance_overrides(student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_overrides_user ON public.attendance_overrides(override_by_user_id);
CREATE INDEX IF NOT EXISTS idx_attendance_overrides_created ON public.attendance_overrides(created_at DESC);

ALTER TABLE public.attendance_overrides ENABLE ROW LEVEL SECURITY;
