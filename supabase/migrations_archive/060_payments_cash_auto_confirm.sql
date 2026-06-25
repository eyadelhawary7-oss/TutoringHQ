-- Auto-confirm cash payments on insert: set confirmed=true, confirmed_at=now() when method IN ('cash','نقدي','كاش')
CREATE OR REPLACE FUNCTION payments_auto_confirm_cash()
RETURNS TRIGGER AS $$
BEGIN
  IF LOWER(COALESCE(NEW.method, '')) IN ('cash', 'نقدي', 'كاش') THEN
    NEW.confirmed := true;
    NEW.confirmed_at := COALESCE(NEW.confirmed_at, NOW());
    NEW.status := COALESCE(NEW.status, 'confirmed');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payments_auto_confirm_cash ON payments;
CREATE TRIGGER trg_payments_auto_confirm_cash
  BEFORE INSERT ON payments
  FOR EACH ROW
  EXECUTE PROCEDURE payments_auto_confirm_cash();
