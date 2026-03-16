-- Referral management: ensure referrals table exists with required columns
CREATE TABLE IF NOT EXISTS public.referrals (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  referrer_center_id uuid REFERENCES public.centers(id) ON DELETE CASCADE NOT NULL,
  referred_center_id uuid REFERENCES public.centers(id) ON DELETE CASCADE NOT NULL,
  referral_code text NOT NULL,
  status text NOT NULL DEFAULT 'pending', -- 'pending' | 'active' | 'inactive' | 'hold'
  month_count integer NOT NULL DEFAULT 0,
  total_earned_egp numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now() NOT NULL,
  last_paid_at timestamptz
);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

-- Add columns if table already exists from prior migration
ALTER TABLE public.referrals ADD COLUMN IF NOT EXISTS month_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.referrals ADD COLUMN IF NOT EXISTS total_earned_egp numeric NOT NULL DEFAULT 0;
ALTER TABLE public.referrals ADD COLUMN IF NOT EXISTS last_paid_at timestamptz;

DROP POLICY IF EXISTS "Center owners can view their own referrals" ON public.referrals;
CREATE POLICY "Center owners can view their own referrals"
  ON public.referrals FOR SELECT
  USING (referrer_center_id IN (
    SELECT id FROM public.centers c
    JOIN public.users u ON u.center_id = c.id AND u.role = 'owner'
    WHERE u.id = auth.uid()
  ));
