-- Schedule: add group_id for Subject→Group flow, and recurring slot support

ALTER TABLE schedule_slots ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES student_groups(id) ON DELETE SET NULL;
ALTER TABLE schedule_slots ADD COLUMN IF NOT EXISTS recurring BOOLEAN DEFAULT false;
ALTER TABLE schedule_slots ADD COLUMN IF NOT EXISTS recurring_until DATE;
ALTER TABLE schedule_slots ADD COLUMN IF NOT EXISTS parent_slot_id UUID REFERENCES schedule_slots(id);

CREATE INDEX IF NOT EXISTS idx_schedule_slots_group ON schedule_slots(group_id) WHERE group_id IS NOT NULL;
