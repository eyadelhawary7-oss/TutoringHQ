CREATE TABLE IF NOT EXISTS student_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS student_group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES student_groups(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(group_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_student_groups_center ON student_groups(center_id);
CREATE INDEX IF NOT EXISTS idx_group_members_group ON student_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_student ON student_group_members(student_id);
