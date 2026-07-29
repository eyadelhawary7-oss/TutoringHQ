-- S1/S2 · public.users: stop a user writing the columns that decide which
-- tenant they are, and what they may do.
--
-- Approved by Eyad, 29 July 2026. See design/BUILD-AFTER-REDESIGN.md §0 S1/S2.
--
-- MANUAL APPLY TO PRODUCTION. Branching auto-applies to preview branches only,
-- never to production on merge. Apply by hand, run the verification block at the
-- bottom, and only then let anything deploy.
--
-- ── THE HOLE ────────────────────────────────────────────────────────────────
-- `students` SELECT carries two PERMISSIVE policies, so they OR. The second,
-- `students_teacher_select`, has no center_id check of its own:
--
--   EXISTS (SELECT 1 FROM enrollments e
--            WHERE e.student_id = students.id
--              AND e.group_id = ANY (get_auth_teacher_group_ids()))
--
-- `get_auth_teacher_group_ids()` reads `users.teacher_group_ids`, which
-- `authenticated` could write on its own row: the RLS UPDATE policy allows it
-- (`id = auth.uid()`, center_id unchanged) and chq_prevent_user_escalation
-- guarded only `role` and `center_id`. The group UUID needed is published by
-- design in join links (GroupJoinLinkCard.tsx). So any authenticated user of any
-- centre could read another centre's students — names, phones, parent phones.
--
-- Three more columns had the same shape without crossing tenants:
-- can_manage_students, can_record_payments (self-granted permissions) and
-- is_active (a deactivated account re-enabling itself).
--
-- ── WHAT THIS DOES NOT DO ───────────────────────────────────────────────────
-- It does NOT add `AND center_id = get_auth_center_id()` to
-- students_teacher_select. That was suggested and then withdrawn: the policy
-- exists so a teacher can reach students in groups they teach at a centre they
-- do NOT belong to (Model B — teachers span centres). `users.center_id` is
-- nullable and every teacher in production currently has it NULL, so the clause
-- would evaluate NULL = NULL and deny every teacher every student. The column
-- feeding the policy was the problem, not the policy.

-- ── 1. The door ─────────────────────────────────────────────────────────────
-- Table-level, because a column-level revoke does nothing while a table-level
-- grant stands: in PostgreSQL the table privilege authorises every column, so
-- `REVOKE UPDATE (col) ...` would run clean and change nothing.
--
-- No re-grant. Every writer of public.users is a server route on the
-- service-role client — /api/user/locale, /api/auth/set-initial-pin,
-- /api/auth/verify-pin-reset, /api/auth/change-pin,
-- /api/teacher/settings/change-pin, /api/settings/staff/[userId]/permissions,
-- /api/permissions — plus centerOwnerProvision, which is an INSERT.
-- service_role holds its own grants and bypasses RLS, so none of them is
-- affected. There is no browser-side write to users anywhere in the codebase.
REVOKE UPDATE ON public.users FROM authenticated, anon;

-- Belt and braces: column-level grants are tracked separately from the
-- table-level one, so revoke those explicitly too rather than depending on
-- which of the two forms cascades. A revoke of a privilege that was never
-- granted is a no-op, not an error.
REVOKE UPDATE (teacher_group_ids, can_manage_students, can_record_payments, is_active, role, center_id)
  ON public.users FROM authenticated, anon;

-- ── 2. The backstop ─────────────────────────────────────────────────────────
-- The grant above is the real control. This trigger is what survives someone
-- reopening it later with a blanket `GRANT UPDATE ON users TO authenticated`.
-- It fires only when NEW.id = auth.uid(), so it constrains SELF-edits only:
-- service-role calls carry no JWT, auth.uid() is NULL, `NEW.id = NULL` is NULL,
-- and the branch never raises. That is already proven in production by the
-- existing role and center_id branches, which do not break /api/permissions.
CREATE OR REPLACE FUNCTION public.chq_prevent_user_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.id = auth.uid() THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'users: cannot modify own role';
    END IF;
    IF NEW.center_id IS DISTINCT FROM OLD.center_id THEN
      RAISE EXCEPTION 'users: cannot modify own center_id';
    END IF;
    IF NEW.teacher_group_ids IS DISTINCT FROM OLD.teacher_group_ids THEN
      RAISE EXCEPTION 'users: cannot modify own teacher_group_ids';
    END IF;
    IF NEW.can_manage_students IS DISTINCT FROM OLD.can_manage_students THEN
      RAISE EXCEPTION 'users: cannot modify own can_manage_students';
    END IF;
    IF NEW.can_record_payments IS DISTINCT FROM OLD.can_record_payments THEN
      RAISE EXCEPTION 'users: cannot modify own can_record_payments';
    END IF;
    IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      RAISE EXCEPTION 'users: cannot modify own is_active';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- The trigger itself is unchanged (BEFORE UPDATE ON public.users FOR EACH ROW);
-- CREATE OR REPLACE FUNCTION re-points it without touching the definition.

-- ── 3. Prove it ─────────────────────────────────────────────────────────────
-- A migration that runs clean and changes nothing is the failure mode this
-- whole exercise started from. This one refuses to be one: if the privilege
-- survives, apply fails loudly instead of recording a fix that never happened.
DO $$
BEGIN
  IF has_column_privilege('authenticated', 'public.users', 'teacher_group_ids', 'UPDATE') THEN
    RAISE EXCEPTION
      'S1 FAILED: authenticated still holds UPDATE on users.teacher_group_ids — the revoke did not take';
  END IF;
  IF has_column_privilege('anon', 'public.users', 'teacher_group_ids', 'UPDATE') THEN
    RAISE EXCEPTION
      'S1 FAILED: anon still holds UPDATE on users.teacher_group_ids — the revoke did not take';
  END IF;
  IF NOT has_column_privilege('service_role', 'public.users', 'teacher_group_ids', 'UPDATE') THEN
    RAISE EXCEPTION
      'S1 FAILED: service_role lost UPDATE on users.teacher_group_ids — every server write path is now broken';
  END IF;
  RAISE NOTICE 'S1 OK: authenticated and anon cannot write users.teacher_group_ids; service_role still can.';
END $$;
