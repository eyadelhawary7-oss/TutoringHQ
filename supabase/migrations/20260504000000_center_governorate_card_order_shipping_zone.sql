-- Center governorate for Bosta shipping; card order shipping zone snapshot
ALTER TABLE centers ADD COLUMN IF NOT EXISTS governorate TEXT DEFAULT NULL;
ALTER TABLE card_orders ADD COLUMN IF NOT EXISTS shipping_zone TEXT DEFAULT NULL;
