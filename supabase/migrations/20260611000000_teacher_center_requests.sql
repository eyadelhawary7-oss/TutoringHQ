-- Teacher-initiated center join requests
-- A teacher can request to join a center by center_code.
-- On accept, a teacher_center membership row is created.

-- Generic updated_at trigger function. The repo historically used per-table
-- trigger functions (set_demo_requests_updated_at, set_center_notes_updated_at)
-- and never defined a shared public.set_updated_at(). Create it idempotently so
-- this table (and future ones) can reuse a single canonical function.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE public.teacher_center_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  center_id uuid NOT NULL REFERENCES public.centers(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn')),
  message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  responded_by uuid REFERENCES auth.users(id)
);

-- One active (pending) request per teacher per center
CREATE UNIQUE INDEX teacher_center_requests_pending_unique
  ON public.teacher_center_requests(teacher_id, center_id)
  WHERE status = 'pending';

-- Index for center owner queries (list incoming requests)
CREATE INDEX teacher_center_requests_center_idx
  ON public.teacher_center_requests(center_id, status, created_at DESC);

-- Index for teacher queries (list own requests)
CREATE INDEX teacher_center_requests_teacher_idx
  ON public.teacher_center_requests(teacher_id, status);

-- Updated_at trigger
CREATE TRIGGER trg_teacher_center_requests_updated_at
  BEFORE UPDATE ON public.teacher_center_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS: teachers can only see and manage their own requests
ALTER TABLE public.teacher_center_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "teacher_center_requests_teacher_select"
  ON public.teacher_center_requests FOR SELECT
  USING (teacher_id = auth.uid());

CREATE POLICY "teacher_center_requests_teacher_insert"
  ON public.teacher_center_requests FOR INSERT
  WITH CHECK (teacher_id = auth.uid());

-- Center owners can see requests for their center (via service role in API routes)
-- No direct RLS for center owners -- API routes use service role client.

NOTIFY pgrst, 'reload schema';
