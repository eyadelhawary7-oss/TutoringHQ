-- ============================================================================
-- Summer-2026 promo + automatic free-period billing
-- ----------------------------------------------------------------------------
-- Extends the existing promo / trial / billing systems; does NOT stand up parallel
-- ones. Two parts, both additive and reversible:
--
--   (1) Six admin-editable controls seeded into the key-value platform_config
--       store (never columns). These drive the automatic summer mode end-to-end:
--         summer.promo.enabled        bool  master kill switch (default OFF)
--         summer.free_until           text  SUMMER_FREE_UNTIL   (Aug 16 2026)
--         summer.first_charge_floor   text  FIRST_CHARGE_FLOOR  (Aug 30 2026)
--         summer.trial_days           text  TRIAL_DAYS          (14)
--         summer.pay_window_days      text  PAY_WINDOW_DAYS     (2)
--         summer.first_charge_release text  HELD | RELEASED     (default HELD)
--       Defaults are OFF/HELD so nothing fires until an operator turns it on and,
--       separately, releases the first charge after a live test payment.
--
--   (2) Per-customer summer schedule columns on `centers` and
--       `teacher_subscriptions`. The Aug-16 daily pass stamps the trial schedule
--       (computed in Africa/Cairo); the Aug-30+ daily pass issues the first invoice
--       and links it. No enum types (text + CHECK only); all dates are Cairo
--       calendar dates; lock instant is timestamptz.
--
-- ROLLBACK:
--   ALTER TABLE public.centers DROP COLUMN summer_trial_start, ... (all 6);
--   ALTER TABLE public.teacher_subscriptions DROP COLUMN summer_trial_start, ...;
--   DELETE FROM public.platform_config WHERE key LIKE 'summer.%';
-- ============================================================================

-- (1) ── Seed the six controls (idempotent; never overwrite an operator's edit) ──
INSERT INTO public.platform_config (key, value)
VALUES
  ('summer.promo.enabled',        'false'::jsonb),
  ('summer.free_until',           '"2026-08-16"'::jsonb),
  ('summer.first_charge_floor',   '"2026-08-30"'::jsonb),
  ('summer.trial_days',           '14'::jsonb),
  ('summer.pay_window_days',      '2'::jsonb),
  ('summer.first_charge_release', '"HELD"'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- (2) ── Per-customer summer schedule on centers ──
ALTER TABLE public.centers
  ADD COLUMN IF NOT EXISTS summer_trial_start      date,
  ADD COLUMN IF NOT EXISTS summer_first_invoice_at date,
  ADD COLUMN IF NOT EXISTS summer_lock_at          timestamptz,
  ADD COLUMN IF NOT EXISTS summer_enrolled_at      timestamptz,
  ADD COLUMN IF NOT EXISTS summer_first_invoice_id uuid,
  ADD COLUMN IF NOT EXISTS summer_status           text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'centers_summer_status_check'
  ) THEN
    ALTER TABLE public.centers
      ADD CONSTRAINT centers_summer_status_check
      CHECK (summer_status IS NULL OR summer_status IN ('enrolled', 'invoiced', 'paid'));
  END IF;
END $$;

-- (2) ── Per-customer summer schedule on teacher_subscriptions ──
ALTER TABLE public.teacher_subscriptions
  ADD COLUMN IF NOT EXISTS summer_trial_start      date,
  ADD COLUMN IF NOT EXISTS summer_first_invoice_at date,
  ADD COLUMN IF NOT EXISTS summer_lock_at          timestamptz,
  ADD COLUMN IF NOT EXISTS summer_enrolled_at      timestamptz,
  ADD COLUMN IF NOT EXISTS summer_first_invoice_id uuid,
  ADD COLUMN IF NOT EXISTS summer_status           text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'teacher_subscriptions_summer_status_check'
  ) THEN
    ALTER TABLE public.teacher_subscriptions
      ADD CONSTRAINT teacher_subscriptions_summer_status_check
      CHECK (summer_status IS NULL OR summer_status IN ('enrolled', 'invoiced', 'paid'));
  END IF;
END $$;

-- Partial indexes for the daily passes: "who is enrolled and due an invoice?"
CREATE INDEX IF NOT EXISTS idx_centers_summer_due
  ON public.centers (summer_first_invoice_at)
  WHERE summer_status = 'enrolled';

CREATE INDEX IF NOT EXISTS idx_teacher_subscriptions_summer_due
  ON public.teacher_subscriptions (summer_first_invoice_at)
  WHERE summer_status = 'enrolled';

NOTIFY pgrst, 'reload schema';
