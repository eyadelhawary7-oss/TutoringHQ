-- Billing system migration: quarterly billing, WhatsApp add-ons, invoices
-- Pricing: Starter EGP 1000/mo base | Pro EGP 1800/mo | Enterprise EGP 3500/mo

-- 1. Add billing columns to centers
ALTER TABLE centers
ADD COLUMN IF NOT EXISTS billing_period TEXT CHECK (billing_period IN ('monthly', 'quarterly', 'half_yearly', 'yearly')) DEFAULT 'quarterly',
ADD COLUMN IF NOT EXISTS billing_cycle_start DATE DEFAULT CURRENT_DATE,
ADD COLUMN IF NOT EXISTS next_billing_date DATE,
ADD COLUMN IF NOT EXISTS billing_amount NUMERIC DEFAULT 0;

-- Ensure centers have plan column (admin already uses it)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'centers' AND column_name = 'plan'
  ) THEN
    ALTER TABLE centers ADD COLUMN plan TEXT DEFAULT 'starter';
  END IF;
END $$;

-- 2. PostgreSQL function: calculate next billing date
CREATE OR REPLACE FUNCTION calculate_next_billing_date(cycle_start DATE, period TEXT)
RETURNS DATE
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN CASE period
    WHEN 'monthly'     THEN cycle_start + INTERVAL '1 month'
    WHEN 'quarterly'  THEN cycle_start + INTERVAL '3 months'
    WHEN 'half_yearly' THEN cycle_start + INTERVAL '6 months'
    WHEN 'yearly'      THEN cycle_start + INTERVAL '12 months'
    ELSE cycle_start + INTERVAL '3 months'
  END CASE;
END;
$$;

-- 3. PostgreSQL function: calculate billing amount
CREATE OR REPLACE FUNCTION calculate_billing_amount(plan_type TEXT, billing_period TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  base_monthly NUMERIC;
BEGIN
  base_monthly := CASE plan_type
    WHEN 'starter'    THEN 1000
    WHEN 'pro'        THEN 1800
    WHEN 'enterprise' THEN 3500
    ELSE 1000
  END CASE;

  RETURN CASE billing_period
    WHEN 'monthly'     THEN ROUND(base_monthly * 1 * 1.075, 2)
    WHEN 'quarterly'   THEN ROUND(base_monthly * 3 * 1.0, 2)
    WHEN 'half_yearly' THEN ROUND(base_monthly * 6 * 0.95, 2)
    WHEN 'yearly'      THEN ROUND(base_monthly * 12 * 0.90, 2)
    ELSE ROUND(base_monthly * 3 * 1.0, 2)
  END CASE;
END;
$$;

-- 4. Trigger function: update billing_amount and next_billing_date
CREATE OR REPLACE FUNCTION update_billing_amount()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.billing_amount := calculate_billing_amount(COALESCE(NEW.plan, 'starter'), COALESCE(NEW.billing_period, 'quarterly'));
  NEW.next_billing_date := calculate_next_billing_date(COALESCE(NEW.billing_cycle_start, CURRENT_DATE), COALESCE(NEW.billing_period, 'quarterly'));
  RETURN NEW;
END;
$$;

-- Create trigger (drop first if exists for idempotency)
DROP TRIGGER IF EXISTS trigger_update_billing_amount ON centers;
CREATE TRIGGER trigger_update_billing_amount
  BEFORE INSERT OR UPDATE OF plan, billing_period, billing_cycle_start
  ON centers
  FOR EACH ROW
  EXECUTE PROCEDURE update_billing_amount();

-- Backfill existing centers: set cycle start, then billing amounts
UPDATE centers
SET billing_cycle_start = COALESCE(billing_cycle_start, created_at::date, CURRENT_DATE)
WHERE billing_cycle_start IS NULL;

UPDATE centers
SET billing_amount = calculate_billing_amount(COALESCE(plan, 'starter'), COALESCE(billing_period, 'quarterly')),
    next_billing_date = calculate_next_billing_date(COALESCE(billing_cycle_start, CURRENT_DATE), COALESCE(billing_period, 'quarterly'))
WHERE next_billing_date IS NULL OR billing_amount = 0;

-- 5. whatsapp_subscriptions table
CREATE TABLE IF NOT EXISTS whatsapp_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  billing_month TEXT NOT NULL,
  individual_enabled BOOLEAN DEFAULT false,
  individual_students_count INT DEFAULT 0,
  individual_monthly_charge NUMERIC DEFAULT 0,
  individual_messages_used INT DEFAULT 0,
  individual_messages_included INT DEFAULT 0,
  individual_overage_count INT DEFAULT 0,
  individual_overage_charge NUMERIC DEFAULT 0,
  groups_enabled BOOLEAN DEFAULT false,
  groups_count INT DEFAULT 0,
  group_monthly_charge NUMERIC DEFAULT 0,
  group_messages_used INT DEFAULT 0,
  group_messages_included INT DEFAULT 0,
  group_overage_count INT DEFAULT 0,
  group_overage_charge NUMERIC DEFAULT 0,
  parent_checkup_enabled BOOLEAN DEFAULT false,
  parent_count INT DEFAULT 0,
  parent_monthly_charge NUMERIC DEFAULT 0,
  parent_checks_used INT DEFAULT 0,
  status TEXT CHECK (status IN ('active', 'suspended')) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(center_id, billing_month)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_subscriptions_center ON whatsapp_subscriptions(center_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_subscriptions_billing_month ON whatsapp_subscriptions(center_id, billing_month);

ALTER TABLE whatsapp_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_subscriptions_select ON whatsapp_subscriptions;
CREATE POLICY whatsapp_subscriptions_select ON whatsapp_subscriptions
  FOR SELECT USING (center_id IN (SELECT center_id FROM users WHERE id = auth.uid()));

-- 6. center_message_templates table
CREATE TABLE IF NOT EXISTS center_message_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  template_type TEXT NOT NULL CHECK (template_type IN ('checkin', 'payment_day5', 'payment_day10', 'payment_day15', 'announcement', 'schedule_change')),
  message_body TEXT,
  enabled BOOLEAN DEFAULT true,
  auto_send BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(center_id, template_type)
);

CREATE INDEX IF NOT EXISTS idx_center_message_templates_center ON center_message_templates(center_id);

ALTER TABLE center_message_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS center_message_templates_select ON center_message_templates;
CREATE POLICY center_message_templates_select ON center_message_templates
  FOR SELECT USING (center_id IN (SELECT center_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS center_message_templates_insert ON center_message_templates;
CREATE POLICY center_message_templates_insert ON center_message_templates
  FOR INSERT WITH CHECK (center_id IN (SELECT center_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS center_message_templates_update ON center_message_templates;
CREATE POLICY center_message_templates_update ON center_message_templates
  FOR UPDATE USING (center_id IN (SELECT center_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS center_message_templates_delete ON center_message_templates;
CREATE POLICY center_message_templates_delete ON center_message_templates
  FOR DELETE USING (center_id IN (SELECT center_id FROM users WHERE id = auth.uid()));

-- 7. whatsapp_usage table
CREATE TABLE IF NOT EXISTS whatsapp_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  message_type TEXT NOT NULL CHECK (message_type IN ('individual', 'group', 'check_up')),
  student_id UUID REFERENCES students(id) ON DELETE SET NULL,
  group_id UUID REFERENCES student_groups(id) ON DELETE SET NULL,
  parent_phone TEXT,
  template_type TEXT,
  message_body TEXT,
  to_phone TEXT NOT NULL,
  status TEXT CHECK (status IN ('sent', 'delivered', 'failed', 'read')) DEFAULT 'sent',
  meta_message_id TEXT,
  billed_month TEXT NOT NULL,
  included_in_plan BOOLEAN DEFAULT true,
  overage_charge NUMERIC DEFAULT 0,
  meta_cost NUMERIC DEFAULT 0.17,
  sent_at TIMESTAMPTZ DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_usage_center ON whatsapp_usage(center_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_usage_center_month ON whatsapp_usage(center_id, billed_month);
CREATE INDEX IF NOT EXISTS idx_whatsapp_usage_student ON whatsapp_usage(student_id);

ALTER TABLE whatsapp_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_usage_select ON whatsapp_usage;
CREATE POLICY whatsapp_usage_select ON whatsapp_usage
  FOR SELECT USING (center_id IN (SELECT center_id FROM users WHERE id = auth.uid()));

-- 8. invoices table
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  invoice_number TEXT UNIQUE NOT NULL,
  invoice_type TEXT NOT NULL CHECK (invoice_type IN ('base_subscription', 'whatsapp_addon', 'setup_fee')),
  base_amount NUMERIC DEFAULT 0,
  whatsapp_individual NUMERIC DEFAULT 0,
  whatsapp_group NUMERIC DEFAULT 0,
  whatsapp_parent_checkup NUMERIC DEFAULT 0,
  individual_overage NUMERIC DEFAULT 0,
  group_overage NUMERIC DEFAULT 0,
  discount_amount NUMERIC DEFAULT 0,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  billing_period_start DATE NOT NULL,
  billing_period_end DATE NOT NULL,
  due_date DATE NOT NULL,
  status TEXT CHECK (status IN ('pending', 'paid', 'overdue', 'cancelled')) DEFAULT 'pending',
  payment_method TEXT,
  payment_reference TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoices_center ON invoices(center_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoices_select ON invoices;
CREATE POLICY invoices_select ON invoices
  FOR SELECT USING (center_id IN (SELECT center_id FROM users WHERE id = auth.uid()));
