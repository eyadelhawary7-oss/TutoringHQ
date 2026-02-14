-- Ensure payments table has verified columns: method, recorded_by, paid_at
-- Add columns if missing; for existing DBs with payment_method/payment_date/created_by, add synonyms
ALTER TABLE payments ADD COLUMN IF NOT EXISTS method TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS recorded_by UUID REFERENCES auth.users(id);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='payment_method')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='method') THEN
    UPDATE payments SET method = payment_method WHERE method IS NULL AND payment_method IS NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='payment_date')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='paid_at') THEN
    UPDATE payments SET paid_at = payment_date::timestamptz WHERE paid_at IS NULL AND payment_date IS NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='created_by')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='recorded_by') THEN
    UPDATE payments SET recorded_by = created_by WHERE recorded_by IS NULL AND created_by IS NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_payments_center_paid_at ON payments(center_id, paid_at DESC);
