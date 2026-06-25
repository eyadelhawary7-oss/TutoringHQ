ALTER TABLE public.centers ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS centers_is_test_idx ON public.centers (is_test) WHERE is_test = true;
