-- One-free-trial-per-phone durable ledger (centers rebuild — trial-first signup).
--
-- WHY: center signup moves from pay-first to a 14-day free trial (no charge at
-- signup). The pay barrier that used to prevent abuse is gone, so we enforce one
-- free trial per phone at signup. This ledger is DURABLE: the row survives center
-- deletion/rejection, so a removed center cannot be used to claim a second free
-- trial. Insert is the atomic lock (UNIQUE phone) — a concurrent second signup for
-- the same phone fails on the unique violation. Service-role only.

CREATE TABLE IF NOT EXISTS public.trial_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL UNIQUE,
  center_id uuid REFERENCES public.centers(id) ON DELETE SET NULL,
  claimed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.trial_claims ENABLE ROW LEVEL SECURITY;
-- No RLS policies: only the service-role client (signup route) touches this table;
-- anon/authenticated get no access.
REVOKE ALL ON public.trial_claims FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
