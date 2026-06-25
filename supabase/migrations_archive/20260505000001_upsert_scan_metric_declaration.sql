-- RPC used by simulate-scan and metricsAggregator (p_center_id, p_scanned_at, p_metric_date).
-- Upserts daily scan totals into center_metrics_daily (same conflict target as JS upserts).

CREATE OR REPLACE FUNCTION public.upsert_scan_metric(
  p_center_id uuid,
  p_scanned_at timestamptz,
  p_metric_date date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.center_metrics_daily AS cmd (
    center_id,
    metric_date,
    total_scans,
    last_scan_at,
    last_upserted_at
  )
  VALUES (
    p_center_id,
    p_metric_date,
    1,
    p_scanned_at,
    now()
  )
  ON CONFLICT (center_id, metric_date)
  DO UPDATE SET
    total_scans = COALESCE(cmd.total_scans, 0) + 1,
    last_scan_at = CASE
      WHEN cmd.last_scan_at IS NULL THEN p_scanned_at
      WHEN p_scanned_at > cmd.last_scan_at THEN p_scanned_at
      ELSE cmd.last_scan_at
    END,
    last_upserted_at = now();
END;
$$;
