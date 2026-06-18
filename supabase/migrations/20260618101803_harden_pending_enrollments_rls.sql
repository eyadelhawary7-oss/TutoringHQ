-- Harden RLS on pending_enrollments (child-safety / PDPL sensitive: student_name,
-- student_phone, parent_phone, including minors).
--
-- Investigation (2026-06-18): every read and write of this table happens server-side
-- through the Supabase service-role client, which bypasses RLS:
--   * INSERT  src/app/api/join/[center_code]/[group_id]/route.ts  (public join form -> service role)
--   * INSERT  src/app/api/join/pending-enrollment/route.ts         (public join form -> service role)
--   * SELECT  src/app/api/students/pending/route.ts                (authenticated staff -> service role, scoped by center_id)
--   * UPDATE  src/app/api/students/pending/[id]/reject/route.ts    (owner/admin -> service role, scoped by center_id)
--   * SELECT  src/lib/googleDriveBackup.ts                         (cron backup -> service role)
-- No browser/anon or browser/authenticated client ever touches this table directly.
--
-- (1) Remove "Allow public inserts on pending_enrollments" (role public, WITH CHECK true):
--     it let any anonymous visitor on the anon key insert arbitrary personal data. The
--     legitimate public enrollment form posts to the API routes above, which write via the
--     service role, so closing this policy does not affect the app and shuts anonymous writes.
-- (2) Remove the broken "Allow center staff to view pending_enrollments"
--     (USING center_id = auth.uid()): center_id is a center id, never a user id, so it never
--     matched and granted no real client read access. Reads are service-role-only and stay
--     that way; we deliberately do NOT add a client SELECT policy.
--
-- Result: RLS stays enabled with zero policies => deny-all to anon/authenticated, full access
-- only via the service role (same posture as enrollment_otps, pin_setup_tokens, etc.).

DROP POLICY IF EXISTS "Allow public inserts on pending_enrollments" ON public.pending_enrollments;
DROP POLICY IF EXISTS "Allow center staff to view pending_enrollments" ON public.pending_enrollments;

COMMENT ON TABLE public.pending_enrollments IS
  'Personal data (incl. minors): student_name/student_phone/parent_phone. RLS enabled, no policies: deny-all to anon/authenticated. All access is server-side via the service role (public join API routes for INSERT; authenticated staff API routes for SELECT/UPDATE, scoped by center_id).';
