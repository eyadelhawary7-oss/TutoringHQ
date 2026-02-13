-- Move fee from subject level to group level
-- Subjects are now categories only; each group has its own monthly fee.

ALTER TABLE student_groups ADD COLUMN IF NOT EXISTS fee NUMERIC DEFAULT 0;

-- Backfill: copy fee from the subject's default fee where group.subject matches subject.name
UPDATE student_groups sg
SET fee = COALESCE(s.monthly_fee, 0)
FROM subjects s
WHERE sg.center_id = s.center_id
  AND sg.subject = s.name
  AND (sg.fee IS NULL OR sg.fee = 0);
