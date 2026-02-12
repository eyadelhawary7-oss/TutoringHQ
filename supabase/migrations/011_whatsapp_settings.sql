-- Add individual_alerts_enabled column to centers
ALTER TABLE centers 
ADD COLUMN IF NOT EXISTS individual_alerts_enabled BOOLEAN DEFAULT false;

-- Add message_type to whatsapp_messages if not exists (it exists with default 'text')
-- No change needed - message_type already exists
