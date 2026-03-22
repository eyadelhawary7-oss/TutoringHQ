-- Move fee from subject level to group level
-- Each group has its own monthly fee (students may override per-student)
ALTER TABLE student_groups ADD COLUMN IF NOT EXISTS fee NUMERIC DEFAULT 0;

-- Backfill: copy fee from subject's default fee where group has matching subject
UPDATE student_groups g
SET fee = COALESCE(
  (SELECT monthly_fee FROM subjects s 
   WHERE s.center_id = g.center_id AND s.name = g.subject 
   LIMIT 1),
  0
)
WHERE g.fee IS NULL OR g.fee = 0;
