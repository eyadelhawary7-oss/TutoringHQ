ALTER FUNCTION public.update_updated_at_column()
  SET search_path = public;

ALTER FUNCTION public.payments_auto_confirm_cash()
  SET search_path = public;

ALTER FUNCTION public.assign_center_code()
  SET search_path = public;

ALTER FUNCTION public.assign_student_number()
  SET search_path = public;

ALTER FUNCTION public.generate_referral_code_8char()
  SET search_path = public;

ALTER FUNCTION public.create_referral_reward()
  SET search_path = public;

ALTER FUNCTION public.compute_student_count_tier()
  SET search_path = public;
