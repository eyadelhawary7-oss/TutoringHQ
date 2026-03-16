-- Center health score 0-100, recomputed nightly
-- Bands: 80-100=Healthy, 60-79=Engaged, 40-59=At Risk, 0-39=Critical

ALTER TABLE centers ADD COLUMN IF NOT EXISTS health_score INTEGER;
ALTER TABLE centers ADD COLUMN IF NOT EXISTS health_score_band TEXT;

COMMENT ON COLUMN centers.health_score IS '0-100: last scan (-30), onboarding (+20), payment (+25), parent comms (+10), daily summary (+5), referral (+10)';
COMMENT ON COLUMN centers.health_score_band IS 'Healthy|Engaged|At Risk|Critical';

-- Function: compute health score for a center
CREATE OR REPLACE FUNCTION compute_center_health_score(p_center_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  score INTEGER := 50;
  scans_7d INT;
  onboarded BOOLEAN;
  payment_ok BOOLEAN;
  parent_comms BOOLEAN;
  daily_summary BOOLEAN;
  referral_sent BOOLEAN;
BEGIN
  -- Last scan activity: 0 scans in 7 days = -30
  SELECT COUNT(*)::INT INTO scans_7d
  FROM attendance_scans
  WHERE center_id = p_center_id
    AND scanned_at >= (now() - interval '7 days');
  IF scans_7d = 0 THEN score := score - 30; END IF;

  -- Onboarding complete: +20
  SELECT COALESCE(c.onboarded, false) INTO onboarded
  FROM centers c WHERE c.id = p_center_id;
  IF onboarded THEN score := score + 20; END IF;

  -- Payment current: +25 (subscription_status active and no overdue)
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

  -- Parent comms enabled: +10 (individual_alerts_enabled or students with parent_phone)
  SELECT
    COALESCE(c.individual_alerts_enabled, false)
    OR EXISTS (SELECT 1 FROM students s WHERE s.center_id = p_center_id AND s.parent_phone IS NOT NULL AND s.parent_phone != '')
  INTO parent_comms
  FROM centers c WHERE c.id = p_center_id;
  IF parent_comms THEN score := score + 10; END IF;

  -- Daily summary on: +5
  SELECT COALESCE(c.daily_summary_enabled, true) INTO daily_summary
  FROM centers c WHERE c.id = p_center_id;
  IF daily_summary THEN score := score + 5; END IF;

  -- Referral sent: +10 (center was referred or has referred someone)
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

-- Function: recompute all center health scores
CREATE OR REPLACE FUNCTION recompute_all_health_scores()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  sc INT;
  cnt INT := 0;
BEGIN
  FOR r IN SELECT id FROM centers WHERE status = 'active'
  LOOP
    sc := compute_center_health_score(r.id);
    UPDATE centers
    SET health_score = sc,
        health_score_band = CASE
          WHEN sc >= 80 THEN 'Healthy'
          WHEN sc >= 60 THEN 'Engaged'
          WHEN sc >= 40 THEN 'At Risk'
          ELSE 'Critical'
        END
    WHERE id = r.id;
    cnt := cnt + 1;
  END LOOP;
  RETURN cnt;
END;
$$;
