-- Add group_id and recurring support to schedule_slots
-- Flow: Subject → Group (filtered), Room, Day, Start/End time

ALTER TABLE schedule_slots ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES student_groups(id) ON DELETE CASCADE;
ALTER TABLE schedule_slots ADD COLUMN IF NOT EXISTS recurring BOOLEAN DEFAULT false;
ALTER TABLE schedule_slots ADD COLUMN IF NOT EXISTS recurring_until DATE;
ALTER TABLE schedule_slots ADD COLUMN IF NOT EXISTS parent_slot_id UUID REFERENCES schedule_slots(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_schedule_slots_group ON schedule_slots(group_id) WHERE group_id IS NOT NULL;

-- Allow subject_id to be null for slots that use group_id (group implies subject)
ALTER TABLE schedule_slots ALTER COLUMN subject_id DROP NOT NULL;
