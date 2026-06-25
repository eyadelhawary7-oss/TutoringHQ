-- Internal admin notes per center (S7 ops UX)
CREATE TABLE center_notes (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  center_id   UUID        NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  author_id   UUID        NOT NULL REFERENCES admin_users(id),
  body        TEXT        NOT NULL CHECK (char_length(body) >= 1),
  is_pinned   BOOLEAN     NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_center_notes_center
  ON center_notes(center_id, created_at DESC);

CREATE INDEX idx_center_notes_pinned
  ON center_notes(center_id)
  WHERE is_pinned = true;

ALTER TABLE center_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "center_notes_admin_all" ON center_notes
  USING (EXISTS (
    SELECT 1 FROM admin_users WHERE id = auth.uid()
  ));

CREATE OR REPLACE FUNCTION set_center_notes_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER center_notes_updated_at
  BEFORE UPDATE ON center_notes
  FOR EACH ROW EXECUTE FUNCTION set_center_notes_updated_at();
