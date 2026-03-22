-- Move fee from subject level to group level
-- Each group now has its own monthly fee (groups are the pricing units)

ALTER TABLE student_groups ADD COLUMN IF NOT EXISTS fee NUMERIC DEFAULT 0;

-- Backfill: copy fee from the subject's default fee for groups that have a subject
-- (subjects.monthly_fee matches groups.subject via subject name)
UPDATE student_groups g
SET fee = COALESCE(s.monthly_fee, 0)
FROM subjects s
WHERE s.center_id = g.center_id
  AND g.subject IS NOT NULL
  AND g.subject = s.name
  AND (g.fee IS NULL OR g.fee = 0);
