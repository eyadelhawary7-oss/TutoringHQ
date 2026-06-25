-- Add delivery_address JSONB to centers for saving card order delivery details
ALTER TABLE centers ADD COLUMN IF NOT EXISTS delivery_address JSONB DEFAULT NULL;

COMMENT ON COLUMN centers.delivery_address IS 'Saved delivery address for card orders: full_name, phone, governorate, city, street, building, landmark';
