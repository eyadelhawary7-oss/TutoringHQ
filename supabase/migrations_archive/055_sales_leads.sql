-- Sales Pipeline tables for admin
CREATE TABLE IF NOT EXISTS sales_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contact_person text,
  phone text,
  area text,
  source text,
  status text NOT NULL DEFAULT 'prospect' CHECK (status IN ('prospect', 'contacted', 'demo_scheduled', 'converted')),
  notes text,
  center_id uuid REFERENCES centers(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sales_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
  action text,
  notes text,
  created_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_sales_leads_status ON sales_leads(status);
CREATE INDEX IF NOT EXISTS idx_sales_activities_lead_id ON sales_activities(lead_id);

-- RLS
ALTER TABLE sales_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_activities ENABLE ROW LEVEL SECURITY;

-- No RLS policies: only service role (used by admin API) can access; anon/auth get no access
