-- WhatsApp messages log (outbound)
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id UUID REFERENCES centers(id) ON DELETE CASCADE,
  sent_by UUID REFERENCES auth.users(id),
  student_id UUID REFERENCES students(id) ON DELETE SET NULL,
  to_phone TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'text',
  template_name TEXT,
  body TEXT,
  wa_message_id TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- WhatsApp incoming messages
CREATE TABLE IF NOT EXISTS whatsapp_incoming (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_phone TEXT NOT NULL,
  from_name TEXT,
  message_type TEXT DEFAULT 'text',
  body TEXT,
  wa_message_id TEXT UNIQUE,
  timestamp TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for quick lookups
CREATE INDEX IF NOT EXISTS idx_wa_messages_center ON whatsapp_messages(center_id);
CREATE INDEX IF NOT EXISTS idx_wa_messages_student ON whatsapp_messages(student_id);
CREATE INDEX IF NOT EXISTS idx_wa_messages_wa_id ON whatsapp_messages(wa_message_id);
CREATE INDEX IF NOT EXISTS idx_wa_incoming_phone ON whatsapp_incoming(from_phone);

-- Add phone column to students if not exists
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'students' AND column_name = 'phone'
  ) THEN
    ALTER TABLE students ADD COLUMN phone TEXT;
  END IF;
END $$;
