-- Admin-configurable working hours for the schedule grid
ALTER TABLE centers ADD COLUMN IF NOT EXISTS schedule_start_hour SMALLINT DEFAULT 8;
ALTER TABLE centers ADD COLUMN IF NOT EXISTS schedule_end_hour SMALLINT DEFAULT 20;
