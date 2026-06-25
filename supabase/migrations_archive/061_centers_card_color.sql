-- Add card_color to centers for QR card order color preference
ALTER TABLE centers ADD COLUMN IF NOT EXISTS card_color TEXT DEFAULT '#0D9488';

COMMENT ON COLUMN centers.card_color IS 'Preferred color for QR card header (hex). Default teal.';
