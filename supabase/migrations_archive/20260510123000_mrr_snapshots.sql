-- Point-in-time MRR snapshots (daily cron). Evolves legacy mrr_snapshots if present.

CREATE TABLE IF NOT EXISTS public.mrr_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date DATE NOT NULL,
  total_mrr NUMERIC(12,2) NOT NULL DEFAULT 0,
  active_centers INT NOT NULL DEFAULT 0,
  by_plan JSONB NOT NULL DEFAULT '{}'::jsonb,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Legacy installs: table existed without full shape (e.g. mrr instead of total_mrr).
ALTER TABLE public.mrr_snapshots ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();
ALTER TABLE public.mrr_snapshots ADD COLUMN IF NOT EXISTS total_mrr NUMERIC(12,2);
ALTER TABLE public.mrr_snapshots ADD COLUMN IF NOT EXISTS active_centers INT;
ALTER TABLE public.mrr_snapshots ADD COLUMN IF NOT EXISTS by_plan JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.mrr_snapshots ADD COLUMN IF NOT EXISTS computed_at TIMESTAMPTZ DEFAULT now();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mrr_snapshots' AND column_name = 'mrr'
  ) THEN
    UPDATE public.mrr_snapshots SET total_mrr = mrr::numeric WHERE total_mrr IS NULL;
    ALTER TABLE public.mrr_snapshots DROP COLUMN mrr;
  END IF;
END $$;

ALTER TABLE public.mrr_snapshots ALTER COLUMN total_mrr SET DEFAULT 0;
UPDATE public.mrr_snapshots SET total_mrr = 0 WHERE total_mrr IS NULL;
ALTER TABLE public.mrr_snapshots ALTER COLUMN total_mrr SET NOT NULL;

ALTER TABLE public.mrr_snapshots ALTER COLUMN active_centers SET DEFAULT 0;
UPDATE public.mrr_snapshots SET active_centers = 0 WHERE active_centers IS NULL;
ALTER TABLE public.mrr_snapshots ALTER COLUMN active_centers SET NOT NULL;

UPDATE public.mrr_snapshots SET by_plan = '{}'::jsonb WHERE by_plan IS NULL;
ALTER TABLE public.mrr_snapshots ALTER COLUMN by_plan SET DEFAULT '{}'::jsonb;
ALTER TABLE public.mrr_snapshots ALTER COLUMN by_plan SET NOT NULL;

UPDATE public.mrr_snapshots SET computed_at = now() WHERE computed_at IS NULL;
ALTER TABLE public.mrr_snapshots ALTER COLUMN computed_at SET DEFAULT now();
ALTER TABLE public.mrr_snapshots ALTER COLUMN computed_at SET NOT NULL;

UPDATE public.mrr_snapshots SET id = gen_random_uuid() WHERE id IS NULL;

ALTER TABLE public.mrr_snapshots DROP COLUMN IF EXISTS new_centers;
ALTER TABLE public.mrr_snapshots DROP COLUMN IF EXISTS churned_centers;

CREATE UNIQUE INDEX IF NOT EXISTS mrr_snapshots_date_unique ON public.mrr_snapshots (snapshot_date);

ALTER TABLE public.mrr_snapshots ENABLE ROW LEVEL SECURITY;

-- Align cron health dashboard row with /api/cron/snapshot-mrr
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'cron_health_log'
  ) THEN
    UPDATE public.cron_health_log SET cron_name = 'snapshot-mrr' WHERE cron_name = 'mrr-snapshot';
  END IF;
END $$;
