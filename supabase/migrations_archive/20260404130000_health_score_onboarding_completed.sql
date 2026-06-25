-- Fix compute_center_health_score: centers.onboarded does not exist in prod; use onboarding_completed
CREATE OR REPLACE FUNCTION compute_center_health_score(p_center_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  score INTEGER := 50;
  scans_7d INT;
  onboarding_done BOOLEAN;
  payment_ok BOOLEAN;
  parent_comms BOOLEAN;
  daily_summary BOOLEAN;
  referral_sent BOOLEAN;
BEGIN
  SELECT COUNT(*)::INT INTO scans_7d
  FROM attendance_scans
  WHERE center_id = p_center_id
    AND scanned_at >= (now() - interval '7 days');
  IF scans_7d = 0 THEN score := score - 30; END IF;

  SELECT COALESCE(c.onboarding_completed, false) INTO onboarding_done
  FROM centers c WHERE c.id = p_center_id;
  IF onboarding_done THEN score := score + 20; END IF;

  SELECT
    COALESCE(c.subscription_status, 'active') = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM invoices i
      WHERE i.center_id = p_center_id
        AND i.status NOT IN ('paid', 'cancelled')
        AND i.due_date < CURRENT_DATE
    )
  INTO payment_ok
  FROM centers c WHERE c.id = p_center_id;
  IF payment_ok THEN score := score + 25; END IF;

  SELECT
    COALESCE(c.individual_alerts_enabled, false)
    OR EXISTS (SELECT 1 FROM students s WHERE s.center_id = p_center_id AND s.parent_phone IS NOT NULL AND s.parent_phone != '')
  INTO parent_comms
  FROM centers c WHERE c.id = p_center_id;
  IF parent_comms THEN score := score + 10; END IF;

  SELECT COALESCE(c.daily_summary_enabled, true) INTO daily_summary
  FROM centers c WHERE c.id = p_center_id;
  IF daily_summary THEN score := score + 5; END IF;

  SELECT
    c.referred_by IS NOT NULL
    OR EXISTS (SELECT 1 FROM referrals r WHERE r.referrer_center_id = p_center_id)
  INTO referral_sent
  FROM centers c WHERE c.id = p_center_id;
  IF referral_sent THEN score := score + 10; END IF;

  score := LEAST(100, GREATEST(0, score));
  RETURN score;
END;
$$;
