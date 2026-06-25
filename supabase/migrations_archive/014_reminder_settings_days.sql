-- Allow centers to customize reminder day numbers (default 5, 10, 15)
ALTER TABLE reminder_settings
  ADD COLUMN IF NOT EXISTS day5 INTEGER DEFAULT 5,
  ADD COLUMN IF NOT EXISTS day10 INTEGER DEFAULT 10,
  ADD COLUMN IF NOT EXISTS day15 INTEGER DEFAULT 15;
