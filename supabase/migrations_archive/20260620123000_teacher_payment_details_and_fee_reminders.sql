-- Section D: teacher payment details (parent pays the teacher directly; the
-- platform only relays the details), fee-reminder cadence tracking, and the new
-- parent-facing Utility template.

-- 1) Teacher payment details on teacher_profiles. Any/all of the three handles;
-- accepted_methods is the toggle set; default_method leads the reminder copy.
ALTER TABLE public.teacher_profiles
  ADD COLUMN IF NOT EXISTS instapay_address text,
  ADD COLUMN IF NOT EXISTS wallet_phone text,
  ADD COLUMN IF NOT EXISTS payment_phone text,
  ADD COLUMN IF NOT EXISTS accepted_methods text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS default_payment_method text,
  ADD COLUMN IF NOT EXISTS payment_details_updated_at timestamptz;

ALTER TABLE public.teacher_profiles
  DROP CONSTRAINT IF EXISTS teacher_profiles_default_payment_method_chk;
ALTER TABLE public.teacher_profiles
  ADD CONSTRAINT teacher_profiles_default_payment_method_chk
  CHECK (default_payment_method IS NULL
         OR default_payment_method = ANY (ARRAY['cash','instapay','vodafone_cash','other']));

-- 2) Fee-reminder cadence tracking on the charge itself. One reminder at 24h,
-- one more after a few days, then stop (count caps the cadence). Marking the
-- charge paid is what stops it (status leaves 'pending'); no flag to reset.
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS fee_reminder_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_reminder_last_at timestamptz;

ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_fee_reminder_count_chk;
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_fee_reminder_count_chk CHECK (fee_reminder_count >= 0);

-- 3) The unpaid session-fee reminder template (no payment link — the teacher's
-- own details are inlined). Utility category, Meta approval pending. The absence
-- notification reuses the existing chq_parent_absence template.
-- Variables: {{1}} student name, {{2}} session fee, {{3}} payment details,
-- {{4}} next class date.
INSERT INTO public.wa_meta_templates (template_name, category, status, variables_count)
VALUES ('chq_fee_reminder', 'UTILITY', 'PENDING', 4)
ON CONFLICT (template_name) DO UPDATE SET
  category = EXCLUDED.category,
  variables_count = EXCLUDED.variables_count,
  status = CASE WHEN wa_meta_templates.status = 'APPROVED'
                THEN wa_meta_templates.status ELSE EXCLUDED.status END,
  updated_at = now();

NOTIFY pgrst, 'reload schema';
