-- center_expenses: track monthly expenses per center for P&L
CREATE TABLE IF NOT EXISTS center_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  month DATE NOT NULL,
  rent NUMERIC DEFAULT 0,
  salaries NUMERIC DEFAULT 0,
  utilities NUMERIC DEFAULT 0,
  other NUMERIC DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(center_id, month)
);

CREATE INDEX IF NOT EXISTS idx_center_expenses_center ON center_expenses(center_id);
CREATE INDEX IF NOT EXISTS idx_center_expenses_month ON center_expenses(center_id, month DESC);

ALTER TABLE center_expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "center_expenses_center_members" ON center_expenses;
CREATE POLICY "center_expenses_center_members" ON center_expenses
  FOR ALL
  USING (center_id IN (SELECT center_id FROM users WHERE id = auth.uid()))
  WITH CHECK (center_id IN (SELECT center_id FROM users WHERE id = auth.uid()));

COMMENT ON TABLE center_expenses IS 'Monthly expenses per center for P&L dashboard';

-- Register balance reminder template (create in Meta Business Manager)
INSERT INTO wa_meta_templates (template_name, category, variables_count, status)
VALUES ('chq_balance_reminder', 'payment', 2, 'APPROVED')
ON CONFLICT (template_name) DO UPDATE SET
  category = EXCLUDED.category,
  variables_count = EXCLUDED.variables_count,
  updated_at = now();
