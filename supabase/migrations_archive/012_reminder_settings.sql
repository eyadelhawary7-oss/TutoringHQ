-- Reminder settings per center
CREATE TABLE IF NOT EXISTS reminder_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  day5_enabled BOOLEAN DEFAULT true,
  day10_enabled BOOLEAN DEFAULT true,
  day15_enabled BOOLEAN DEFAULT true,
  day5_template TEXT DEFAULT 'payment_reminder_day5',
  day10_template TEXT DEFAULT 'payment_reminder_day10',
  day15_template TEXT DEFAULT 'payment_reminder_day15',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(center_id)
);

-- Add alert_status to students table
ALTER TABLE students 
ADD COLUMN IF NOT EXISTS alert_status TEXT DEFAULT NULL;

-- Index
CREATE INDEX IF NOT EXISTS idx_students_alert_status 
ON students(center_id, alert_status) WHERE alert_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reminder_settings_center ON reminder_settings(center_id);
