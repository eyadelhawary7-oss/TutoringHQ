-- Pro feature: one editable free-text note per (student, group), owned by the
-- group's teacher. Editable only by that teacher, Pro-gated at the API layer.
--
-- Catalog reality (introspected against prod BEFORE writing -- Rule 146):
--   * A table named public.student_notes ALREADY EXISTS and is an unrelated
--     center-side, one-to-many notes log (student_id, center_id NOT NULL,
--     author_user_id, note, is_private, created_at) from 20260330000000. It is
--     LEFT UNTOUCHED. This feature uses the new table student_group_notes.
--   * The enrollment link table is public.enrollments (student_id, group_id,
--     status). Guest students carry students.is_guest = true.
--   * public.student_groups has teacher_id (uuid) and kind = 'private'. Its
--     teacher RLS policies resolve teacher identity as teacher_id = auth.uid()
--     and gate writes on NOT is_auth_teacher_suspended(). We mirror that exactly.
--   * set_updated_at() trigger fn already exists -- reuse it (no new fn).

CREATE TABLE IF NOT EXISTS public.student_group_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id  uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  group_id    uuid NOT NULL REFERENCES public.student_groups(id) ON DELETE CASCADE,
  -- denormalized owning teacher (from student_groups.teacher_id) so RLS can scope
  -- without a join, mirroring how student_groups carries teacher_id directly.
  teacher_id  uuid NOT NULL,
  note        text NOT NULL DEFAULT '',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT student_group_notes_student_group_uniq UNIQUE (student_id, group_id)
);

-- updated_at maintenance: reuse the existing set_updated_at() trigger fn.
DROP TRIGGER IF EXISTS trg_student_group_notes_updated_at ON public.student_group_notes;
CREATE TRIGGER trg_student_group_notes_updated_at
  BEFORE UPDATE ON public.student_group_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.student_group_notes ENABLE ROW LEVEL SECURITY;

-- Teacher-scoping mirrors public.student_groups teacher policies exactly:
-- identity = teacher_id = auth.uid(); writes additionally blocked while the
-- teacher is suspended (NOT is_auth_teacher_suspended()), as on
-- student_groups_teacher_{insert,update,delete}. Guests are excluded naturally
-- (no enrollment -> the UI never offers a note); no is_guest special-case here.
-- All server writes go through the service role, which bypasses RLS, so these
-- policies are defense-in-depth behind the API's ownership + Pro + enrollment
-- gates.
DROP POLICY IF EXISTS student_group_notes_teacher_select ON public.student_group_notes;
CREATE POLICY student_group_notes_teacher_select
  ON public.student_group_notes FOR SELECT
  USING (teacher_id = auth.uid());

DROP POLICY IF EXISTS student_group_notes_teacher_insert ON public.student_group_notes;
CREATE POLICY student_group_notes_teacher_insert
  ON public.student_group_notes FOR INSERT
  WITH CHECK (teacher_id = auth.uid() AND NOT is_auth_teacher_suspended());

DROP POLICY IF EXISTS student_group_notes_teacher_update ON public.student_group_notes;
CREATE POLICY student_group_notes_teacher_update
  ON public.student_group_notes FOR UPDATE
  USING (teacher_id = auth.uid() AND NOT is_auth_teacher_suspended())
  WITH CHECK (teacher_id = auth.uid() AND NOT is_auth_teacher_suspended());

DROP POLICY IF EXISTS student_group_notes_teacher_delete ON public.student_group_notes;
CREATE POLICY student_group_notes_teacher_delete
  ON public.student_group_notes FOR DELETE
  USING (teacher_id = auth.uid() AND NOT is_auth_teacher_suspended());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_group_notes TO authenticated;

NOTIFY pgrst, 'reload schema';
