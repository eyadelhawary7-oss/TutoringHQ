-- Add ناشئ (nano) pricing tier
-- Run in Supabase SQL Editor if nano does not exist: SELECT id FROM pricing_plans WHERE id = 'nano'

INSERT INTO public.pricing_plans (id, name_en, name_ar, students_per_week_limit, monthly_fee, per_student_at_capacity_egp, setup_fee_egp, is_custom, sort_order, team_members_limit)
VALUES ('nano', 'Nano', 'ناشئ', 75, 1200, 3.69, 500, false, 0, 2)
ON CONFLICT (id) DO UPDATE SET
  name_en = EXCLUDED.name_en,
  name_ar = EXCLUDED.name_ar,
  students_per_week_limit = EXCLUDED.students_per_week_limit,
  monthly_fee = EXCLUDED.monthly_fee,
  per_student_at_capacity_egp = EXCLUDED.per_student_at_capacity_egp,
  setup_fee_egp = EXCLUDED.setup_fee_egp,
  is_custom = EXCLUDED.is_custom,
  sort_order = EXCLUDED.sort_order,
  team_members_limit = EXCLUDED.team_members_limit;
