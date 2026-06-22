-- Security hardening (Step C): make the AR reporting views run with invoker privileges.
--
-- ar_by_student and ar_by_teacher were SECURITY DEFINER views, so any role with SELECT on
-- them read across all centers/teachers, bypassing RLS on transactions / student_credits.
-- All application reads go through the service-role client (src/lib/teacherAnalytics.ts and
-- src/app/api/teacher/private/income/route.ts), which has BYPASSRLS, so results are unchanged;
-- security_invoker simply removes the ability for a signed-in user to read other teachers' AR
-- by selecting the view directly. View definitions are untouched.

ALTER VIEW public.ar_by_student SET (security_invoker = true);
ALTER VIEW public.ar_by_teacher SET (security_invoker = true);

NOTIFY pgrst, 'reload schema';
