CREATE TABLE IF NOT EXISTS paid_parents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  parent_phone TEXT NOT NULL,
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  active BOOLEAN NOT NULL DEFAULT true,
  check_ups_used INT NOT NULL DEFAULT 0,
  month TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(center_id, parent_phone, month)
);

CREATE INDEX IF NOT EXISTS idx_paid_parents_phone ON paid_parents(parent_phone);
CREATE INDEX IF NOT EXISTS idx_paid_parents_center ON paid_parents(center_id);
