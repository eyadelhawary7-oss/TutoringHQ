-- Terms of Service acceptance on signup (mirrors remote apply_migration)
ALTER TABLE centers
  ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS terms_version TEXT DEFAULT NULL;
