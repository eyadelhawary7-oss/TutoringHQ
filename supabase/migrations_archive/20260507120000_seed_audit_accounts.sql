-- AUDIT TEST DATA — seeds 6 phone+PIN accounts and 2 test centers.
-- Apply manually via `supabase db push --project-ref <ref>` only.
-- Idempotent: safe to re-run; resets PINs and seed data on each run.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Stable refs (seed markers + teardown helpers)
-- Auth / profile IDs
--   aaaaaaaa-1111|2222|3333|4444|5555|6666-...
-- Centers
--   cccccccc-1111-1111-1111-111111111111  realistic (Elite Test)
--   cccccccc-2222-2222-2222-222222222222  minimal

DO $$
DECLARE
  v_instance uuid;
BEGIN
  SELECT instance_id INTO v_instance FROM auth.users WHERE instance_id IS NOT NULL LIMIT 1;
  IF v_instance IS NULL THEN
    RAISE EXCEPTION 'Cannot seed auth.users: no existing auth.users.instance_id (need at least one auth row or create users via Dashboard first).';
  END IF;

  ----------------------------------------------------------------------
  -- 1) Tear down prior seed rows for the two audit centers (FK-safe order)
  ----------------------------------------------------------------------
  DELETE FROM public.attendance_scans
  WHERE center_id IN (
    'cccccccc-1111-1111-1111-111111111111',
    'cccccccc-2222-2222-2222-222222222222'
  );

  DELETE FROM public.invoices
  WHERE center_id IN (
    'cccccccc-1111-1111-1111-111111111111',
    'cccccccc-2222-2222-2222-222222222222'
  );

  DELETE FROM public.center_metrics_daily
  WHERE center_id IN (
    'cccccccc-1111-1111-1111-111111111111',
    'cccccccc-2222-2222-2222-222222222222'
  );

  DELETE FROM public.students
  WHERE center_id IN (
    'cccccccc-1111-1111-1111-111111111111',
    'cccccccc-2222-2222-2222-222222222222'
  );

  ----------------------------------------------------------------------
  -- 2) auth.users — phone emails + bcrypt PIN (re-hash on conflict)
  ----------------------------------------------------------------------
  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  )
  VALUES
    (
      v_instance,
      'aaaaaaaa-1111-1111-1111-111111111111',
      'authenticated',
      'authenticated',
      '201111111111@centerhq.local',
      crypt('111111', gen_salt('bf')),
      now(),
      '{"provider":"phone","providers":["phone"]}'::jsonb,
      '{}'::jsonb,
      now(),
      now()
    ),
    (
      v_instance,
      'aaaaaaaa-2222-2222-2222-222222222222',
      'authenticated',
      'authenticated',
      '201222222222@centerhq.local',
      crypt('222222', gen_salt('bf')),
      now(),
      '{"provider":"phone","providers":["phone"]}'::jsonb,
      '{}'::jsonb,
      now(),
      now()
    ),
    (
      v_instance,
      'aaaaaaaa-3333-3333-3333-333333333333',
      'authenticated',
      'authenticated',
      '201333333333@centerhq.local',
      crypt('333333', gen_salt('bf')),
      now(),
      '{"provider":"phone","providers":["phone"]}'::jsonb,
      '{}'::jsonb,
      now(),
      now()
    ),
    (
      v_instance,
      'aaaaaaaa-4444-4444-4444-444444444444',
      'authenticated',
      'authenticated',
      '201444444444@centerhq.local',
      crypt('444444', gen_salt('bf')),
      now(),
      '{"provider":"phone","providers":["phone"]}'::jsonb,
      '{}'::jsonb,
      now(),
      now()
    ),
    (
      v_instance,
      'aaaaaaaa-5555-5555-5555-555555555555',
      'authenticated',
      'authenticated',
      '201555555555@centerhq.local',
      crypt('555555', gen_salt('bf')),
      now(),
      '{"provider":"phone","providers":["phone"]}'::jsonb,
      '{}'::jsonb,
      now(),
      now()
    ),
    (
      v_instance,
      'aaaaaaaa-6666-6666-6666-666666666666',
      'authenticated',
      'authenticated',
      '201666666666@centerhq.local',
      crypt('666666', gen_salt('bf')),
      now(),
      '{"provider":"phone","providers":["phone"]}'::jsonb,
      '{}'::jsonb,
      now(),
      now()
    )
  ON CONFLICT (id) DO UPDATE SET
    encrypted_password = excluded.encrypted_password,
    email_confirmed_at = excluded.email_confirmed_at,
    raw_app_meta_data = excluded.raw_app_meta_data,
    aud = excluded.aud,
    role = excluded.role,
    updated_at = now();

  ----------------------------------------------------------------------
  -- 3) centers (always set plan; optional plan_key via separate DO block below)
  ----------------------------------------------------------------------
  INSERT INTO public.centers (
    id,
    name,
    plan,
    status,
    created_at,
    governorate,
    billing_type,
    terms_accepted_at,
    terms_version,
    onboarding_completed,
    onboarded
  )
  VALUES
    (
      'cccccccc-1111-1111-1111-111111111111',
      'سنتر النخبة للاختبار',
      'starter',
      'active',
      now() - interval '90 days',
      'cairo',
      'fixed',
      now() - interval '89 days',
      'v1-2026-05',
      true,
      true
    ),
    (
      'cccccccc-2222-2222-2222-222222222222',
      'سنتر بسيط',
      'solo',
      'active',
      now() - interval '5 days',
      'cairo',
      'fixed',
      NULL,
      NULL,
      true,
      true
    )
  ON CONFLICT (id) DO UPDATE SET
    name = excluded.name,
    plan = excluded.plan,
    status = excluded.status,
    created_at = excluded.created_at,
    governorate = excluded.governorate,
    billing_type = excluded.billing_type,
    terms_accepted_at = excluded.terms_accepted_at,
    terms_version = excluded.terms_version,
    onboarding_completed = excluded.onboarding_completed,
    onboarded = excluded.onboarded;

  -- Optional columns present on some deployments (see Adjustment 3)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'centers' AND column_name = 'name_en'
  ) THEN
    UPDATE public.centers SET name_en = 'Elite Test Center'
    WHERE id = 'cccccccc-1111-1111-1111-111111111111';
  END IF;

  ----------------------------------------------------------------------
  -- 4) admin_users (super_admin + admin / internal team)
  ----------------------------------------------------------------------
  INSERT INTO public.admin_users (id, name, email, role, phone, custom_permissions)
  VALUES
    (
      'aaaaaaaa-1111-1111-1111-111111111111',
      'Audit Super Admin',
      '201111111111@centerhq.local',
      'super_admin',
      '+201111111111',
      '[]'::jsonb
    ),
    (
      'aaaaaaaa-2222-2222-2222-222222222222',
      'Audit Internal Admin',
      '201222222222@centerhq.local',
      'admin',
      '+201222222222',
      '[]'::jsonb
    )
  ON CONFLICT (id) DO UPDATE SET
    name = excluded.name,
    email = excluded.email,
    role = excluded.role,
    phone = excluded.phone,
    custom_permissions = excluded.custom_permissions;

  ----------------------------------------------------------------------
  -- 5) public.users — all 6 phones (login API); super_admin rows: center_id NULL
  ----------------------------------------------------------------------
  INSERT INTO public.users (
    id,
    center_id,
    role,
    phone,
    name,
    pin_code,
    preferred_locale,
    can_scan,
    can_view_payments,
    can_record_payments,
    can_view_dashboard,
    can_view_revenue,
    can_manage_students,
    can_manage_groups,
    can_manage_rooms,
    can_view_schedule,
    can_view_settings,
    can_allow_late_entry,
    is_active
  )
  VALUES
    (
      'aaaaaaaa-1111-1111-1111-111111111111',
      NULL,
      'super_admin',
      '+201111111111',
      'Audit Super Admin',
      encode(digest('111111', 'sha256'), 'hex'),
      'ar',
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true
    ),
    (
      'aaaaaaaa-2222-2222-2222-222222222222',
      NULL,
      'super_admin',
      '+201222222222',
      'Audit Internal Admin',
      encode(digest('222222', 'sha256'), 'hex'),
      'ar',
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true
    ),
    (
      'aaaaaaaa-3333-3333-3333-333333333333',
      'cccccccc-1111-1111-1111-111111111111',
      'owner',
      '+201333333333',
      'أحمد المالك',
      encode(digest('333333', 'sha256'), 'hex'),
      'ar',
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true
    ),
    (
      'aaaaaaaa-4444-4444-4444-444444444444',
      'cccccccc-1111-1111-1111-111111111111',
      'assistant',
      '+201444444444',
      'محمد المساعد',
      encode(digest('444444', 'sha256'), 'hex'),
      'ar',
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true
    ),
    (
      'aaaaaaaa-5555-5555-5555-555555555555',
      'cccccccc-2222-2222-2222-222222222222',
      'owner',
      '+201555555555',
      'سعيد البسيط',
      encode(digest('555555', 'sha256'), 'hex'),
      'ar',
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true
    ),
    (
      'aaaaaaaa-6666-6666-6666-666666666666',
      'cccccccc-2222-2222-2222-222222222222',
      'assistant',
      '+201666666666',
      'Test Assistant 2',
      encode(digest('666666', 'sha256'), 'hex'),
      'ar',
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true
    )
  ON CONFLICT (id) DO UPDATE SET
    center_id = excluded.center_id,
    role = excluded.role,
    phone = excluded.phone,
    name = excluded.name,
    pin_code = excluded.pin_code,
    preferred_locale = excluded.preferred_locale,
    can_scan = excluded.can_scan,
    can_view_payments = excluded.can_view_payments,
    can_record_payments = excluded.can_record_payments,
    can_view_dashboard = excluded.can_view_dashboard,
    can_view_revenue = excluded.can_view_revenue,
    can_manage_students = excluded.can_manage_students,
    can_manage_groups = excluded.can_manage_groups,
    can_manage_rooms = excluded.can_manage_rooms,
    can_view_schedule = excluded.can_view_schedule,
    can_view_settings = excluded.can_view_settings,
    can_allow_late_entry = excluded.can_allow_late_entry,
    is_active = excluded.is_active;

  ----------------------------------------------------------------------
  -- 6) students — realistic (50) + minimal (3)
  ----------------------------------------------------------------------
  INSERT INTO public.students (
    id,
    center_id,
    name,
    student_number,
    phone,
    subject,
    payment_status,
    is_active,
    parent_pack_opted_in,
    notes
  )
  SELECT
    uuid_generate_v5('cccccccc-1111-1111-1111-111111111111'::uuid, 'audit-student-' || g::text),
    'cccccccc-1111-1111-1111-111111111111'::uuid,
    'طالب ' || g::text,
    'STU-' || lpad(g::text, 5, '0'),
    NULL,
    (ARRAY[
      'الصف السابع', 'الصف الثامن', 'الصف التاسع', 'الصف العاشر', 'الصف الأول الثانوي', 'الصف الثاني الثانوي'
    ])[((g - 1) % 6) + 1],
    CASE WHEN g % 5 = 0 THEN 'pending' WHEN g % 5 = 1 THEN 'unpaid' ELSE 'paid' END,
    (g <= 45),
    (g <= 30),
    '__audit_seed__'
  FROM generate_series(1, 50) AS g;

  INSERT INTO public.students (
    id,
    center_id,
    name,
    student_number,
    payment_status,
    is_active,
    notes
  )
  VALUES
    (
      uuid_generate_v5('cccccccc-2222-2222-2222-222222222222'::uuid, 'audit-student-1'),
      'cccccccc-2222-2222-2222-222222222222',
      'طالب صغير 1',
      'STU-90001',
      'paid',
      true,
      '__audit_seed__'
    ),
    (
      uuid_generate_v5('cccccccc-2222-2222-2222-222222222222'::uuid, 'audit-student-2'),
      'cccccccc-2222-2222-2222-222222222222',
      'طالب صغير 2',
      'STU-90002',
      'unpaid',
      true,
      '__audit_seed__'
    ),
    (
      uuid_generate_v5('cccccccc-2222-2222-2222-222222222222'::uuid, 'audit-student-3'),
      'cccccccc-2222-2222-2222-222222222222',
      'طالب صغير 3',
      'STU-90003',
      'pending',
      true,
      '__audit_seed__'
    );

  ----------------------------------------------------------------------
  -- 7) invoices — realistic center: 12 (no Paymob / external payment columns)
  --    8 paid subscription, 2 pending subscription, 1 pending signup_first_payment, 1 rejected subscription
  --    minimal center: 1 pending subscription
  ----------------------------------------------------------------------
  INSERT INTO public.invoices (
    id,
    center_id,
    billing_type,
    plan,
    invoice_type,
    period_start,
    period_end,
    subtotal,
    referral_discount,
    total_amount,
    payment_amount,
    status,
    due_date,
    created_at,
    paid_at
  )
  VALUES
    -- Paid subscriptions (8)
    (
      'ffffffff-1111-1111-1111-111111111101',
      'cccccccc-1111-1111-1111-111111111111',
      'fixed',
      'starter',
      'subscription',
      (CURRENT_DATE - 85),
      (CURRENT_DATE - 55),
      4499,
      0,
      4499,
      4499,
      'paid',
      (CURRENT_DATE - 80),
      (CURRENT_DATE - 84)::timestamptz,
      (CURRENT_DATE - 82)::timestamptz
    ),
    (
      'ffffffff-1111-1111-1111-111111111102',
      'cccccccc-1111-1111-1111-111111111111',
      'fixed',
      'starter',
      'subscription',
      (CURRENT_DATE - 75),
      (CURRENT_DATE - 45),
      4499,
      0,
      4499,
      4499,
      'paid',
      (CURRENT_DATE - 70),
      (CURRENT_DATE - 74)::timestamptz,
      (CURRENT_DATE - 72)::timestamptz
    ),
    (
      'ffffffff-1111-1111-1111-111111111103',
      'cccccccc-1111-1111-1111-111111111111',
      'fixed',
      'starter',
      'subscription',
      (CURRENT_DATE - 65),
      (CURRENT_DATE - 35),
      4499,
      0,
      4499,
      4499,
      'paid',
      (CURRENT_DATE - 60),
      (CURRENT_DATE - 64)::timestamptz,
      (CURRENT_DATE - 62)::timestamptz
    ),
    (
      'ffffffff-1111-1111-1111-111111111104',
      'cccccccc-1111-1111-1111-111111111111',
      'fixed',
      'starter',
      'subscription',
      (CURRENT_DATE - 55),
      (CURRENT_DATE - 25),
      4499,
      0,
      4499,
      4499,
      'paid',
      (CURRENT_DATE - 50),
      (CURRENT_DATE - 54)::timestamptz,
      (CURRENT_DATE - 52)::timestamptz
    ),
    (
      'ffffffff-1111-1111-1111-111111111105',
      'cccccccc-1111-1111-1111-111111111111',
      'fixed',
      'starter',
      'subscription',
      (CURRENT_DATE - 45),
      (CURRENT_DATE - 15),
      4499,
      0,
      4499,
      4499,
      'paid',
      (CURRENT_DATE - 40),
      (CURRENT_DATE - 44)::timestamptz,
      (CURRENT_DATE - 42)::timestamptz
    ),
    (
      'ffffffff-1111-1111-1111-111111111106',
      'cccccccc-1111-1111-1111-111111111111',
      'fixed',
      'starter',
      'subscription',
      (CURRENT_DATE - 35),
      (CURRENT_DATE - 5),
      4499,
      0,
      4499,
      4499,
      'paid',
      (CURRENT_DATE - 30),
      (CURRENT_DATE - 34)::timestamptz,
      (CURRENT_DATE - 32)::timestamptz
    ),
    (
      'ffffffff-1111-1111-1111-111111111107',
      'cccccccc-1111-1111-1111-111111111111',
      'fixed',
      'starter',
      'subscription',
      (CURRENT_DATE - 25),
      (CURRENT_DATE + 5),
      4499,
      0,
      4499,
      4499,
      'paid',
      (CURRENT_DATE - 20),
      (CURRENT_DATE - 24)::timestamptz,
      (CURRENT_DATE - 22)::timestamptz
    ),
    (
      'ffffffff-1111-1111-1111-111111111108',
      'cccccccc-1111-1111-1111-111111111111',
      'fixed',
      'starter',
      'subscription',
      (CURRENT_DATE - 15),
      (CURRENT_DATE + 15),
      4499,
      0,
      4499,
      4499,
      'paid',
      (CURRENT_DATE - 10),
      (CURRENT_DATE - 14)::timestamptz,
      (CURRENT_DATE - 12)::timestamptz
    ),
    -- Pending subscriptions (2)
    (
      'ffffffff-1111-1111-1111-111111111109',
      'cccccccc-1111-1111-1111-111111111111',
      'fixed',
      'starter',
      'subscription',
      (CURRENT_DATE - 10),
      (CURRENT_DATE + 20),
      4499,
      0,
      4499,
      NULL,
      'pending',
      (CURRENT_DATE + 3),
      (CURRENT_DATE - 8)::timestamptz,
      NULL
    ),
    (
      'ffffffff-1111-1111-1111-111111111110',
      'cccccccc-1111-1111-1111-111111111111',
      'fixed',
      'starter',
      'subscription',
      (CURRENT_DATE - 5),
      (CURRENT_DATE + 25),
      4499,
      0,
      4499,
      NULL,
      'pending',
      (CURRENT_DATE + 7),
      (CURRENT_DATE - 4)::timestamptz,
      NULL
    ),
    -- Pending signup_first_payment (1)
    (
      'ffffffff-1111-1111-1111-111111111111',
      'cccccccc-1111-1111-1111-111111111111',
      'fixed',
      'starter',
      'signup_first_payment',
      CURRENT_DATE,
      (CURRENT_DATE + 30),
      4499,
      0,
      4499,
      NULL,
      'pending',
      (CURRENT_DATE + 10),
      (CURRENT_DATE - 2)::timestamptz,
      NULL
    ),
    -- Rejected subscription (1)
    (
      'ffffffff-1111-1111-1111-111111111112',
      'cccccccc-1111-1111-1111-111111111111',
      'fixed',
      'starter',
      'subscription',
      (CURRENT_DATE - 20),
      (CURRENT_DATE + 10),
      4499,
      0,
      4499,
      NULL,
      'rejected',
      (CURRENT_DATE - 15),
      (CURRENT_DATE - 18)::timestamptz,
      NULL
    ),
    -- Minimal center — pending subscription
    (
      'ffffffff-2222-2222-2222-222222222201',
      'cccccccc-2222-2222-2222-222222222222',
      'fixed',
      'solo',
      'subscription',
      CURRENT_DATE,
      (CURRENT_DATE + 30),
      999,
      0,
      999,
      NULL,
      'pending',
      (CURRENT_DATE + 14),
      (CURRENT_DATE - 1)::timestamptz,
      NULL
    );

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'billing_period_start'
  ) THEN
    UPDATE public.invoices
    SET billing_period_start = period_start,
        billing_period_end = period_end
    WHERE center_id IN (
      'cccccccc-1111-1111-1111-111111111111',
      'cccccccc-2222-2222-2222-222222222222'
    );
  END IF;

  ----------------------------------------------------------------------
  -- 8) attendance_scans — 30 rows (realistic center only), last ~14 days
  ----------------------------------------------------------------------
  INSERT INTO public.attendance_scans (
    student_id,
    center_id,
    scanned_by,
    scanned_at,
    payment_status_at_scan,
    session_date,
    payment_recorded
  )
  SELECT
    uuid_generate_v5('cccccccc-1111-1111-1111-111111111111'::uuid, 'audit-student-' || (1 + ((g - 1) % 45))::text),
    'cccccccc-1111-1111-1111-111111111111'::uuid,
    'aaaaaaaa-3333-3333-3333-333333333333'::uuid,
    date_trunc('day', now())::timestamptz
      - make_interval(days => ((g - 1) % 14))
      + make_interval(hours => 9 + (g % 6)),
    'paid',
    (date_trunc('day', now())::date - ((g - 1) % 14)),
    false
  FROM generate_series(1, 30) AS g;

  ----------------------------------------------------------------------
  -- TODO: seed schedule_slots in a follow-up migration once rooms/subjects/teacher seed is built.
  ----------------------------------------------------------------------
END $$;

-- Adjustment 3 — optional billing columns on centers (when present)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'centers' AND column_name = 'plan_key'
  ) THEN
    UPDATE public.centers SET plan_key = 'starter', monthly_price = 4499, base_monthly_price = 4499
    WHERE id = 'cccccccc-1111-1111-1111-111111111111';
    UPDATE public.centers SET plan_key = 'solo', monthly_price = 999, base_monthly_price = 999
    WHERE id = 'cccccccc-2222-2222-2222-222222222222';
  END IF;
END $$;

-- Adjustment 6 — center_metrics_daily: use metric_date OR day + health_score only
DO $$
DECLARE
  has_metric_date boolean;
  has_day boolean;
  has_health boolean;
  use_col text;
  d date;
  i int;
  hs int;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'center_metrics_daily' AND column_name = 'metric_date'
  ) INTO has_metric_date;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'center_metrics_daily' AND column_name = 'day'
  ) INTO has_day;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'center_metrics_daily' AND column_name = 'health_score'
  ) INTO has_health;

  IF NOT has_health THEN
    RAISE NOTICE 'center_metrics_daily.health_score missing; skipping metrics seed.';
    RETURN;
  END IF;

  IF has_metric_date THEN
    use_col := 'metric_date';
  ELSIF has_day THEN
    use_col := 'day';
  ELSE
    RAISE NOTICE 'center_metrics_daily has neither metric_date nor day; skipping metrics seed.';
    RETURN;
  END IF;

  FOR i IN 0..29 LOOP
    d := (CURRENT_DATE - i);
    hs := 60 + ((i * 17 + 7) % 36);
    EXECUTE format(
      'INSERT INTO public.center_metrics_daily (center_id, %I, health_score) VALUES ($1, $2, $3)',
      use_col
    )
    USING 'cccccccc-1111-1111-1111-111111111111'::uuid, d, hs;
  END LOOP;
END $$;
